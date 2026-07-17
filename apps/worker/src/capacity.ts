import { createServiceSupabase } from "./supabase";
import type { AuthenticatedUser } from "./state";
import type { Env } from "./types";

export type CapacityStage = "free" | "workers_paid" | "workers_paid_stable" | "pages_pro";
export type ResendPlan = "free" | "pro" | "scale";
export type CapacityLimits = Record<
  "workerRequests" | "kvReads" | "kvWrites" | "r2StorageBytes" | "r2ClassA" | "r2ClassB" | "pagesDeployments" | "pagesProjects" | "resendEmailsDaily" | "resendEmailsMonthly",
  number
>;
export type CapacityThresholds = Record<keyof CapacityLimits, { warningPercent: number; criticalPercent: number }>;

const capacityMetricKeys: Array<keyof CapacityLimits> = ["workerRequests", "kvReads", "kvWrites", "r2StorageBytes", "r2ClassA", "r2ClassB", "pagesDeployments", "pagesProjects", "resendEmailsDaily", "resendEmailsMonthly"];
const thresholds = (warningPercent: number, criticalPercent: number): CapacityThresholds => Object.fromEntries(
  capacityMetricKeys.map((key) => [key, { warningPercent, criticalPercent }]),
) as CapacityThresholds;

export const capacityPresets: Record<CapacityStage, { label: string; limits: CapacityLimits; thresholds: CapacityThresholds }> = {
  free: { label: "完全免费版", thresholds: thresholds(60, 80), limits: { workerRequests: 3_000_000, kvReads: 3_000_000, kvWrites: 30_000, r2StorageBytes: 10_737_418_240, r2ClassA: 1_000_000, r2ClassB: 10_000_000, pagesDeployments: 500, pagesProjects: 85, resendEmailsDaily: 100, resendEmailsMonthly: 3_000 } },
  workers_paid: { label: "$5 起步期", thresholds: thresholds(60, 80), limits: { workerRequests: 10_000_000, kvReads: 10_000_000, kvWrites: 1_000_000, r2StorageBytes: 10_737_418_240, r2ClassA: 1_000_000, r2ClassB: 10_000_000, pagesDeployments: 500, pagesProjects: 85, resendEmailsDaily: 100, resendEmailsMonthly: 3_000 } },
  workers_paid_stable: { label: "$5 稳定期", thresholds: thresholds(70, 90), limits: { workerRequests: 10_000_000, kvReads: 10_000_000, kvWrites: 1_000_000, r2StorageBytes: 10_737_418_240, r2ClassA: 1_000_000, r2ClassB: 10_000_000, pagesDeployments: 500, pagesProjects: 85, resendEmailsDaily: 100, resendEmailsMonthly: 3_000 } },
  pages_pro: { label: "$5 + $25 扩容期", thresholds: thresholds(70, 90), limits: { workerRequests: 10_000_000, kvReads: 10_000_000, kvWrites: 1_000_000, r2StorageBytes: 10_737_418_240, r2ClassA: 1_000_000, r2ClassB: 10_000_000, pagesDeployments: 5_000, pagesProjects: 85, resendEmailsDaily: 100, resendEmailsMonthly: 3_000 } },
};

export const resendPresets: Record<ResendPlan, { label: string; limits: Pick<CapacityLimits, "resendEmailsDaily" | "resendEmailsMonthly"> }> = {
  free: { label: "Free", limits: { resendEmailsDaily: 100, resendEmailsMonthly: 3_000 } },
  pro: { label: "Pro", limits: { resendEmailsDaily: 0, resendEmailsMonthly: 50_000 } },
  scale: { label: "Scale", limits: { resendEmailsDaily: 0, resendEmailsMonthly: 100_000 } },
};

function planLimits(stage: CapacityStage, resendPlan: ResendPlan): CapacityLimits {
  const capacity = capacityPresets[stage] ?? capacityPresets.workers_paid;
  const resend = resendPresets[resendPlan] ?? resendPresets.free;
  return { ...capacity.limits, ...resend.limits };
}

