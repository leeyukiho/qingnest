export type DeploymentFile = {
  path: string;
  size: number;
  contentType: string;
  sha256?: string;
};

export type DeploymentScanIssue = {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  path?: string;
};

export type DeploymentScanResult = {
  fileCount: number;
  totalBytes: number;
  entrypoint: string | null;
  likelySourceProject: boolean;
  suggestedOutputDirectory: string | null;
  spaFallbackRecommended: boolean;
  riskScore: number;
  riskLevel: "low" | "medium" | "high";
  issues: DeploymentScanIssue[];
  files: DeploymentFile[];
};

