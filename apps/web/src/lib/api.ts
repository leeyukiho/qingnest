import type {
  DeploymentScanIssue,
  DeploymentScanResult,
} from "@qingnest/shared/deployment/types";

type ApiResult<T> = {
  ok: boolean;
  data?: T;
  error?: string;
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";
let accessTokenProvider: (() => Promise<string | null>) | null = null;

export function setAccessTokenProvider(
  provider: (() => Promise<string | null>) | null,
) {
  accessTokenProvider = provider;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await accessTokenProvider?.();
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
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
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
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
  status: "draft" | "pending_review" | "active" | "blocked";
  visibility: "private" | "public";
};

export type ProjectSummary = SiteDraft & {
  createdAt: string;
  updatedAt: string;
};

export type DeploymentSummary = {
  id: string;
  version: number;
  status:
    | "uploading"
    | "scanning"
    | "active"
    | "failed"
    | "blocked"
    | "pending_review"
    | "superseded";
  fileCount: number;
  totalBytes: number;
  createdAt: string;
  activatedAt: string | null;
};

export type ProjectDetail = ProjectSummary & {
  deployments: DeploymentSummary[];
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
  usage: {
    sites: number;
    publicSites: number;
    storageBytes: number;
    deploymentsToday: number;
  };
};

const ACCOUNT_CHANGED_EVENT = "kuaipage:account-changed";
const READ_CACHE_TTL_MS = 60 * 1000;
let projectsCache: ProjectSummary[] | null = null;
let projectsCachedAt = 0;
const projectCache = new Map<string, ProjectDetail>();
const projectCachedAt = new Map<string, number>();
let publicSlotsCache: PublicSlot[] | null = null;
let publicSlotsCachedAt = 0;
const subdomainCheckCache = new Map<
  string,
  { expiresAt: number; request: Promise<SubdomainCheck> }
>();

function notifyAccountChanged() {
  window.dispatchEvent(new Event(ACCOUNT_CHANGED_EVENT));
}

function updateProjectCaches(project: ProjectDetail) {
  projectCache.set(project.id, project);
  projectCachedAt.set(project.id, Date.now());
  if (projectsCache) {
    const summary: ProjectSummary = project;
    projectsCache = [
      summary,
      ...projectsCache.filter((item) => item.id !== project.id),
    ];
  }
}

export function getCachedProjects() {
  return projectsCache;
}

export function getCachedProject(siteId: string) {
  return projectCache.get(siteId) ?? null;
}

export function getCachedPublicSlots() {
  return publicSlotsCache;
}

export function subscribeToAccountChanges(listener: () => void) {
  window.addEventListener(ACCOUNT_CHANGED_EVENT, listener);
  return () => window.removeEventListener(ACCOUNT_CHANGED_EVENT, listener);
}

export type AdminOverview = {
  users: number;
  sites: number;
  activeSites: number;
  pendingReviewSites: number;
  deployments: number;
  domains: number;
  blockedSites: number;
  storageBytes: number;
  recentUsers: Array<{ id: string; email: string; role: AccountRole; plan: string; createdAt: string }>;
  recentSites: Array<{ id: string; name: string; ownerEmail: string; status: "draft" | "active" | "pending_review" | "blocked" | "deleted"; createdAt: string; updatedAt: string }>;
  reviewDeployments: Array<{ id: string; siteId: string; siteName: string; version: number; status: DeploymentSummary["status"]; riskScore: number; fileCount: number; totalBytes: number; createdAt: string }>;
  auditEvents: Array<{ id: string; eventType: string; message: string; riskScore: number; createdAt: string }>;
  domainsList: AdminDomain[];
  plans: AdminPlan[];
  domainPricing: AdminDomainPrice[];
};
export type AdminDomain = { id: string; userId: string; ownerEmail: string; siteId: string | null; siteName: string | null; hostname: string; type: "platform_subdomain" | "custom_domain"; status: "active" | "pending_review" | "blocked" | "deleted"; createdAt: string };
export type AdminPlan = { key: string; label: string; enabled: boolean; monthly_price_cents: number; renewal_price_cents: number; max_sites: number; max_public_sites: number; max_storage_bytes: number; max_deployments_per_day: number; max_domains_per_site: number; custom_domain: boolean; password_protection: boolean; access_analytics: boolean; remove_branding: boolean; rollback: boolean; source_build: boolean; updated_at: string };
export type AdminDomainPrice = { domain_type: string; label: string; hostname_suffix: string; price_cents: number; billing_period: "month" | "year" | "one_time"; enabled: boolean; updated_at: string };

const ADMIN_OVERVIEW_CACHE_MS = 30_000;
let adminOverviewCache: { data: AdminOverview; expiresAt: number } | null = null;

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
    body: JSON.stringify(input),
  });
}

