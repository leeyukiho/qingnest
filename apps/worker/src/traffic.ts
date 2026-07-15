import { platformConfig } from "@qingnest/shared/config/platform";
import { getContentType } from "@qingnest/shared/deployment/mime";
import { createServiceSupabase, hasServiceSupabase } from "./supabase";
import type { Env } from "./types";

type CfResult<T> = { success: boolean; result: T; errors?: Array<{ message: string }> };
type AccelerationRow = {
  site_id: string;
  hostname: string;
  pages_project_name: string | null;
  pages_deployment_id: string | null;
  bypass_route_id: string | null;
  status: string;
  hot_windows: number;
  cool_windows: number;
  temporary_until: string | null;
  retry_count: number;
  next_retry_at: string | null;
};

const CF_API = "https://api.cloudflare.com/client/v4";
const trafficLimitCache = new Map<string, { limited: boolean; expiresAt: number }>();

function configured(env: Env) {
  return Boolean(
    env.CLOUDFLARE_ACCOUNT_ID &&
      env.CLOUDFLARE_ZONE_ID &&
      env.CLOUDFLARE_API_TOKEN &&
      env.TRAFFIC_ANALYTICS &&
      env.SITE_ASSETS &&
      hasServiceSupabase(env),
  );
}

async function cf<T>(env: Env, path: string, init?: RequestInit) {
  const response = await fetch(`${CF_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      ...(init?.body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...init?.headers,
    },
  });
  const body = (await response.json()) as CfResult<T>;
  if (!response.ok || !body.success) {
    throw new Error(body.errors?.map((item) => item.message).join("; ") || `Cloudflare API ${response.status}`);
  }
  return body.result;
}

export function recordTraffic(env: Env, hostname: string, status: number, bytes: number) {
  env.TRAFFIC_ANALYTICS?.writeDataPoint({
    blobs: [hostname],
    doubles: [1, Math.max(0, bytes), status],
    indexes: [hostname],
  });
}

export async function isTrafficLimited(env: Env, hostname: string) {
  const cached = trafficLimitCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) return cached.limited;
  const limited = env.DOMAIN_MAP ? Boolean(await env.DOMAIN_MAP.get(`traffic-limit:${hostname}`)) : false;
  trafficLimitCache.set(hostname, { limited, expiresAt: Date.now() + 60_000 });
  return limited;
}

async function trafficByHostname(env: Env) {
  const minutes = platformConfig.trafficAcceleration.evaluationWindowMinutes;
  const sql = `SELECT blob1 AS hostname, SUM(double1) AS requests, SUM(double2) AS bytes_sent FROM qingnest_traffic WHERE timestamp > NOW() - INTERVAL '${minutes}' MINUTE GROUP BY hostname`;
  const response = await fetch(`${CF_API}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/analytics_engine/sql`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      "content-type": "text/plain",
    },
    body: sql,
  });
  if (!response.ok) throw new Error(`Analytics Engine query failed (${response.status})`);
  const body = (await response.json()) as { data?: Array<{ hostname: string; requests: number; bytes_sent: number }> };
  return body.data ?? [];
}

async function acceleratedTraffic(env: Env, hostnames: string[]) {
  if (!hostnames.length) return [];
  const since = new Date(Date.now() - platformConfig.trafficAcceleration.evaluationWindowMinutes * 60_000).toISOString();
  const response = await fetch(`${CF_API}/graphql`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({
      query: `query($zone: string!, $since: Time!, $hosts: [string!]) { viewer { zones(filter: { zoneTag: $zone }) { httpRequestsAdaptiveGroups(limit: 5000, filter: { datetime_geq: $since, clientRequestHTTPHost_in: $hosts }) { dimensions { clientRequestHTTPHost } sum { requests bytes } } } } }`,
      variables: { zone: env.CLOUDFLARE_ZONE_ID, since, hosts: hostnames },
    }),
  });
  const body = (await response.json()) as any;
  if (!response.ok || body.errors?.length) throw new Error(body.errors?.[0]?.message ?? `Cloudflare GraphQL ${response.status}`);
  return (body.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups ?? []).map((item: any) => ({
    hostname: item.dimensions.clientRequestHTTPHost,
    requests: Number(item.sum.requests ?? 0),
    bytes_sent: Number(item.sum.bytes ?? 0),
  }));
}

async function shaKey(bytes: ArrayBuffer, path: string) {
  const suffix = new TextEncoder().encode(path.split(".").pop() ?? "");
  const joined = new Uint8Array(bytes.byteLength + suffix.byteLength);
  joined.set(new Uint8Array(bytes));
  joined.set(suffix, bytes.byteLength);
  const digest = await crypto.subtle.digest("SHA-256", joined);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function uploadCurrentDeployment(env: Env, projectName: string, prefix: string) {
  const bucket = env.SITE_ASSETS!;
  const files: Array<{ path: string; key: string; bytes: ArrayBuffer; contentType: string }> = [];
  let cursor: string | undefined;
  let total = 0;
  do {
    const page = await bucket.list({ prefix: `${prefix}/`, cursor });
    for (const item of page.objects) {
      if (item.size > platformConfig.trafficAcceleration.maxPagesFileBytes) throw new Error(`${item.key} exceeds the Pages 25 MiB file limit`);
      total += item.size;
      if (total > platformConfig.trafficAcceleration.maxDirectUploadBytes) throw new Error("Site is too large for automatic Pages Direct Upload");
      if (files.length >= platformConfig.trafficAcceleration.maxPagesFiles) throw new Error("Site exceeds the Pages file-count limit");
      const object = await bucket.get(item.key);
      if (!object) throw new Error(`R2 object disappeared during promotion: ${item.key}`);
      const bytes = await object.arrayBuffer();
      const path = item.key.slice(prefix.length + 1);
      files.push({ path, key: await shaKey(bytes, path), bytes, contentType: getContentType(path) });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  const token = await cf<{ jwt: string }>(env, `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${projectName}/upload-token`);
  for (let offset = 0; offset < files.length; ) {
    const batch = [];
    let batchBytes = 0;
    while (offset < files.length && batchBytes + files[offset].bytes.byteLength <= 8 * 1024 * 1024) {
      const file = files[offset++];
      batchBytes += file.bytes.byteLength;
      let binary = "";
      const view = new Uint8Array(file.bytes);
      for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
      batch.push({ key: file.key, value: btoa(binary), metadata: { contentType: file.contentType }, base64: true });
    }
    const response = await fetch(`${CF_API}/pages/assets/upload`, {
      method: "POST",
      headers: { authorization: `Bearer ${token.jwt}`, "content-type": "application/json" },
      body: JSON.stringify(batch),
    });
    if (!response.ok) throw new Error(`Pages asset upload failed (${response.status})`);
  }
  const form = new FormData();
  form.set("manifest", JSON.stringify(Object.fromEntries(files.map((file) => [file.path, file.key]))));
  form.set("branch", "production");
  return cf<{ id: string; url: string }>(env, `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${projectName}/deployments`, { method: "POST", body: form });
}

async function promote(env: Env, row: AccelerationRow) {
  const supabase = createServiceSupabase(env) as any;
  const projectName = row.pages_project_name ?? `qn-${row.site_id.replaceAll("-", "").slice(0, 24)}`;
  await supabase.from("pages_accelerations").update({ status: "provisioning", pages_project_name: projectName, last_error: null, updated_at: new Date().toISOString() }).eq("site_id", row.site_id);
  try {
    await env.DOMAIN_MAP?.delete(`traffic-limit:${row.hostname}`);
    trafficLimitCache.delete(row.hostname);
    const { count: projectCount } = await supabase.from("pages_accelerations").select("site_id", { count: "exact", head: true }).in("status", ["provisioning", "binding", "verifying", "accelerated", "cooling"]);
    if ((projectCount ?? 0) >= platformConfig.trafficAcceleration.maxPagesProjects) throw new Error("Pages acceleration capacity guard reached");
    try {
      await cf(env, `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects`, { method: "POST", body: JSON.stringify({ name: projectName, production_branch: "production" }) });
    } catch (error) {
      if (!String(error).toLowerCase().includes("already exists")) throw error;
    }
    const { data: site } = await supabase.from("sites").select("active_deployment_id").eq("id", row.site_id).single();
    const { data: deployment } = await supabase.from("deployments").select("r2_prefix").eq("id", site.active_deployment_id).single();
    const pagesDeployment = await uploadCurrentDeployment(env, projectName, deployment.r2_prefix);
    let domain: { status?: string };
    try {
      domain = await cf(env, `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${projectName}/domains`, { method: "POST", body: JSON.stringify({ name: row.hostname }) });
    } catch (error) {
      if (!String(error).toLowerCase().includes("already exists")) throw error;
      domain = await cf(env, `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${projectName}/domains/${row.hostname}`);
    }
    if (domain.status !== "active") throw new Error(`Pages custom domain is ${domain.status ?? "pending"}; will retry before switching traffic`);
    const pagesHealth = await fetch(pagesDeployment.url, { redirect: "manual", headers: { "user-agent": "QingNest-Lifecycle/1.0" } });
    if (pagesHealth.status >= 500) throw new Error(`Pages deployment health check returned ${pagesHealth.status}`);
    const route = await cf<{ id: string }>(env, `/zones/${env.CLOUDFLARE_ZONE_ID}/workers/routes`, { method: "POST", body: JSON.stringify({ pattern: `${row.hostname}/*`, script: null }) });
    await supabase.from("pages_accelerations").update({ status: "accelerated", pages_deployment_id: pagesDeployment.id, bypass_route_id: route.id, accelerated_at: new Date().toISOString(), retry_count: 0, last_error: null, updated_at: new Date().toISOString() }).eq("site_id", row.site_id);
  } catch (error) {
    await supabase.from("pages_accelerations").update({ status: "failed", retry_count: row.retry_count + 1, next_retry_at: new Date(Date.now() + Math.min(3600, 60 * 2 ** row.retry_count) * 1000).toISOString(), last_error: String(error).slice(0, 1000), updated_at: new Date().toISOString() }).eq("site_id", row.site_id);
  }
}

async function demote(env: Env, row: AccelerationRow, limitFreeTraffic = false) {
  const supabase = createServiceSupabase(env) as any;
  await supabase.from("pages_accelerations").update({ status: "deleting", updated_at: new Date().toISOString() }).eq("site_id", row.site_id);
  try {
    if (row.bypass_route_id) await cf(env, `/zones/${env.CLOUDFLARE_ZONE_ID}/workers/routes/${row.bypass_route_id}`, { method: "DELETE" });
    if (row.pages_project_name) await cf(env, `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${row.pages_project_name}`, { method: "DELETE" });
    const nextRetryAt = limitFreeTraffic ? new Date(Date.now() + 30 * 86400_000).toISOString() : null;
    if (limitFreeTraffic) await env.DOMAIN_MAP?.put(`traffic-limit:${row.hostname}`, "free-hot-site", { expirationTtl: 30 * 86400 });
    trafficLimitCache.delete(row.hostname);
    await supabase.from("pages_accelerations").update({ status: "shared", pages_project_name: null, pages_deployment_id: null, bypass_route_id: null, hot_windows: 0, cool_windows: 0, temporary_until: null, next_retry_at: nextRetryAt, last_error: null, updated_at: new Date().toISOString() }).eq("site_id", row.site_id);
  } catch (error) {
    await supabase.from("pages_accelerations").update({ status: "failed", retry_count: row.retry_count + 1, next_retry_at: new Date(Date.now() + 15 * 60_000).toISOString(), last_error: String(error).slice(0, 1000), updated_at: new Date().toISOString() }).eq("site_id", row.site_id);
  }
}

export async function runTrafficLifecycle(env: Env) {
  if (!configured(env)) return;
  const supabase = createServiceSupabase(env) as any;
  const { data: allExisting } = await supabase.from("pages_accelerations").select("*");
  const acceleratedHosts = (allExisting ?? []).filter((row: AccelerationRow) => row.status === "accelerated").map((row: AccelerationRow) => row.hostname);
  const traffic = await trafficByHostname(env);
  const accelerated = await acceleratedTraffic(env, acceleratedHosts);
  const merged = new Map<string, { hostname: string; requests: number; bytes_sent: number }>();
  for (const item of [...traffic, ...accelerated]) {
    const prior = merged.get(item.hostname);
    merged.set(item.hostname, { hostname: item.hostname, requests: Number(item.requests) + (prior?.requests ?? 0), bytes_sent: Number(item.bytes_sent) + (prior?.bytes_sent ?? 0) });
  }
  const hostnames = [...new Set([...merged.keys(), ...(allExisting ?? []).map((row: AccelerationRow) => row.hostname)])];
  if (!hostnames.length) return;
  const { data: domains } = await supabase.from("domains").select("hostname, site_id").in("hostname", hostnames).eq("status", "active");
  const siteIds = [...new Set((domains ?? []).map((domain: any) => domain.site_id))];
  const { data: sites } = await supabase.from("sites").select("id, user_id").in("id", siteIds);
  const userIds = [...new Set((sites ?? []).map((site: any) => site.user_id))];
  const { data: profiles } = await supabase.from("profiles").select("id, plan").in("id", userIds);
  const siteUsers = new Map((sites ?? []).map((site: any) => [site.id, site.user_id]));
  const userPlans = new Map((profiles ?? []).map((profile: any) => [profile.id, profile.plan]));
  const current = merged;
  const existing = allExisting;
  const rows = new Map<string, AccelerationRow>((existing ?? []).map((row: AccelerationRow) => [row.hostname, row]));
  for (const domain of domains ?? []) {
    const sample = current.get(domain.hostname) ?? { hostname: domain.hostname, requests: 0, bytes_sent: 0 };
    const row: AccelerationRow = rows.get(domain.hostname) ?? { site_id: domain.site_id, hostname: domain.hostname, pages_project_name: null, pages_deployment_id: null, bypass_route_id: null, status: "shared", hot_windows: 0, cool_windows: 0, temporary_until: null, retry_count: 0, next_retry_at: null };
    const hot = sample.requests >= platformConfig.trafficAcceleration.promoteRequestsInWindow;
    const cool = sample.requests <= platformConfig.trafficAcceleration.cooldownRequestsInWindow;
    row.hot_windows = hot ? row.hot_windows + 1 : 0;
    row.cool_windows = cool ? row.cool_windows + 1 : 0;
    const plan = userPlans.get(siteUsers.get(domain.site_id)) ?? "free";
    if (plan !== "free" && row.next_retry_at) {
      await env.DOMAIN_MAP?.delete(`traffic-limit:${domain.hostname}`);
      trafficLimitCache.delete(domain.hostname);
      row.next_retry_at = null;
    }
    if (!row.temporary_until && hot) row.temporary_until = new Date(Date.now() + (plan === "free" ? platformConfig.trafficAcceleration.freeProtectionHours : platformConfig.trafficAcceleration.paidProtectionHours) * 3600_000).toISOString();
    await supabase.from("pages_accelerations").upsert({ ...row, last_request_count: sample.requests, last_evaluated_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    const retryReady = !row.next_retry_at || Date.parse(row.next_retry_at) <= Date.now();
    if ((row.status === "shared" || row.status === "failed") && retryReady && row.hot_windows >= platformConfig.trafficAcceleration.promoteConsecutiveWindows) await promote(env, row);
    const protectionExpired = Boolean(row.temporary_until && Date.parse(row.temporary_until) < Date.now());
    if (row.status === "accelerated" && protectionExpired && (plan === "free" || row.cool_windows >= platformConfig.trafficAcceleration.cooldownConsecutiveWindows)) await demote(env, row, plan === "free");
  }
}