async function assertAdmin(env: Env, user: AuthenticatedUser) {
  const db = createServiceSupabase(env) as any;
  const { data } = await db.from("profiles").select("role").eq("id", user.id).single();
  if (data?.role !== "admin") throw new Error("需要管理员权限");
}

function usageDate() { return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10); }
function monthStart() { return usageDate().slice(0, 7) + "-01"; }

type ProviderMetric = "workerRequests" | "kvReads" | "kvWrites" | "r2StorageBytes" | "r2ClassA" | "r2ClassB";
type ProviderSample = Record<ProviderMetric, number>;

const providerColumns: Record<ProviderMetric, string> = {
  workerRequests: "worker_requests",
  kvReads: "kv_reads",
  kvWrites: "kv_writes",
  r2StorageBytes: "r2_storage_bytes",
  r2ClassA: "r2_class_a",
  r2ClassB: "r2_class_b",
};

const r2ClassAActions = new Set(["ListBuckets", "PutBucket", "ListObjects", "PutObject", "CopyObject", "CompleteMultipartUpload", "CreateMultipartUpload", "ListMultipartUploads", "ListParts", "UploadPart", "UploadPartCopy"]);
const r2ClassBActions = new Set(["HeadBucket", "HeadObject", "GetObject"]);

function sumGroups(groups: any[] | undefined) {
  return (groups ?? []).reduce((sum, group) => sum + Number(group.sum?.requests ?? 0), 0);
}

function sumActions(groups: any[] | undefined, actions: Set<string>) {
  return (groups ?? []).reduce((sum, group) => actions.has(String(group.dimensions?.actionType)) ? sum + Number(group.sum?.requests ?? 0) : sum, 0);
}

async function fetchCloudflareCapacity(env: Env): Promise<ProviderSample> {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_WORKER_SCRIPT) {
    throw new Error("Cloudflare Analytics credentials are not configured");
  }
  const now = new Date();
  const start = `${monthStart()}T00:00:00.000Z`;
  const query = `query Capacity($accountTag: string!, $start: Time!, $end: Time!, $startDate: Date!, $endDate: Date!, $scriptName: string!, $bucketName: string, $namespaceId: string) {
    viewer { accounts(filter: { accountTag: $accountTag }) {
      workersInvocationsAdaptive(limit: 10000, filter: { scriptName: $scriptName, datetime_geq: $start, datetime_leq: $end }) { sum { requests } }
      kvOperationsAdaptiveGroups(limit: 10000, filter: { namespaceId: $namespaceId, date_geq: $startDate, date_leq: $endDate }) { sum { requests } dimensions { actionType } }
      r2OperationsAdaptiveGroups(limit: 10000, filter: { bucketName: $bucketName, datetime_geq: $start, datetime_leq: $end }) { sum { requests } dimensions { actionType } }
      r2StorageAdaptiveGroups(limit: 1, filter: { bucketName: $bucketName, datetime_geq: $start, datetime_leq: $end }) { max { payloadSize metadataSize } }
    } }
  }`;
  const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { accountTag: env.CLOUDFLARE_ACCOUNT_ID, start, end: now.toISOString(), startDate: monthStart(), endDate: usageDate(), scriptName: env.CLOUDFLARE_WORKER_SCRIPT, bucketName: env.CLOUDFLARE_R2_BUCKET_NAME ?? null, namespaceId: env.CLOUDFLARE_KV_NAMESPACE_ID ?? null } }),
  });
  const body = await response.json() as any;
  if (!response.ok || body.errors?.length) throw new Error(body.errors?.[0]?.message ?? `Cloudflare Analytics returned ${response.status}`);
  const account = body.data?.viewer?.accounts?.[0];
  if (!account) throw new Error("Cloudflare Analytics returned no account data");
  const kv = account.kvOperationsAdaptiveGroups ?? [];
  const r2 = account.r2OperationsAdaptiveGroups ?? [];
  const storage = account.r2StorageAdaptiveGroups?.[0]?.max;
  return {
    workerRequests: sumGroups(account.workersInvocationsAdaptive),
    kvReads: sumActions(kv, new Set(["read"])),
    kvWrites: sumActions(kv, new Set(["write", "delete", "list"])),
    r2StorageBytes: Number(storage?.payloadSize ?? 0) + Number(storage?.metadataSize ?? 0),
    r2ClassA: sumActions(r2, r2ClassAActions),
    r2ClassB: sumActions(r2, r2ClassBActions),
  };
}

