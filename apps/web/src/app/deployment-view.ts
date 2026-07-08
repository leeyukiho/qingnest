import type { DeploymentScanIssue, DeploymentScanResult } from "@qingnest/shared/deployment/types";
import type { SiteDraft, UploadArchiveResult } from "@/lib/api";

export function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function getRiskLabel(level: DeploymentScanResult["riskLevel"]) {
  if (level === "high") return "高风险";
  if (level === "medium") return "需审核";
  return "低风险";
}

export function getStatusLabel(status: UploadArchiveResult["status"] | SiteDraft["status"]) {
  if (status === "active") return "已发布";
  if (status === "pending_review") return "待审核";
  if (status === "blocked") return "已阻止";
  return "草稿";
}

export function getIssueClass(issue: DeploymentScanIssue) {
  if (issue.severity === "error") return "border-rose-300/20 bg-rose-400/10 text-rose-100";
  if (issue.severity === "warning") return "border-amber-300/20 bg-amber-400/10 text-amber-100";
  return "border-cyan-300/20 bg-cyan-400/10 text-cyan-100";
}

export function hasBlockingScanIssues(scan: DeploymentScanResult | null) {
  return Boolean(scan?.issues.some((issue) => issue.severity === "error"));
}

export function getPlanDisplayName(planName: string) {
  if (planName === "free") return "免费版";
  if (planName === "starter") return "入门版";
  if (planName === "pro") return "专业版";
  return planName;
}

export function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}
