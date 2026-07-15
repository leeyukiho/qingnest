import { createServiceSupabase } from "./supabase";
import type { AuthenticatedUser } from "./state";
import type { Env } from "./types";

export type CapacityStage = "workers_paid" | "workers_paid_stable" | "pages_pro";
export type CapacityLimits = Record<
  "workerRequests" | "kvReads" | "kvWrites" | "r2StorageBytes" | "r2ClassA" | "r2ClassB" | "pagesDeployments" | "pagesProjects",
  number
>;

export const capacityPresets: Record<CapacityStage, { label: string; limits: CapacityLimits; warningPercent: number; criticalPercent: number }> = {
  workers_paid: { label: "$5 起步期", warningPercent: 60, criticalPercent: 80, limits: { workerRequests: 10_000_000, kvReads: 10_000_000, kvWrites: 1_000_000, r2StorageBytes: 10_737_418_240, r2ClassA: 1_000_000, r2ClassB: 10_000_000, pagesDeployments: 500, pagesProjects: 85 } },
  workers_paid_stable: { label: "$5 稳定期", warningPercent: 70, criticalPercent: 90, limits: { workerRequests: 10_000_000, kvReads: 10_000_000, kvWrites: 1_000_000, r2StorageBytes: 10_737_418_240, r2ClassA: 1_000_000, r2ClassB: 10_000_000, pagesDeployments: 500, pagesProjects: 85 } },
  pages_pro: { label: "$5 + $25 扩容期", warningPercent: 70, criticalPercent: 90, limits: { workerRequests: 10_000_000, kvReads: 10_000_000, kvWrites: 1_000_000, r2StorageBytes: 10_737_418_240, r2ClassA: 1_000_000, r2ClassB: 10_000_000, pagesDeployments: 5_000, pagesProjects: 85 } },
};

async function assertAdmin(env: Env, user: AuthenticatedUser) {
  const db = createServiceSupabase(env) as any;
  const { data } = await db.from("profiles").select("role").eq("id", user.id).single();
  if (data?.role !== "admin") throw new Error("需要管理员权限");
}

function monthStart() { return new Date().toISOString().slice(0, 7) + "-01"; }

export async function recordPagesDeployment(env: Env, failed = false) {
  const db = createServiceSupabase(env) as any;
  const month = monthStart();
  const { data } = await db.from("infrastructure_usage_monthly").select("pages_deployments, pages_failures").eq("month_start", month).maybeSingle();
  await db.from("infrastructure_usage_monthly").upsert({ month_start: month, pages_deployments: Number(data?.pages_deployments ?? 0) + 1, pages_failures: Number(data?.pages_failures ?? 0) + (failed ? 1 : 0), updated_at: new Date().toISOString() });
}

export async function getCapacityDashboard(env: Env, user: AuthenticatedUser) {
  await assertAdmin(env, user);
  const db = createServiceSupabase(env) as any;
  const [{ data: settings }, { data: usage }, { data: acceleration }, { data: storedDeployments }, { data: monthlyDeployments }] = await Promise.all([
    db.from("infrastructure_capacity_settings").select("*").eq("id", true).single(),
    db.from("infrastructure_usage_monthly").select("*").eq("month_start", monthStart()).maybeSingle(),
    db.from("pages_accelerations").select("status, pages_project_name"),
    db.from("deployments").select("total_bytes").not("status", "in", '(failed,superseded)'),
    db.from("deployments").select("file_count").gte("created_at", monthStart()),
  ]);
  const accelerated = (acceleration ?? []).filter((item: any) => item.status === "accelerated").length;
  const projects = (acceleration ?? []).filter((item: any) => item.pages_project_name).length;
  const observed = {
    workerRequests: 0, kvReads: 0, kvWrites: 0,
    r2StorageBytes: (storedDeployments ?? []).reduce((sum: number, item: any) => sum + Number(item.total_bytes ?? 0), 0),
    r2ClassA: (monthlyDeployments ?? []).reduce((sum: number, item: any) => sum + Number(item.file_count ?? 0), 0),
    r2ClassB: 0, pagesDeployments: Number(usage?.pages_deployments ?? 0), pagesProjects: projects,
  };
  return { settings: { stage: settings.stage, limits: settings.limits, warningPercent: settings.warning_percent, criticalPercent: settings.critical_percent, notificationCooldownHours: settings.notification_cooldown_hours, updatedAt: settings.updated_at }, observed, acceleratedSites: accelerated, sampledAt: new Date().toISOString(), presets: capacityPresets, scopeNote: "Pages 与 R2 写入来自平台记录；Worker、KV、R2 读取需接入 Cloudflare Analytics 后显示，未采集时为 0。" };
}