async function refreshProviderCapacity(env: Env, db: any) {
  const sampledAt = new Date().toISOString();
  try {
    const sample = await fetchCloudflareCapacity(env);
    const { error } = await db.from("infrastructure_usage_monthly").upsert({ month_start: monthStart(), ...Object.fromEntries(Object.entries(sample).map(([key, value]) => [providerColumns[key as ProviderMetric], value])), provider_sampled_at: sampledAt, provider_sample_error: null, updated_at: sampledAt });
    if (error) throw new Error(error.message);
    return sample;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.from("infrastructure_usage_monthly").upsert({ month_start: monthStart(), provider_sample_error: message.slice(0, 500), updated_at: sampledAt });
    return null;
  }
}

function providerObserved(usage: any): Pick<CapacityLimits, ProviderMetric> {
  return Object.fromEntries(Object.entries(providerColumns).map(([key, column]) => [key, Number(usage?.[column] ?? 0)])) as Pick<CapacityLimits, ProviderMetric>;
}

export async function recordPagesDeployment(env: Env, failed = false) {
  const db = createServiceSupabase(env) as any;
  const { error } = await db.rpc("increment_pages_deployment", { p_month_start: monthStart(), p_failed: failed });
  if (error) throw new Error(error.message);
}

export async function getCapacityDashboard(env: Env, user: AuthenticatedUser, adminVerified = false) {
  if (!adminVerified) await assertAdmin(env, user);
  const db = createServiceSupabase(env) as any;
  const { data: snapshot, error } = await db.rpc("get_capacity_snapshot", { p_month_start: monthStart(), p_usage_date: usageDate() });
  if (error) throw new Error(error.message);
  const settings = snapshot.settings;
  const usage = snapshot.usage;
  const accelerated = Number(snapshot.accelerated_sites ?? 0);
  const projects = Number(snapshot.pages_projects ?? 0);
  const resendEmailsDaily = Number(snapshot.resend_emails_daily ?? 0);
  const resendEmailsMonthly = Number(snapshot.resend_emails_monthly ?? 0);
  const observed = {
    ...providerObserved(usage),
    pagesDeployments: Number(usage?.pages_deployments ?? 0), pagesProjects: projects, resendEmailsDaily, resendEmailsMonthly,
  };
  const preset = capacityPresets[settings.stage as CapacityStage] ?? capacityPresets.workers_paid;
  const resendPlan = resendPresets[settings.resend_plan as ResendPlan] ? settings.resend_plan as ResendPlan : "free";
  const savedThresholds = settings.thresholds ?? thresholds(settings.warning_percent, settings.critical_percent);
  return { settings: { stage: settings.stage, resendPlan, limits: planLimits(settings.stage as CapacityStage, resendPlan), thresholds: { ...preset.thresholds, ...savedThresholds }, notificationCooldownHours: settings.notification_cooldown_hours, updatedAt: settings.updated_at }, observed, acceleratedSites: accelerated, sampledAt: usage?.provider_sampled_at ?? new Date().toISOString(), providerSample: { available: Boolean(usage?.provider_sampled_at), sampledAt: usage?.provider_sampled_at ?? null, error: usage?.provider_sample_error ?? null, intervalHours: 6, includesAdminTraffic: true }, presets: capacityPresets, resendPresets, scopeNote: "Worker、KV 与 R2 指标来自 Cloudflare GraphQL，每 6 小时最多采样一次；Pages 与 Resend 来自平台成功记录。所有账户级资源消耗均包含管理员操作产生的流量。供应商采样不可用时会明确显示状态，不会把 0 当成实时用量。" };
}

