import type { DeploymentScanIssue, DeploymentScanResult } from "@qingnest/shared/deployment/types";
import type { DeploymentSummary, SiteDraft, UploadArchiveResult } from "@/lib/api";

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

export function getStatusLabel(status: UploadArchiveResult["status"] | SiteDraft["status"] | DeploymentSummary["status"]) {
  if (status === "active") return "已发布";
  if (status === "pending_review") return "待审核";
  if (status === "blocked") return "已阻止";
  if (status === "uploading" || status === "scanning") return "处理中";
  if (status === "failed") return "失败";
  if (status === "superseded") return "历史版本";
  return "草稿";
}

export function getIssueClass(issue: DeploymentScanIssue) {
  if (issue.severity === "error") return "border-white/40 bg-black text-zinc-100";
  if (issue.severity === "warning") return "border-white/30 bg-black text-zinc-200";
  return "border-white/20 bg-black text-zinc-300";
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
