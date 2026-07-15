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

export async function recordPagesDeployment(env: Env, failed = false) {
  const db = createServiceSupabase(env) as any;
  const month = monthStart();
  const { data } = await db.from("infrastructure_usage_monthly").select("pages_deployments, pages_failures").eq("month_start", month).maybeSingle();
  await db.from("infrastructure_usage_monthly").upsert({ month_start: month, pages_deployments: Number(data?.pages_deployments ?? 0) + 1, pages_failures: Number(data?.pages_failures ?? 0) + (failed ? 1 : 0), updated_at: new Date().toISOString() });
}

export async function getCapacityDashboard(env: Env, user: AuthenticatedUser) {
  await assertAdmin(env, user);
  const db = createServiceSupabase(env) as any;
  const [{ data: settings }, { data: usage }, { data: acceleration }, { data: storedDeployments }, { data: monthlyDeployments }, { data: resendUsage }] = await Promise.all([
    db.from("infrastructure_capacity_settings").select("*").eq("id", true).single(),
    db.from("infrastructure_usage_monthly").select("*").eq("month_start", monthStart()).maybeSingle(),
    db.from("pages_accelerations").select("status, pages_project_name"),
    db.from("deployments").select("total_bytes").not("status", "in", '(failed,superseded)'),
    db.from("deployments").select("file_count").gte("created_at", monthStart()),
    db.from("resend_email_usage_daily").select("usage_date, sent_count").gte("usage_date", monthStart()),
  ]);
  const accelerated = (acceleration ?? []).filter((item: any) => item.status === "accelerated").length;
  const projects = (acceleration ?? []).filter((item: any) => item.pages_project_name).length;
  const resendEmailsDaily = Number((resendUsage ?? []).find((item: any) => item.usage_date === usageDate())?.sent_count ?? 0);
  const resendEmailsMonthly = (resendUsage ?? []).reduce((sum: number, item: any) => sum + Number(item.sent_count ?? 0), 0);
  const observed = {
    workerRequests: 0, kvReads: 0, kvWrites: 0,
    r2StorageBytes: (storedDeployments ?? []).reduce((sum: number, item: any) => sum + Number(item.total_bytes ?? 0), 0),
    r2ClassA: (monthlyDeployments ?? []).reduce((sum: number, item: any) => sum + Number(item.file_count ?? 0), 0),
    r2ClassB: 0, pagesDeployments: Number(usage?.pages_deployments ?? 0), pagesProjects: projects, resendEmailsDaily, resendEmailsMonthly,
  };
  const preset = capacityPresets[settings.stage as CapacityStage] ?? capacityPresets.workers_paid;
  const resendPlan = resendPresets[settings.resend_plan as ResendPlan] ? settings.resend_plan as ResendPlan : "free";
  const savedThresholds = settings.thresholds ?? thresholds(settings.warning_percent, settings.critical_percent);
  return { settings: { stage: settings.stage, resendPlan, limits: planLimits(settings.stage as CapacityStage, resendPlan), thresholds: { ...preset.thresholds, ...savedThresholds }, notificationCooldownHours: settings.notification_cooldown_hours, updatedAt: settings.updated_at }, observed, acceleratedSites: accelerated, sampledAt: new Date().toISOString(), presets: capacityPresets, resendPresets, scopeNote: "这里只展示可能触发套餐升级或按量账单的容量指标。Pages、R2 写入与 Resend 邮件来自平台记录；Worker、KV、R2 读取需接入 Cloudflare Analytics 后显示，未采集时为 0。Cloudflare API 请求与失败属于运行健康数据，不参与成本预警。Resend 付费版没有日发送上限，因此仅按月额度预警。" };
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
  return getCapacityDashboard(env, user);
}

export async function evaluateCapacityAlerts(env: Env) {
  const db = createServiceSupabase(env) as any;
  const [{ data: settings }, { data: usage }, { data: acceleration }, { data: storedDeployments }, { data: monthlyDeployments }, { data: resendUsage }] = await Promise.all([
    db.from("infrastructure_capacity_settings").select("*").eq("id", true).maybeSingle(),
    db.from("infrastructure_usage_monthly").select("*").eq("month_start", monthStart()).maybeSingle(),
    db.from("pages_accelerations").select("pages_project_name"),
    db.from("deployments").select("total_bytes").not("status", "in", '(failed,superseded)'),
    db.from("deployments").select("file_count").gte("created_at", monthStart()),
    db.from("resend_email_usage_daily").select("usage_date, sent_count").gte("usage_date", monthStart()),
  ]);
  if (!settings) return;
  const observed: Partial<CapacityLimits> = { r2StorageBytes: (storedDeployments ?? []).reduce((sum: number, item: any) => sum + Number(item.total_bytes ?? 0), 0), r2ClassA: (monthlyDeployments ?? []).reduce((sum: number, item: any) => sum + Number(item.file_count ?? 0), 0), pagesDeployments: Number(usage?.pages_deployments ?? 0), pagesProjects: (acceleration ?? []).filter((item: any) => item.pages_project_name).length, resendEmailsDaily: Number((resendUsage ?? []).find((item: any) => item.usage_date === usageDate())?.sent_count ?? 0), resendEmailsMonthly: (resendUsage ?? []).reduce((sum: number, item: any) => sum + Number(item.sent_count ?? 0), 0) };
  const cooldownMs = Number(settings.notification_cooldown_hours) * 3_600_000;
  const resendPlan = resendPresets[settings.resend_plan as ResendPlan] ? settings.resend_plan as ResendPlan : "free";
  const limits = planLimits(settings.stage as CapacityStage, resendPlan);
  for (const [key, value] of Object.entries(observed)) {
    const limit = Number(limits[key as keyof CapacityLimits] ?? 0);
    if (!limit) continue;
    const percent = Number(value) / limit * 100;
    const metricThreshold = settings.thresholds?.[key] ?? { warningPercent: settings.warning_percent, criticalPercent: settings.critical_percent };
    const severity = percent >= metricThreshold.criticalPercent ? "critical" : percent >= metricThreshold.warningPercent ? "warning" : null;
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
