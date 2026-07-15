import { createServiceSupabase, hasServiceSupabase } from "./supabase";
import type { Env } from "./types";

const CF_API = "https://api.cloudflare.com/client/v4";
const PENDING_RECHECK_MS = 15 * 60_000;
const ERROR_RETRY_MS = 60 * 60_000;

type CfEnvelope<T> = {
  success: boolean;
  result: T;
  errors?: Array<{ code?: number; message: string }>;
};

type CfZone = {
  id: string;
  name: string;
  status: string;
  name_servers?: string[];
};
type CfUsage = { requests: number; failures: number };

type PlatformDomainRow = {
  domain_type: string;
  hostname_suffix: string;
  cloudflare_zone_id: string | null;
  cloudflare_dns_record_id: string | null;
  cloudflare_worker_route_id: string | null;
  setup_status: string;
};

function monthStart() {
  const chinaDate = new Date(Date.now() + 8 * 60 * 60_000).toISOString().slice(0, 7);
  return `${chinaDate}-01`;
}

async function recordCloudflareUsage(env: Env, usage: CfUsage) {
  if (!hasServiceSupabase(env)) return;
  const db = createServiceSupabase(env) as any;
  await db.rpc("increment_infrastructure_usage", {
    usage_month: monthStart(),
    cloudflare_requests_delta: usage.requests,
    cloudflare_failures_delta: usage.failures,
  });
}

