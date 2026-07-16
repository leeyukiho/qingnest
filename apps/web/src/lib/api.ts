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

export function clearAdminReadCaches() {
  adminOverviewCache = null;
  adminOverviewRequest = null;
  capacityCache = null;
  capacityRequest = null;
  notificationsCache = null;
  notificationsRequest = null;
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
  subscriptionExpiresAt: string | null;
  planConfig?: ReturnType<typeof import("@qingnest/shared/config/platform").getPlanConfig>;
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
  todayUsers: number;
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
export type AdminPlan = { key: string; label: string; enabled: boolean; monthly_price_cents: number; renewal_price_cents: number; max_sites: number; max_public_sites: number; max_storage_bytes: number; max_deployments_per_day: number; max_upload_sessions_per_hour: number; max_domains_per_site: number; max_site_bytes: number; max_files: number; custom_domain: boolean; password_protection: boolean; access_analytics: boolean; remove_branding: boolean; rollback: boolean; source_build: boolean; updated_at: string };
export type PublicPlan = AdminPlan;
export type AdminDomainPrice = { domain_type: string; label: string; hostname_suffix: string; price_cents: number; billing_period: "month" | "year" | "one_time"; monthly_price_cents: number; quarterly_price_cents: number; semiannual_price_cents: number; annual_price_cents: number; renewal_window_days: number; max_advance_months: number; enabled: boolean; cloudflare_zone_id: string | null; cloudflare_zone_status: string | null; cloudflare_nameservers: string[]; cloudflare_dns_record_id: string | null; cloudflare_worker_route_id: string | null; setup_status: "pending_zone" | "pending_nameservers" | "configuring" | "active" | "error"; setup_error: string | null; last_checked_at: string | null; next_check_at: string | null; updated_at: string };
export type PaymentOrder = { id: string; orderNo: string; type: "plan_subscription" | "domain_rental" | "domain_renewal"; status: "pending" | "payment_failed" | "paid" | "fulfilling" | "fulfilled" | "fulfillment_failed" | "expired" | "refund_pending" | "refunded" | "cancelled"; amountCents: number; actualAmountCents: number | null; productName: string; productSnapshot: unknown; expiresAt: string; paidAt: string | null; fulfilledAt: string | null; failureMessage: string | null; createdAt: string };
export type CheckoutResult = { orderId: string; orderNo: string; payUrl: string; expiresAt: string };
export type AdminPaymentOrder = { id: string; order_no: string; user_id: string; type: PaymentOrder["type"]; status: PaymentOrder["status"]; amount_cents: number; product_name: string; product_snapshot: unknown; provider_order_id: string | null; expires_at: string; paid_at: string | null; fulfilled_at: string | null; failure_message: string | null; created_at: string; updated_at: string };
export type NotificationItem = { id: string; title: string; body: string; audience: "all" | "user"; acknowledgedAt: string | null; createdAt: string };
export type AdminNotification = NotificationItem & { recipientEmail: string | null; createdByEmail: string };
export type CapacityMetricKey = "workerRequests" | "kvReads" | "kvWrites" | "r2StorageBytes" | "r2ClassA" | "r2ClassB" | "pagesDeployments" | "pagesProjects" | "resendEmailsDaily" | "resendEmailsMonthly";
export type ResendPlan = "free" | "pro" | "scale";
export type CapacityThresholds = Record<CapacityMetricKey, { warningPercent: number; criticalPercent: number }>;
export type CapacityDashboard = { settings: { stage: "free" | "workers_paid" | "workers_paid_stable" | "pages_pro"; resendPlan: ResendPlan; limits: Record<CapacityMetricKey, number>; thresholds: CapacityThresholds; notificationCooldownHours: number; updatedAt: string }; observed: Record<CapacityMetricKey, number>; acceleratedSites: number; sampledAt: string; providerSample: { available: boolean; sampledAt: string | null; error: string | null; intervalHours: number; includesAdminTraffic: boolean }; scopeNote: string; presets: Record<string, { label: string; limits: Record<CapacityMetricKey, number>; thresholds: CapacityThresholds }>; resendPresets: Record<ResendPlan, { label: string; limits: Pick<Record<CapacityMetricKey, number>, "resendEmailsDaily" | "resendEmailsMonthly"> }> };

const ADMIN_OVERVIEW_CACHE_MS = 5 * 60_000;
const CAPACITY_CACHE_MS = 2 * 60 * 60_000;
const NOTIFICATIONS_CACHE_MS = 5 * 60_000;
const PUBLIC_PLANS_CACHE_MS = 6 * 60 * 60_000;
const PUBLIC_PLANS_CACHE_KEY = "kuaipage:public-plans:v1";
let adminOverviewCache: { data: AdminOverview; expiresAt: number } | null = null;
let adminOverviewRequest: Promise<AdminOverview> | null = null;
let capacityCache: { data: CapacityDashboard; expiresAt: number } | null = null;
let capacityRequest: Promise<CapacityDashboard> | null = null;
let notificationsCache: { data: NotificationItem[]; expiresAt: number } | null = null;
let notificationsRequest: Promise<NotificationItem[]> | null = null;
let publicPlansRequest: Promise<PublicPlan[]> | null = null;

export type SignUpConfirmationResult = {
  email: string;
  alreadySent: boolean;
  sentAt: string;
  expiresAt: string;
};

export async function getApiHealth() {
  return request<ApiHealth>("/api/health");
}

export async function getPublicPlans() {
  if (typeof window !== "undefined") {
    try {
      const cached = JSON.parse(window.localStorage.getItem(PUBLIC_PLANS_CACHE_KEY) ?? "null") as { data: PublicPlan[]; expiresAt: number } | null;
      if (cached?.expiresAt && cached.expiresAt > Date.now() && Array.isArray(cached.data)) return cached.data;
    } catch {
      window.localStorage.removeItem(PUBLIC_PLANS_CACHE_KEY);
    }
  }
  if (publicPlansRequest) return publicPlansRequest;
  const pending = request<PublicPlan[]>("/api/plans").then((data) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PUBLIC_PLANS_CACHE_KEY, JSON.stringify({ data, expiresAt: Date.now() + PUBLIC_PLANS_CACHE_MS }));
    }
    return data;
  });
  publicPlansRequest = pending;
  try { return await pending; } finally { if (publicPlansRequest === pending) publicPlansRequest = null; }
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
  if (!force && adminOverviewRequest) return adminOverviewRequest;
  const pending = request<AdminOverview>("/api/admin/overview").then((data) => {
    adminOverviewCache = { data, expiresAt: Date.now() + ADMIN_OVERVIEW_CACHE_MS };
    return data;
  });
  adminOverviewRequest = pending;
  try { return await pending; } finally { if (adminOverviewRequest === pending) adminOverviewRequest = null; }
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
export const createAdminDomainPrice = (input: Pick<AdminDomainPrice, "domain_type" | "label" | "hostname_suffix" | "price_cents" | "billing_period" | "monthly_price_cents" | "quarterly_price_cents" | "semiannual_price_cents" | "annual_price_cents" | "renewal_window_days" | "max_advance_months" | "enabled">) => adminMutation<AdminDomainPrice>("/api/admin/domain-pricing", "POST", input);
export const deleteAdminDomainPrice = (type: string) => adminMutation(`/api/admin/domain-pricing/${encodeURIComponent(type)}`, "DELETE");
export const syncAdminDomainPrice = (type: string) => adminMutation<AdminDomainPrice>(`/api/admin/domain-pricing/${encodeURIComponent(type)}/sync`, "POST");
export const getAdminOrders = () => request<AdminPaymentOrder[]>("/api/admin/orders");
export const reconcileAdminOrder = (id: string) => request(`/api/admin/orders/${encodeURIComponent(id)}/reconcile`, { method: "POST", body: "{}" });
export const retryAdminOrder = (id: string) => request(`/api/admin/orders/${encodeURIComponent(id)}/retry`, { method: "POST", body: "{}" });
export const replaceAdminOrderDomain = (id: string, hostname: string) => request(`/api/admin/orders/${encodeURIComponent(id)}/replace-domain`, { method: "POST", body: JSON.stringify({ hostname }) });
export const refundAdminOrder = (id: string, reason: string, channelReference: string) => request(`/api/admin/orders/${encodeURIComponent(id)}/refund`, { method: "POST", body: JSON.stringify({ reason, channelReference }) });
export async function getNotifications(force = false) {
  if (!force && notificationsCache && notificationsCache.expiresAt > Date.now()) {
    return notificationsCache.data;
  }
  if (!force && notificationsRequest) return notificationsRequest;
  const pending = request<NotificationItem[]>("/api/notifications").then((data) => {
    notificationsCache = { data, expiresAt: Date.now() + NOTIFICATIONS_CACHE_MS };
    return data;
  });
  notificationsRequest = pending;
  try { return await pending; } finally { if (notificationsRequest === pending) notificationsRequest = null; }
}
export async function acknowledgeNotification(id: string) {
  const result = await request<{ acknowledgedAt: string }>(`/api/notifications/${encodeURIComponent(id)}/acknowledge`, { method: "POST" });
  if (notificationsCache) {
    notificationsCache = {
      ...notificationsCache,
      data: notificationsCache.data.map((item) => item.id === id ? { ...item, acknowledgedAt: result.acknowledgedAt } : item),
    };
  }
  return result;
}
export const getAdminNotifications = () => request<AdminNotification[]>("/api/admin/notifications");
export const createAdminNotification = (input: { title: string; body: string; audience: "all" | "user"; recipient?: string }) => adminMutation<AdminNotification>("/api/admin/notifications", "POST", input);
export async function getAdminCapacity(force = false) {
  if (!force && capacityCache && capacityCache.expiresAt > Date.now()) return capacityCache.data;
  if (!force && capacityRequest) return capacityRequest;
  const pending = request<CapacityDashboard>("/api/admin/capacity").then((data) => {
    capacityCache = { data, expiresAt: Date.now() + CAPACITY_CACHE_MS };
    return data;
  });
  capacityRequest = pending;
  try { return await pending; } finally { if (capacityRequest === pending) capacityRequest = null; }
}
export async function updateAdminCapacity(input: CapacityDashboard["settings"]) {
  const data = await adminMutation<CapacityDashboard>("/api/admin/capacity", "PATCH", input);
  capacityCache = { data, expiresAt: Date.now() + CAPACITY_CACHE_MS };
  return data;
}