export async function updateCapacitySettings(env: Env, user: AuthenticatedUser, input: any) {
  await assertAdmin(env, user);
  if (!capacityPresets[input.stage as CapacityStage]) throw new Error("容量阶段无效");
  const limits = Object.fromEntries(Object.keys(capacityPresets.workers_paid.limits).map((key) => [key, Math.max(1, Math.floor(Number(input.limits?.[key])))]));
  const warning = Math.floor(Number(input.warningPercent));
  const critical = Math.floor(Number(input.criticalPercent));
  if (!(warning > 0 && warning < critical && critical <= 100)) throw new Error("预警阈值必须满足 0 < 提醒 < 严重 <= 100");
  const db = createServiceSupabase(env) as any;
  await db.from("infrastructure_capacity_settings").upsert({ id: true, stage: input.stage, limits, warning_percent: warning, critical_percent: critical, notification_cooldown_hours: Math.min(720, Math.max(1, Math.floor(Number(input.notificationCooldownHours)))), updated_by: user.id, updated_at: new Date().toISOString() });
  return getCapacityDashboard(env, user);
}

export async function evaluateCapacityAlerts(env: Env) {
  const db = createServiceSupabase(env) as any;
  const [{ data: settings }, { data: usage }, { data: acceleration }, { data: storedDeployments }, { data: monthlyDeployments }] = await Promise.all([
    db.from("infrastructure_capacity_settings").select("*").eq("id", true).maybeSingle(),
    db.from("infrastructure_usage_monthly").select("*").eq("month_start", monthStart()).maybeSingle(),
    db.from("pages_accelerations").select("pages_project_name"),
    db.from("deployments").select("total_bytes").not("status", "in", '(failed,superseded)'),
    db.from("deployments").select("file_count").gte("created_at", monthStart()),
  ]);
  if (!settings) return;
  const observed: Partial<CapacityLimits> = { r2StorageBytes: (storedDeployments ?? []).reduce((sum: number, item: any) => sum + Number(item.total_bytes ?? 0), 0), r2ClassA: (monthlyDeployments ?? []).reduce((sum: number, item: any) => sum + Number(item.file_count ?? 0), 0), pagesDeployments: Number(usage?.pages_deployments ?? 0), pagesProjects: (acceleration ?? []).filter((item: any) => item.pages_project_name).length };
  const cooldownMs = Number(settings.notification_cooldown_hours) * 3_600_000;
  for (const [key, value] of Object.entries(observed)) {
    const limit = Number(settings.limits?.[key] ?? 0);
    if (!limit) continue;
    const percent = Number(value) / limit * 100;
    const severity = percent >= settings.critical_percent ? "critical" : percent >= settings.warning_percent ? "warning" : null;
    if (!severity) continue;
    const { data: prior } = await db.from("infrastructure_alert_state").select("severity, last_notified_at").eq("metric_key", key).maybeSingle();
    const escalated = severity === "critical" && prior?.severity !== "critical";
    if (prior && !escalated && Date.now() - Date.parse(prior.last_notified_at) < cooldownMs) continue;
    await Promise.all([
      db.from("infrastructure_alert_state").upsert({ metric_key: key, severity, last_percent: percent, last_notified_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
      db.from("audit_events").insert({ event_type: `infrastructure_capacity_${severity}`, risk_score: severity === "critical" ? 90 : 60, message: `${key} 已使用 ${Number(value).toLocaleString()} / ${limit.toLocaleString()}（${percent.toFixed(1)}%）；仅管理员审计可见。` }),
    ]);
  }
}