async function cf<T>(env: Env, usage: CfUsage, path: string, init?: RequestInit): Promise<T> {
  usage.requests += 1;
  try {
    const response = await fetch(`${CF_API}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        "content-type": "application/json",
        ...init?.headers,
      },
    });
    const body = (await response.json()) as CfEnvelope<T>;
    if (!response.ok || !body.success) {
      throw new Error(body.errors?.map((item) => item.message).join("; ") || `Cloudflare API ${response.status}`);
    }
    return body.result;
  } catch (cause) {
    usage.failures += 1;
    throw cause;
  }
}

function assertConfigured(env: Env) {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_WORKER_SCRIPT) {
    throw new Error("Cloudflare 域名自动化缺少 ACCOUNT_ID、API_TOKEN 或 WORKER_SCRIPT 配置");
  }
  if (!hasServiceSupabase(env)) throw new Error("Supabase service role 未配置");
}

async function findOrCreateZone(env: Env, usage: CfUsage, hostname: string) {
  const query = new URLSearchParams({ name: hostname, "account.id": env.CLOUDFLARE_ACCOUNT_ID! });
  const existing = await cf<CfZone[]>(env, usage, `/zones?${query.toString()}`);
  if (existing[0]) return existing[0];
  return cf<CfZone>(env, usage, "/zones", {
    method: "POST",
    body: JSON.stringify({ name: hostname, account: { id: env.CLOUDFLARE_ACCOUNT_ID }, type: "full" }),
  });
}

async function ensureWildcardDns(env: Env, usage: CfUsage, zoneId: string, suffix: string, existingId: string | null) {
  if (existingId) return existingId;
  const name = `*.${suffix}`;
  const query = new URLSearchParams({ name, type: "A" });
  const records = await cf<Array<{ id: string }>>(env, usage, `/zones/${zoneId}/dns_records?${query.toString()}`);
  if (records[0]) return records[0].id;
  const record = await cf<{ id: string }>(env, usage, `/zones/${zoneId}/dns_records`, {
    method: "POST",
    body: JSON.stringify({ type: "A", name, content: "192.0.2.1", proxied: true, ttl: 1, comment: "QingNest platform wildcard; traffic is handled by the Worker route" }),
  });
  return record.id;
}

async function ensureWildcardRoute(env: Env, usage: CfUsage, zoneId: string, suffix: string, existingId: string | null) {
  if (existingId) return existingId;
  const pattern = `*.${suffix}/*`;
  const routes = await cf<Array<{ id: string; pattern: string; script?: string }>>(env, usage, `/zones/${zoneId}/workers/routes`);
  const existing = routes.find((route) => route.pattern === pattern);
  if (existing) {
    if (existing.script !== env.CLOUDFLARE_WORKER_SCRIPT) {
      throw new Error(`${pattern} 已绑定到其他 Worker：${existing.script ?? "bypass"}`);
    }
    return existing.id;
  }
  const route = await cf<{ id: string }>(env, usage, `/zones/${zoneId}/workers/routes`, {
    method: "POST",
    body: JSON.stringify({ pattern, script: env.CLOUDFLARE_WORKER_SCRIPT }),
  });
  return route.id;
}

export async function provisionPlatformDomain(env: Env, domainType: string) {
  assertConfigured(env);
  const usage: CfUsage = { requests: 0, failures: 0 };
  const db = createServiceSupabase(env) as any;
  const { data: row, error } = await db.from("domain_pricing").select("*").eq("domain_type", domainType).single();
  if (error || !row) throw new Error(error?.message ?? "平台域名不存在");

  try {
    let zone: CfZone;
    if (row.cloudflare_zone_id) {
      zone = await cf<CfZone>(env, usage, `/zones/${row.cloudflare_zone_id}`);
    } else {
      zone = await findOrCreateZone(env, usage, row.hostname_suffix);
    }

    const base = {
      cloudflare_zone_id: zone.id,
      cloudflare_zone_status: zone.status,
      cloudflare_nameservers: zone.name_servers ?? [],
      setup_error: null,
      last_checked_at: new Date().toISOString(),
    };
    if (zone.status !== "active") {
      await db.from("domain_pricing").update({
        ...base,
        enabled: false,
        setup_status: "pending_nameservers",
        next_check_at: new Date(Date.now() + PENDING_RECHECK_MS).toISOString(),
      }).eq("domain_type", domainType);
      return getPlatformDomain(env, domainType);
    }

    await db.from("domain_pricing").update({ ...base, setup_status: "configuring" }).eq("domain_type", domainType);
    const dnsId = await ensureWildcardDns(env, usage, zone.id, row.hostname_suffix, row.cloudflare_dns_record_id);
    const routeId = await ensureWildcardRoute(env, usage, zone.id, row.hostname_suffix, row.cloudflare_worker_route_id);
    await Promise.all([
      db.from("domain_pricing").update({
        ...base,
        cloudflare_dns_record_id: dnsId,
        cloudflare_worker_route_id: routeId,
        setup_status: "active",
        enabled: true,
        setup_error: null,
        next_check_at: null,
      }).eq("domain_type", domainType),
      row.setup_status !== "active"
        ? db.from("audit_events").insert({ event_type: "admin.domain_pricing.cloudflare_ready", message: `平台域名 ${row.hostname_suffix} 已完成 Cloudflare 通配 DNS 与 Worker Route 配置` })
        : Promise.resolve(),
    ]);
    return getPlatformDomain(env, domainType);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Cloudflare 域名配置失败";
    await db.from("domain_pricing").update({
      enabled: false,
      setup_status: "error",
      setup_error: message.slice(0, 1000),
      last_checked_at: new Date().toISOString(),
      next_check_at: new Date(Date.now() + ERROR_RETRY_MS).toISOString(),
    }).eq("domain_type", domainType);
    throw new Error(message);
  } finally {
    if (usage.requests) await recordCloudflareUsage(env, usage).catch(() => undefined);
  }
}

async function getPlatformDomain(env: Env, domainType: string) {
  const db = createServiceSupabase(env) as any;
  const { data, error } = await db.from("domain_pricing").select("*").eq("domain_type", domainType).single();
  if (error) throw new Error(error.message);
  return data;
}

export async function syncPlatformDomains(env: Env) {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_WORKER_SCRIPT || !hasServiceSupabase(env)) return;
  const db = createServiceSupabase(env) as any;
  const { data } = await db.from("domain_pricing")
    .select("domain_type")
    .in("setup_status", ["pending_zone", "pending_nameservers", "configuring", "error"])
    .or(`next_check_at.is.null,next_check_at.lte.${new Date().toISOString()}`)
    .order("next_check_at", { ascending: true, nullsFirst: true })
    .limit(5);
  for (const row of data ?? []) {
    await provisionPlatformDomain(env, row.domain_type).catch(() => undefined);
  }
}