export async function getCurrentAccount() {
  return request<AccountProfile>("/api/me");
}

export async function getAdminOverview(force = false) {
  if (!force && adminOverviewCache && adminOverviewCache.expiresAt > Date.now()) {
    return adminOverviewCache.data;
  }
  const data = await request<AdminOverview>("/api/admin/overview");
  adminOverviewCache = { data, expiresAt: Date.now() + ADMIN_OVERVIEW_CACHE_MS };
  return data;
}

export async function createAdminPrivatePreview(siteId: string) {
  return request<{ url: string; expiresAt: string }>(
    `/api/admin/sites/${encodeURIComponent(siteId)}/preview`,
    { method: "POST" },
  );
}

export async function updateAdminUser(userId: string, input: { role?: AccountRole; plan?: string }) {
  const result = await request<AdminOverview["recentUsers"][number]>(`/api/admin/users/${encodeURIComponent(userId)}`, { method: "PATCH", body: JSON.stringify(input) });
  adminOverviewCache = null;
  return result;
}

export async function updateAdminSite(siteId: string, status: "draft" | "active" | "pending_review" | "blocked") {
  const result = await request<{ id: string; name: string; status: string }>(`/api/admin/sites/${encodeURIComponent(siteId)}`, { method: "PATCH", body: JSON.stringify({ status }) });
  adminOverviewCache = null;
  return result;
}
async function adminMutation<T>(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) { const result = await request<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }); adminOverviewCache = null; return result; }
export const createAdminDomain = (input: { userId: string; hostname: string; type: "platform_subdomain"; siteId?: string | null }) => adminMutation("/api/admin/domains", "POST", input);
export const updateAdminDomain = (id: string, input: { status?: "active" | "pending_review" | "blocked"; siteId?: string | null }) => adminMutation(`/api/admin/domains/${encodeURIComponent(id)}`, "PATCH", input);
export const deleteAdminDomain = (id: string) => adminMutation(`/api/admin/domains/${encodeURIComponent(id)}`, "DELETE");
export const updateAdminPlan = (key: string, input: Partial<AdminPlan>) => adminMutation(`/api/admin/plans/${encodeURIComponent(key)}`, "PATCH", input);
export const updateAdminDomainPrice = (type: AdminDomainPrice["domain_type"], input: Partial<AdminDomainPrice>) => adminMutation(`/api/admin/domain-pricing/${encodeURIComponent(type)}`, "PATCH", input);
export const createAdminDomainPrice = (input: Omit<AdminDomainPrice, "updated_at">) => adminMutation("/api/admin/domain-pricing", "POST", input);
export const deleteAdminDomainPrice = (type: string) => adminMutation(`/api/admin/domain-pricing/${encodeURIComponent(type)}`, "DELETE");

export type PlatformDomainOption = Pick<AdminDomainPrice, "domain_type" | "label" | "hostname_suffix" | "price_cents" | "billing_period" | "enabled">;
export const getPlatformDomainCatalog = () => request<PlatformDomainOption[]>("/api/domain-catalog");

export async function checkSubdomain(subdomain: string, hostnameSuffix?: string) {
  const normalized = subdomain.trim().toLowerCase();
  const cacheKey = `${normalized}.${hostnameSuffix ?? ""}`;
  const cached = subdomainCheckCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.request;

  if (subdomainCheckCache.size >= 100) {
    const oldestKey = subdomainCheckCache.keys().next().value;
    if (oldestKey) subdomainCheckCache.delete(oldestKey);
  }

  const params = new URLSearchParams({ subdomain: normalized });
  if (hostnameSuffix) params.set("suffix", hostnameSuffix);
  const pending = request<SubdomainCheck>(`/api/subdomains/check?${params}`);
  subdomainCheckCache.set(cacheKey, {
    expiresAt: Date.now() + 15_000,
    request: pending,
  });
  pending.catch(() => subdomainCheckCache.delete(cacheKey));
  return pending;
}

export async function createSite(input: { name: string }) {
  const site = await request<SiteDraft>("/api/sites", {
    method: "POST",
    body: JSON.stringify(input),
  });
  const now = new Date().toISOString();
  projectsCache = [
    { ...site, createdAt: now, updatedAt: now },
    ...(projectsCache ?? []),
  ];
  projectsCachedAt = Date.now();
  notifyAccountChanged();
  return site;
}

export type PublicSlot = {
  id: string;
  siteId: string | null;
  hostname: string;
  publicUrl: string;
  type: "platform_subdomain" | "custom_domain";
  status: "active" | "pending_review" | "blocked";
};

export async function listPublicSlots() {
  if (publicSlotsCache && Date.now() - publicSlotsCachedAt < READ_CACHE_TTL_MS)
    return publicSlotsCache;
  const slots = await request<PublicSlot[]>("/api/public-slots");
  publicSlotsCache = slots;
  publicSlotsCachedAt = Date.now();
  return slots;
}

