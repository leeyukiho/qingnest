import type { DeploymentScanIssue, DeploymentScanResult } from "@qingnest/shared/deployment/types";

type ApiResult<T> = {
  ok: boolean;
  data?: T;
  error?: string;
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";
let accessTokenProvider: (() => Promise<string | null>) | null = null;

export function setAccessTokenProvider(provider: (() => Promise<string | null>) | null) {
  accessTokenProvider = provider;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await accessTokenProvider?.();
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {})
    }
  });
  const payload = (await response.json()) as ApiResult<T>;

  if (!response.ok || !payload.ok) {
    throw new Error(payload.error ?? "请求失败");
  }

  return payload.data as T;
}

async function formRequest<T>(path: string, formData: FormData): Promise<T> {
  const token = await accessTokenProvider?.();
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: formData
  });
  const payload = (await response.json()) as ApiResult<T>;

  if (!response.ok || !payload.ok) {
    throw new Error(payload.error ?? "请求失败");
  }

  return payload.data as T;
}

export type SubdomainCheck = {
  available: boolean;
  normalized: string;
  requiresReview?: boolean;
  publicUrl?: string;
  reason?: string;
};

export type SiteDraft = {
  id: string;
  name: string;
  subdomain: string;
  publicUrl: string;
  status: "draft" | "pending_review" | "active";
};

export type UploadArchiveResult = {
  deploymentId: string;
  publicUrl: string;
  status: "active" | "pending_review" | "blocked";
  fileCount: number;
  totalBytes: number;
  riskLevel: DeploymentScanResult["riskLevel"];
  issues: DeploymentScanIssue[];
};

export type ApiHealth = {
  service: string;
  environment: string;
  supabaseConfigured: boolean;
};

export type AccountRole = "user" | "admin";

export type AccountProfile = {
  id: string;
  email: string;
  emailConfirmed: boolean;
  role: AccountRole;
  plan: string;
  createdAt: string;
};

export type AdminOverview = {
  users: number;
  sites: number;
  activeSites: number;
  pendingReviewSites: number;
  deployments: number;
};

export type SignUpConfirmationResult = {
  email: string;
  alreadySent: boolean;
  sentAt: string;
  expiresAt: string;
};

export async function getApiHealth() {
  return request<ApiHealth>("/api/health");
}

export async function signUpWithEmailPassword(input: {
  email: string;
  password: string;
  redirectTo: string;
}) {
  return request<SignUpConfirmationResult>("/api/auth/sign-up", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getCurrentAccount() {
  return request<AccountProfile>("/api/me");
}

export async function getAdminOverview() {
  return request<AdminOverview>("/api/admin/overview");
}

export async function checkSubdomain(subdomain: string) {
  const params = new URLSearchParams({ subdomain });
  return request<SubdomainCheck>(`/api/subdomains/check?${params}`);
}

export async function createSite(input: { name: string; subdomain: string }) {
  return request<SiteDraft>("/api/sites", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function createUploadSession(input: {
  siteId: string;
  scan: DeploymentScanResult;
}) {
  return request<{
    uploadSessionId: string;
    deploymentId: string;
    status: "uploading" | "pending_review" | "blocked";
  }>("/api/upload-sessions", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function uploadArchive(input: {
  uploadSessionId: string;
  deploymentId: string;
  archive: File;
}) {
  const formData = new FormData();
  formData.append("deploymentId", input.deploymentId);
  formData.append("archive", input.archive);

  return formRequest<UploadArchiveResult>(
    `/api/upload-sessions/${encodeURIComponent(input.uploadSessionId)}/archive`,
    formData
  );
}

export async function uploadFiles(input: {
  uploadSessionId: string;
  deploymentId: string;
  files: Array<{ file: File; path: string }>;
}) {
  const formData = new FormData();
  formData.append("deploymentId", input.deploymentId);

  for (const item of input.files) {
    formData.append("files", item.file, item.path);
    formData.append("paths", item.path);
  }

  return formRequest<UploadArchiveResult>(
    `/api/upload-sessions/${encodeURIComponent(input.uploadSessionId)}/files`,
    formData
  );
}