export type PlatformDomainOption = Pick<AdminDomainPrice, "domain_type" | "label" | "hostname_suffix" | "price_cents" | "billing_period" | "monthly_price_cents" | "quarterly_price_cents" | "semiannual_price_cents" | "annual_price_cents" | "enabled">;
let platformDomainCatalogRequest: Promise<PlatformDomainOption[]> | null = null;
export const getPlatformDomainCatalog = () => {
  platformDomainCatalogRequest ??= request<PlatformDomainOption[]>("/api/domain-catalog");
  platformDomainCatalogRequest.catch(() => {
    platformDomainCatalogRequest = null;
  });
  return platformDomainCatalogRequest;
};

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
  expiresAt: string;
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

export async function rentPublicSlot(subdomain: string, hostnameSuffix?: string, durationMonths: 1 | 3 | 6 | 12 = 12) {
  const slot = await request<PublicSlot>("/api/public-slots/rent", {
    method: "POST",
    body: JSON.stringify({ subdomain, hostnameSuffix, durationMonths }),
  });
  publicSlotsCache = null;
  publicSlotsCachedAt = 0;
  subdomainCheckCache.delete(subdomain.trim().toLowerCase());
  notifyAccountChanged();
  return slot;
}

export const createPlanPayment = (planKey: string, durationMonths: 1 | 3 | 6 | 12 = 1) => request<CheckoutResult>("/api/orders/plan", { method: "POST", body: JSON.stringify({ planKey, durationMonths }) });
export const createDomainPayment = (hostname: string, hostnameSuffix: string, durationMonths: 1 | 3 | 6 | 12) => request<CheckoutResult>("/api/orders/domain", { method: "POST", body: JSON.stringify({ hostname, hostnameSuffix, durationMonths }) });
export const createDomainRenewalPayment = (domainId: string, durationMonths: 1 | 3 | 6 | 12) => request<CheckoutResult>("/api/orders/domain-renewal", { method: "POST", body: JSON.stringify({ domainId, durationMonths }) });
export const getOrders = () => request<PaymentOrder[]>("/api/orders");
export const getOrder = (id: string) => request<PaymentOrder>(`/api/orders/${encodeURIComponent(id)}`);
export const getOrderByNumber = (orderNo: string) => request<PaymentOrder>(`/api/orders?orderNo=${encodeURIComponent(orderNo)}`);
export const getDomainRenewalEligibility = (domainId: string) => request<{ eligible: boolean; reason: string | null; allowedDurations: Array<1 | 3 | 6 | 12>; renewalWindowDays?: number; maxAdvanceMonths?: number }>(`/api/domains/${encodeURIComponent(domainId)}/renewal-eligibility`);

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
