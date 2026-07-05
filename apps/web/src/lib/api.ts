import type { DeploymentScanResult } from "@qingnest/shared/deployment/types";

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