export async function createPublicSlot(input: {
  siteId: string;
  subdomain: string;
}) {
  const slot = await request<PublicSlot>("/api/public-slots", {
    method: "POST",
    body: JSON.stringify(input),
  });
  publicSlotsCache = null;
  publicSlotsCachedAt = 0;
  subdomainCheckCache.delete(input.subdomain.trim().toLowerCase());
  if (projectsCache)
    projectsCache = projectsCache.map((project) =>
      project.id === input.siteId
        ? {
            ...project,
            subdomain: slot.hostname.split(".")[0] ?? slot.hostname,
            publicUrl: slot.publicUrl,
            visibility: "public",
          }
        : project,
    );
  projectCache.delete(input.siteId);
  projectCachedAt.delete(input.siteId);
  notifyAccountChanged();
  return slot;
}

export async function rentPublicSlot(subdomain: string, hostnameSuffix?: string) {
  const slot = await request<PublicSlot>("/api/public-slots/rent", {
    method: "POST",
    body: JSON.stringify({ subdomain, hostnameSuffix }),
  });
  publicSlotsCache = null;
  publicSlotsCachedAt = 0;
  subdomainCheckCache.delete(subdomain.trim().toLowerCase());
  notifyAccountChanged();
  return slot;
}

export async function switchPublicSlot(slotId: string, siteId: string | null) {
  const previousSiteId = publicSlotsCache?.find(
    (slot) => slot.id === slotId,
  )?.siteId;
  const slot = await request<PublicSlot>(
    `/api/public-slots/${encodeURIComponent(slotId)}`,
    { method: "PATCH", body: JSON.stringify({ siteId }) },
  );
  publicSlotsCache = null;
  publicSlotsCachedAt = 0;
  if (projectsCache) {
    projectsCache = projectsCache.map((project) => {
      if (project.id === previousSiteId && previousSiteId !== siteId)
        return {
          ...project,
          subdomain: "",
          publicUrl: "",
          visibility: "private",
        };
      if (project.id === siteId)
        return {
          ...project,
          subdomain: slot.hostname.split(".")[0] ?? slot.hostname,
          publicUrl: slot.publicUrl,
          visibility: "public",
        };
      return project;
    });
  }
  if (previousSiteId) {
    projectCache.delete(previousSiteId);
    projectCachedAt.delete(previousSiteId);
  }
  if (siteId) {
    projectCache.delete(siteId);
    projectCachedAt.delete(siteId);
  }
  notifyAccountChanged();
  return slot;
}

export async function createPrivatePreview(siteId: string) {
  return request<{ url: string; expiresAt: string }>(
    `/api/sites/${encodeURIComponent(siteId)}/preview`,
    { method: "POST" },
  );
}

export async function listProjects() {
  if (projectsCache && Date.now() - projectsCachedAt < READ_CACHE_TTL_MS)
    return projectsCache;
  const projects = await request<ProjectSummary[]>("/api/sites");
  projectsCache = projects;
  projectsCachedAt = Date.now();
  return projects;
}

export async function getProject(siteId: string) {
  const cached = projectCache.get(siteId);
  if (
    cached &&
    Date.now() - (projectCachedAt.get(siteId) ?? 0) < READ_CACHE_TTL_MS
  )
    return cached;
  const project = await request<ProjectDetail>(
    `/api/sites/${encodeURIComponent(siteId)}`,
  );
  updateProjectCaches(project);
  return project;
}

export async function updateProject(siteId: string, input: { name: string }) {
  const project = await request<ProjectDetail>(
    `/api/sites/${encodeURIComponent(siteId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
  updateProjectCaches(project);
  return project;
}

export async function deleteProject(siteId: string) {
  await request<{ id: string }>(`/api/sites/${encodeURIComponent(siteId)}`, {
    method: "DELETE",
  });
  projectsCache =
    projectsCache?.filter((project) => project.id !== siteId) ?? null;
  projectCache.delete(siteId);
  projectCachedAt.delete(siteId);
  publicSlotsCache = null;
  publicSlotsCachedAt = 0;
  notifyAccountChanged();
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
    body: JSON.stringify(input),
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

  const result = await formRequest<UploadArchiveResult>(
    `/api/upload-sessions/${encodeURIComponent(input.uploadSessionId)}/archive`,
    formData,
  );
  projectCache.clear();
  projectCachedAt.clear();
  notifyAccountChanged();
  return result;
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

  const result = await formRequest<UploadArchiveResult>(
    `/api/upload-sessions/${encodeURIComponent(input.uploadSessionId)}/files`,
    formData,
  );
  projectCache.clear();
  projectCachedAt.clear();
  notifyAccountChanged();
  return result;
}