export async function updateCapacitySettings(env: Env, user: AuthenticatedUser, input: any) {
  await assertAdmin(env, user);
  if (!capacityPresets[input.stage as CapacityStage]) throw new Error("容量阶段无效");
  if (!resendPresets[input.resendPlan as ResendPlan]) throw new Error("Resend 套餐无效");
  const limits = planLimits(input.stage as CapacityStage, input.resendPlan as ResendPlan);
  const metricThresholds = Object.fromEntries(Object.keys(limits).map((key) => {
    const warningPercent = Math.floor(Number(input.thresholds?.[key]?.warningPercent));
    const criticalPercent = Math.floor(Number(input.thresholds?.[key]?.criticalPercent));
    if (!(warningPercent > 0 && warningPercent < criticalPercent && criticalPercent <= 100)) throw new Error(`${key} 阈值必须满足 0 < 提醒 < 严重 <= 100`);
    return [key, { warningPercent, criticalPercent }];
  }));
  const db = createServiceSupabase(env) as any;
  await db.from("infrastructure_capacity_settings").upsert({ id: true, stage: input.stage, resend_plan: input.resendPlan, limits, thresholds: metricThresholds, notification_cooldown_hours: Math.min(720, Math.max(1, Math.floor(Number(input.notificationCooldownHours)))), updated_by: user.id, updated_at: new Date().toISOString() });
  return getCapacityDashboard(env, user, true);
}

export async function evaluateCapacityAlerts(env: Env) {
  const db = createServiceSupabase(env) as any;
  await refreshProviderCapacity(env, db);
  const { data: snapshot, error: snapshotError } = await db.rpc("get_capacity_snapshot", { p_month_start: monthStart(), p_usage_date: usageDate() });
  if (snapshotError) throw new Error(snapshotError.message);
  const settings = snapshot.settings;
  const usage = snapshot.usage;
  if (!settings) return;
  const observed: Partial<CapacityLimits> = { ...providerObserved(usage), pagesDeployments: Number(usage?.pages_deployments ?? 0), pagesProjects: Number(snapshot.pages_projects ?? 0), resendEmailsDaily: Number(snapshot.resend_emails_daily ?? 0), resendEmailsMonthly: Number(snapshot.resend_emails_monthly ?? 0) };
  const cooldownMs = Number(settings.notification_cooldown_hours) * 3_600_000;
  const resendPlan = resendPresets[settings.resend_plan as ResendPlan] ? settings.resend_plan as ResendPlan : "free";
  const limits = planLimits(settings.stage as CapacityStage, resendPlan);
  const { data: priorRows, error: priorError } = await db.from("infrastructure_alert_state").select("metric_key, severity, last_notified_at").in("metric_key", Object.keys(observed));
  if (priorError) throw new Error(priorError.message);
  const priorByMetric = new Map<string, { severity: string; last_notified_at: string }>(
    (priorRows ?? []).map((row: any) => [row.metric_key, row]),
  );
  for (const [key, value] of Object.entries(observed)) {
    const limit = Number(limits[key as keyof CapacityLimits] ?? 0);
    if (!limit) continue;
    const percent = Number(value) / limit * 100;
    const metricThreshold = settings.thresholds?.[key] ?? { warningPercent: settings.warning_percent, criticalPercent: settings.critical_percent };
    const severity = percent >= metricThreshold.criticalPercent ? "critical" : percent >= metricThreshold.warningPercent ? "warning" : null;
    if (!severity) continue;
    const prior = priorByMetric.get(key);
    const escalated = severity === "critical" && prior?.severity !== "critical";
    if (prior && !escalated && Date.now() - Date.parse(prior.last_notified_at) < cooldownMs) continue;
    await Promise.all([
      db.from("infrastructure_alert_state").upsert({ metric_key: key, severity, last_percent: percent, last_notified_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
      db.from("audit_events").insert({ event_type: `infrastructure_capacity_${severity}`, risk_score: severity === "critical" ? 90 : 60, message: `${key} 已使用 ${Number(value).toLocaleString()} / ${limit.toLocaleString()}（${percent.toFixed(1)}%）；仅管理员审计可见。` }),
    ]);
  }
}
