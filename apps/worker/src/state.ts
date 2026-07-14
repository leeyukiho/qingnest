import { nanoid } from "nanoid";
import type { User } from "@supabase/supabase-js";
import { unzipSync } from "fflate";
import {
  getPlanConfig,
  getPublicSiteUrl,
  platformConfig,
  validateSubdomain,
} from "@qingnest/shared/config/platform";
import { getContentType } from "@qingnest/shared/deployment/mime";
import {
  prepareDeploymentFiles,
  type ScanInputFile,
} from "@qingnest/shared/deployment/scan";
import type {
  DeploymentScanIssue,
  DeploymentScanResult,
} from "@qingnest/shared/deployment/types";
import { getWorkerPlatformConfig } from "./platform";
import {
  createAuthSupabase,
  createServiceSupabase,
  hasAuthSupabase,
  hasServiceSupabase,
} from "./supabase";
import type { Database, ProfileRole } from "./supabase";
import type { DomainMapping, Env } from "./types";

type DraftSite = {
  id: string;
  name: string;
  subdomain: string;
  publicUrl: string;
  status: "draft" | "pending_review" | "active" | "blocked";
  visibility: "private" | "public";
};

export type ProjectSummary = DraftSite & {
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

export type PublicSlot = {
  id: string;
  siteId: string | null;
  hostname: string;
  publicUrl: string;
  type: "platform_subdomain" | "custom_domain";
  status: "active" | "pending_review" | "blocked";
};

type MemoryUploadSession = {
  siteId: string;
  deploymentId: string;
  subdomain: string;
  r2Prefix: string;
  status: "uploading" | "pending_review" | "blocked";
  spaFallbackEnabled: boolean;
  expiresAt: number;
};

type DeployableArchiveFile = ScanInputFile & {
  content: Uint8Array;
};

type PreparedDeployment = ReturnType<
  typeof prepareDeploymentFiles<DeployableArchiveFile>
>;

export type AuthenticatedUser = {
  id: string;
  email: string;
  emailConfirmed: boolean;
};

export type AccountProfile = {
  id: string;
  email: string;
  emailConfirmed: boolean;
  role: ProfileRole;
  plan: string;
  createdAt: string;
  usage: {
    sites: number;
    publicSites: number;
    storageBytes: number;
    deploymentsToday: number;
  };
};

export type AdminOverview = {
  users: number;
  sites: number;
  activeSites: number;
  pendingReviewSites: number;
  deployments: number;
  domains: number;
  blockedSites: number;
  storageBytes: number;
  recentUsers: Array<{
    id: string;
    email: string;
    role: ProfileRole;
    plan: string;
    createdAt: string;
  }>;
  recentSites: Array<{
    id: string;
    name: string;
    ownerEmail: string;
    status: Database["public"]["Tables"]["sites"]["Row"]["status"];
    createdAt: string;
    updatedAt: string;
  }>;
  reviewDeployments: Array<{
    id: string;
    siteId: string;
    siteName: string;
    version: number;
    status: Database["public"]["Tables"]["deployments"]["Row"]["status"];
    riskScore: number;
    fileCount: number;
    totalBytes: number;
    createdAt: string;
  }>;
  auditEvents: Array<{
    id: string;
    eventType: string;
    message: string;
    riskScore: number;
    createdAt: string;
  }>;
  domainsList: AdminDomain[];
  plans: AdminPlan[];
  domainPricing: AdminDomainPrice[];
};

export type AdminDomain = { id: string; userId: string; ownerEmail: string; siteId: string | null; siteName: string | null; hostname: string; type: "platform_subdomain" | "custom_domain"; status: "active" | "pending_review" | "blocked" | "deleted"; createdAt: string };
export type AdminPlan = Database["public"]["Tables"]["plan_catalog"]["Row"];
export type AdminDomainPrice = Database["public"]["Tables"]["domain_pricing"]["Row"];

export type SignUpConfirmationResult = {
  email: string;
  alreadySent: boolean;
  sentAt: string;
  expiresAt: string;
};

const SIGNUP_CONFIRMATION_TTL_SECONDS = 24 * 60 * 60;
const draftSites = new Map<string, DraftSite>();
const claimedSubdomains = new Set<string>();
const memoryUploadSessions = new Map<string, MemoryUploadSession>();
const subdomainAvailabilityCache = new Map<
  string,
  { expiresAt: number; request: Promise<SubdomainAvailability> }
>();
const SUBDOMAIN_AVAILABILITY_CACHE_MS = 15_000;
const textPreviewExtensions = new Set([
  ".html",
  ".htm",
  ".js",
  ".mjs",
  ".css",
  ".json",
  ".txt",
]);

function getSiteAssets(env: Env) {
  if (!env.SITE_ASSETS) {
    throw new Error("SITE_ASSETS R2 binding is not configured");
  }

  return env.SITE_ASSETS;
}

async function readDomainCache(env: Env, subdomain: string) {
  if (!env.DOMAIN_MAP) {
    return null;
  }

  return env.DOMAIN_MAP.get(subdomain).catch(() => null);
}

async function writeDomainCache(
  env: Env,
  subdomain: string,
  mapping: DomainMapping,
) {
  if (!env.DOMAIN_MAP) {
    return false;
  }

  try {
    await env.DOMAIN_MAP.put(subdomain, JSON.stringify(mapping));
    return true;
  } catch {
    return false;
  }
}

async function deleteDomainCache(env: Env, subdomain: string) {
  if (!env.DOMAIN_MAP) return false;
  try {
    await env.DOMAIN_MAP.delete(subdomain);
    return true;
  } catch {
    return false;
  }
}

function getSiteUrl(env: Env, subdomain: string) {
  return getPublicSiteUrl(subdomain, getWorkerPlatformConfig(env).domains);
}

function getDistributionHostname(env: Env, subdomain: string) {
  return new URL(getSiteUrl(env, subdomain)).hostname;
}

function extensionOf(path: string) {
  const index = path.lastIndexOf(".");
  return index >= 0 ? path.slice(index).toLowerCase() : "";
}

function decodePreview(path: string, bytes: Uint8Array) {
  if (!textPreviewExtensions.has(extensionOf(path))) {
    return undefined;
  }

  return new TextDecoder("utf-8", { fatal: false, ignoreBOM: false }).decode(
    bytes.slice(0, platformConfig.deployment.maxPreviewHtmlBytes),
  );
}

async function readDeployableArchive(archive: File) {
  if (!archive.name.toLowerCase().endsWith(".zip")) {
    throw new Error("请上传 ZIP 格式的静态站点压缩包");
  }

  if (archive.size > getPlanConfig("free").quotas.deployment.maxArchiveBytes) {
    throw new Error("ZIP 文件超过当前套餐限制");
  }

  let entries: Record<string, Uint8Array>;

  try {
    entries = unzipSync(new Uint8Array(await archive.arrayBuffer()));
  } catch {
    throw new Error("ZIP 解压失败，请确认文件有效");
  }

  const files: DeployableArchiveFile[] = [];

  for (const [path, content] of Object.entries(entries)) {
    if (path.endsWith("/")) {
      continue;
    }

    files.push({
      path,
      size: content.byteLength,
      text: decodePreview(path, content),
      content,
    });
  }

  return prepareDeploymentFiles(files, "free");
}

async function readDeployableFiles(files: Array<{ file: File; path: string }>) {
  const deployableFiles: DeployableArchiveFile[] = await Promise.all(
    files.map(async ({ file, path }) => {
      const content = new Uint8Array(await file.arrayBuffer());

      return {
        path,
        size: content.byteLength,
        text: decodePreview(path, content),
        content,
      };
    }),
  );

  return prepareDeploymentFiles(deployableFiles, "free");
}

async function putDeploymentFiles(
  env: Env,
  r2Prefix: string,
  files: DeployableArchiveFile[],
) {
  const siteAssets = getSiteAssets(env);

  for (const file of files) {
    await siteAssets.put(`${r2Prefix}/${file.path}`, file.content, {
      httpMetadata: {
        contentType: getContentType(file.path),
      },
    });
  }
}

async function deleteDeploymentPrefix(env: Env, r2Prefix: string) {
  const siteAssets = getSiteAssets(env);
  let cursor: string | undefined;

  do {
    const result = await siteAssets.list({ prefix: `${r2Prefix}/`, cursor });
    const keys = result.objects.map((object) => object.key);
    if (keys.length > 0) await siteAssets.delete(keys);
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);
}

function createWelcomeFile(env: Env, siteId: string) {
  const platform = getWorkerPlatformConfig(env);
  const studioUrl = `${platform.domains.publicProtocol}://${platform.domains.appHost}/studio/projects/${siteId}`;
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>项目创建成功</title><style>html{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#fafafa;font:16px/1.6 system-ui,sans-serif;padding:24px}main{width:min(560px,100%);border:1px solid #27272a;border-radius:8px;padding:32px}h1{margin:0;font-size:28px}p{color:#a1a1aa;margin:12px 0 24px}a{display:inline-flex;padding:10px 16px;border-radius:6px;background:#fff;color:#000;text-decoration:none;font-weight:600}</style></head><body><main><h1>项目创建成功</h1><p>这个地址已经可以访问。返回轻巢上传你的项目资源并完成部署。</p><a href="${studioUrl}">返回轻巢</a></main></body></html>`;
  return new File([html], "index.html", { type: "text/html;charset=utf-8" });
}

async function publishWelcomePage(
  env: Env,
  siteId: string,
  user?: AuthenticatedUser,
) {
  const file = createWelcomeFile(env, siteId);
  const prepared = await readDeployableFiles([{ file, path: "index.html" }]);
  const session = await createUploadSession(env, {
    siteId,
    scan: prepared.scan,
    user,
  });

  if (session.status === "blocked") throw new Error("默认页面未通过发布检查");
  return completeFilesUpload(env, {
    uploadSessionId: session.uploadSessionId,
    deploymentId: session.deploymentId,
    files: [{ file, path: "index.html" }],
    user,
  });
}

function hasBlockingIssues(issues: DeploymentScanIssue[]) {
  return issues.some((issue) => issue.severity === "error");
}

function getBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");

  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function assertValidSignupEmail(email: string) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("请输入有效邮箱");
  }
}

function assertAllowedAuthRedirect(env: Env, redirectTo: string) {
  let url: URL;

  try {
    url = new URL(redirectTo);
  } catch {
    throw new Error("验证跳转地址无效");
  }

  const platform = getWorkerPlatformConfig(env);
  const appHost = platform.domains.appHost;
  const localDev =
    (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
    url.port === "5173";
  const allowedHost =
    url.hostname === appHost || localDev || url.hostname.endsWith(".pages.dev");

  if (!allowedHost || url.pathname !== "/auth") {
    throw new Error("验证跳转地址不被允许");
  }
}

function getSignUpErrorMessage(message: string) {
  if (/already registered|already exists/i.test(message)) {
    return "邮箱已注册，可直接登录。";
  }

  if (/rate limit|too many|over_email_send_rate_limit/i.test(message)) {
    return "验证邮件发送过于频繁，请稍后再试。";
  }

  return message;
}

function getResendFrom(env: Env) {
  const email = env.RESEND_FROM_EMAIL || "noreply@mail.985201314.xyz";
  const name = env.RESEND_FROM_NAME || "QingNest 轻巢";

  return `${name} <${email}>`;
}

function getSignupConfirmationHtml(input: {
  actionLink: string;
  expiresAt: string;
}) {
  const expiresAt = new Date(input.expiresAt).toLocaleString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    day: "2-digit",
  });

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>确认你的 QingNest 轻巢邮箱</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f7fb;color:#152033;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',Arial,sans-serif;">
    <div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;">点击确认邮箱，完成 QingNest 轻巢账号注册。</div>
    <main style="width:100%;max-width:640px;margin:0 auto;padding:32px 20px;">
      <section style="display:flex;align-items:center;gap:14px;margin-bottom:20px;">
        <div style="width:44px;height:44px;border-radius:12px;background:#0f766e;color:#fff;font-size:24px;font-weight:800;line-height:44px;text-align:center;">Q</div>
        <div>
          <p style="margin:0 0 4px;color:#0f766e;font-size:13px;font-weight:700;">QingNest 轻巢</p>
          <h1 style="margin:0;color:#0f172a;font-size:26px;line-height:32px;">确认邮箱，完成注册</h1>
        </div>
      </section>
      <section style="background:#fff;border:1px solid #dbe4ef;border-radius:18px;padding:28px;box-shadow:0 14px 36px rgba(15,23,42,.08);">
        <p style="margin:0 0 16px;font-size:16px;line-height:26px;">你好，</p>
        <p style="margin:0 0 24px;font-size:16px;line-height:28px;color:#334155;">欢迎注册 QingNest 轻巢。请先确认邮箱，然后再登录创建站点、上传文件和部署内容。</p>
        <a href="${input.actionLink}" style="display:inline-block;padding:13px 22px;border-radius:10px;background:#0f766e;color:#fff;font-size:15px;font-weight:700;text-decoration:none;">确认邮箱</a>
        <div style="margin-top:24px;padding:16px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;">
          <p style="margin:0 0 8px;color:#64748b;font-size:13px;font-weight:700;">安全提示</p>
          <p style="margin:0;color:#334155;font-size:14px;line-height:24px;">链接有效期到 ${expiresAt}，且只能使用一次。如果按钮无法打开，请复制下面的链接到浏览器。</p>
          <p style="margin:12px 0 0;color:#0f766e;font-size:13px;line-height:20px;word-break:break-all;">${input.actionLink}</p>
        </div>
        <p style="margin:24px 0 0;color:#64748b;font-size:13px;line-height:22px;">如果不是你本人注册，可以忽略这封邮件。</p>
      </section>
    </main>
  </body>
</html>`;
}

function getSignupConfirmationText(input: {
  actionLink: string;
  expiresAt: string;
}) {
  return [
    "确认你的 QingNest 轻巢邮箱",
    "",
    "欢迎注册 QingNest 轻巢。请打开下面的链接确认邮箱，然后再登录创建站点。",
    input.actionLink,
    "",
    `链接有效期到 ${new Date(input.expiresAt).toLocaleString("zh-CN")}，且只能使用一次。`,
    "如果不是你本人注册，可以忽略这封邮件。",
  ].join("\n");
}

async function sendSignupConfirmationEmail(
  env: Env,
  input: { email: string; actionLink: string; expiresAt: string },
) {
  if (!env.RESEND_API_KEY || env.RESEND_API_KEY.includes("replace-with")) {
    throw new Error("Resend API key 未配置");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: getResendFrom(env),
      to: [input.email],
      subject: "确认你的 QingNest 轻巢邮箱",
      html: getSignupConfirmationHtml(input),
      text: getSignupConfirmationText(input),
    }),
  });

  if (!response.ok) {
    let message = "验证邮件发送失败";

    try {
      const body = (await response.json()) as {
        message?: string;
        error?: string;
      };
      message = body.message ?? body.error ?? message;
    } catch {
      // Keep the generic error if Resend returns a non-JSON body.
    }

    throw new Error(message);
  }
}

async function clearSignupConfirmationSendLock(
  serviceSupabase: ReturnType<typeof createServiceSupabase>,
  email: string,
) {
  const { error } = await serviceSupabase
    .from("auth_email_sends")
    .delete()
    .eq("email", email)
    .eq("purpose", "signup_confirmation");

  if (error) {
    throw new Error(error.message);
  }
}

async function rollbackGeneratedSignup(
  serviceSupabase: ReturnType<typeof createServiceSupabase>,
  input: { email: string; userId?: string },
) {
  if (input.userId) {
    const { error } = await serviceSupabase.auth.admin.deleteUser(input.userId);

    if (error) {
      throw new Error(
        `验证邮件发送失败，且无法清理未完成注册用户：${error.message}`,
      );
    }
  }

  await clearSignupConfirmationSendLock(serviceSupabase, input.email);
}

function isAuthUserEmailConfirmed(user: User) {
  return Boolean(user.email_confirmed_at ?? user.confirmed_at);
}

async function findAuthUserByEmail(
  serviceSupabase: ReturnType<typeof createServiceSupabase>,
  email: string,
) {
  const perPage = 1000;

  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await serviceSupabase.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      throw new Error(error.message);
    }

    const user = data.users.find(
      (candidate) => normalizeEmail(candidate.email ?? "") === email,
    );

    if (user) return user;
    if (data.users.length < perPage) return null;
  }

  throw new Error("用户数量过多，无法确认邮箱状态");
}

async function updatePendingSignupPassword(
  serviceSupabase: ReturnType<typeof createServiceSupabase>,
  input: { email: string; password: string },
) {
  const user = await findAuthUserByEmail(serviceSupabase, input.email);

  if (!user) {
    await clearSignupConfirmationSendLock(serviceSupabase, input.email);
    throw new Error("验证记录已失效，请重新注册。");
  }

  if (isAuthUserEmailConfirmed(user)) {
    await clearSignupConfirmationSendLock(serviceSupabase, input.email);
    throw new Error("邮箱已注册，可直接登录。");
  }

  const { error } = await serviceSupabase.auth.admin.updateUserById(user.id, {
    password: input.password,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function signUpWithEmailPassword(
  env: Env,
  input: { email?: string; password?: string; redirectTo?: string },
): Promise<SignUpConfirmationResult> {
  if (!hasAuthSupabase(env)) {
    throw new Error("Supabase Auth 未配置");
  }

  const email = normalizeEmail(input.email ?? "");

  assertValidSignupEmail(email);

  if (!input.password || input.password.length < 6) {
    throw new Error("密码至少需要 6 位。");
  }

  if (!input.redirectTo) {
    throw new Error("缺少验证跳转地址");
  }

  assertAllowedAuthRedirect(env, input.redirectTo);

  const serviceSupabase = createServiceSupabase(env);
  const existingUser = await findAuthUserByEmail(serviceSupabase, email);

  if (existingUser && isAuthUserEmailConfirmed(existingUser)) {
    await clearSignupConfirmationSendLock(serviceSupabase, email);
    throw new Error("邮箱已注册，可直接登录。");
  }

  const { data: claims, error: claimError } = await serviceSupabase.rpc(
    "claim_signup_confirmation_email",
    {
      p_email: email,
      p_ttl_seconds: SIGNUP_CONFIRMATION_TTL_SECONDS,
    },
  );

  if (claimError) {
    throw new Error(claimError.message);
  }

  const claim = claims?.[0];

  if (!claim) {
    throw new Error("无法创建验证邮件发送记录");
  }

  if (!claim.claimed) {
    await updatePendingSignupPassword(serviceSupabase, {
      email,
      password: input.password,
    });

    return {
      email,
      alreadySent: true,
      sentAt: claim.sent_at,
      expiresAt: claim.expires_at,
    };
  }

  const { data: linkData, error: linkError } =
    await serviceSupabase.auth.admin.generateLink({
      type: "signup",
      email,
      password: input.password,
      options: {
        redirectTo: input.redirectTo,
      },
    });

  const actionLink = linkData.properties?.action_link;

  if (linkError || !actionLink) {
    await clearSignupConfirmationSendLock(serviceSupabase, email);

    throw new Error(
      getSignUpErrorMessage(linkError?.message ?? "无法生成邮箱验证链接"),
    );
  }

  try {
    await sendSignupConfirmationEmail(env, {
      email,
      actionLink,
      expiresAt: claim.expires_at,
    });
  } catch (sendError) {
    await rollbackGeneratedSignup(serviceSupabase, {
      email,
      userId: linkData.user?.id,
    });

    throw sendError;
  }

  return {
    email,
    alreadySent: false,
    sentAt: claim.sent_at,
    expiresAt: claim.expires_at,
  };
}

function assertEmailConfirmed(user: AuthenticatedUser) {
  if (!user.emailConfirmed) {
    throw new Error(
      "请先验证邮箱后再创建站点。注册验证邮件有效期为 24 小时，创建时不会重复发送。",
    );
  }
}

export async function getAuthenticatedUser(
  request: Request,
  env: Env,
  options: { requireEmailConfirmed?: boolean } = {},
): Promise<AuthenticatedUser> {
  const token = getBearerToken(request);

  if (!token) {
    throw new Error("请先登录后再继续");
  }

  if (!hasAuthSupabase(env)) {
    throw new Error("Supabase Auth 未配置");
  }

  const supabase = createAuthSupabase(env);
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    throw new Error("登录状态无效或已过期");
  }

  const emailConfirmed = Boolean(
    data.user.email_confirmed_at ?? data.user.confirmed_at,
  );

  if ((options.requireEmailConfirmed ?? true) && !emailConfirmed) {
    throw new Error("请先验证邮箱后再继续操作。注册验证邮件有效期为 24 小时。");
  }

  return {
    id: data.user.id,
    email: data.user.email ?? "",
    emailConfirmed,
  };
}

async function findDomainByHostname(env: Env, hostname: string) {
  const supabase = createServiceSupabase(env);
  const { data, error } = await supabase
    .from("domains")
    .select("id")
    .eq("hostname", hostname)
    .neq("status", "deleted")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

type SubdomainAvailability = {
  available: boolean;
  normalized: string;
  requiresReview?: boolean;
  publicUrl?: string;
  reason?: string;
  hostname?: string;
};

function invalidateSubdomainAvailability(subdomain: string) {
  for (const key of subdomainAvailabilityCache.keys()) {
    if (key.startsWith(`${subdomain.trim().toLowerCase()}.`))
      subdomainAvailabilityCache.delete(key);
  }
}

export async function checkSubdomainAvailability(
  env: Env,
  subdomain: string,
  hostnameSuffix?: string,
): Promise<SubdomainAvailability> {
  const validation = validateSubdomain(subdomain);

  if (!validation.ok) {
    return {
      available: false,
      normalized: validation.normalized,
      reason: validation.reason,
    };
  }

  const suffix = hostnameSuffix?.trim().toLowerCase().replace(/^\.+/, "");
  if (suffix && hasServiceSupabase(env)) {
    const supabase = createServiceSupabase(env);
    const { data } = await supabase.from("domain_pricing").select("hostname_suffix").eq("hostname_suffix", suffix).eq("enabled", true).maybeSingle();
    if (!data) return { available: false, normalized: validation.normalized, reason: "该平台域名暂不可选" };
  }
  const hostname = suffix ? `${validation.normalized}.${suffix}` : getDistributionHostname(env, validation.normalized);
  const cached = subdomainAvailabilityCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) return cached.request;

  if (subdomainAvailabilityCache.size >= 500) {
    const oldestKey = subdomainAvailabilityCache.keys().next().value;
    if (oldestKey) subdomainAvailabilityCache.delete(oldestKey);
  }

  const pending = (async (): Promise<SubdomainAvailability> => {
    const existing = hasServiceSupabase(env)
      ? await findDomainByHostname(env, hostname)
      : claimedSubdomains.has(validation.normalized)
        ? "claimed"
        : await readDomainCache(env, validation.normalized);

    return {
      available: !existing,
      normalized: validation.normalized,
      requiresReview: validation.requiresReview,
      publicUrl: getPublicUrlFromHostname(env, hostname),
      reason: existing ? "这个子域名已被占用" : undefined,
      hostname,
    };
  })();
  subdomainAvailabilityCache.set(hostname, {
    expiresAt: Date.now() + SUBDOMAIN_AVAILABILITY_CACHE_MS,
    request: pending,
  });
  pending.catch(() => subdomainAvailabilityCache.delete(hostname));
  return pending;
}

async function ensureProfile(env: Env, user: AuthenticatedUser) {
  const supabase = createServiceSupabase(env);
  const { error } = await supabase
    .from("profiles")
    .upsert({ id: user.id, email: user.email }, { onConflict: "id" });

  if (error) {
    throw new Error(error.message);
  }
}

export async function getAccountProfile(
  env: Env,
  user: AuthenticatedUser,
): Promise<AccountProfile> {
  await ensureProfile(env, user);

  const supabase = createServiceSupabase(env);
  const { data, error } = await supabase
    .from("profiles")
    .select("email, plan, role, created_at")
    .eq("id", user.id)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "账号资料不存在");
  }

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: sites, error: sitesError } = await supabase
    .from("sites")
    .select("id, active_deployment_id")
    .eq("user_id", user.id)
    .neq("status", "deleted");
  if (sitesError) throw new Error(sitesError.message);

  const siteIds = (sites ?? []).map((site) => site.id);
  const activeDeploymentIds = (sites ?? [])
    .map((site) => site.active_deployment_id)
    .filter((id): id is string => Boolean(id));
  const [
    { data: activeDeployments, error: storageError },
    { count: deploymentsToday, error: deploymentsError },
    { count: publicSites, error: publicSitesError },
  ] = await Promise.all([
    activeDeploymentIds.length > 0
      ? supabase
          .from("deployments")
          .select("total_bytes")
          .in("id", activeDeploymentIds)
      : Promise.resolve({ data: [], error: null }),
    siteIds.length > 0
      ? supabase
          .from("deployments")
          .select("id", { count: "exact", head: true })
          .in("site_id", siteIds)
          .gte("created_at", dayAgo)
      : Promise.resolve({ count: 0, error: null }),
    supabase
      .from("domains")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .neq("status", "deleted"),
  ]);
  const usageError = storageError ?? deploymentsError ?? publicSitesError;
  if (usageError) throw new Error(usageError.message);

  return {
    id: user.id,
    email: data.email || user.email,
    emailConfirmed: user.emailConfirmed,
    role: data.role,
    plan: data.plan,
    createdAt: data.created_at,
    usage: {
      sites: sites?.length ?? 0,
      publicSites: publicSites ?? 0,
      storageBytes: (activeDeployments ?? []).reduce(
        (total, deployment) => total + Number(deployment.total_bytes ?? 0),
        0,
      ),
      deploymentsToday: deploymentsToday ?? 0,
    },
  };
}

export async function getAdminOverview(
  env: Env,
  user: AuthenticatedUser,
): Promise<AdminOverview> {
  const supabase = createServiceSupabase(env);
  const { data, error } = await supabase.rpc("get_admin_overview", {
    p_admin_id: user.id,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("无法读取管理员数据");
  const [{ data: domains, error: domainsError }, { data: plans, error: plansError }, { data: pricing, error: pricingError }] = await Promise.all([
    (supabase as any).from("domains").select("id, user_id, site_id, hostname, type, status, created_at, profiles(email), sites(name)").neq("status", "deleted").order("created_at", { ascending: false }).limit(100),
    supabase.from("plan_catalog").select("*").order("monthly_price_cents"),
    supabase.from("domain_pricing").select("*").order("domain_type"),
  ]);
  if (domainsError || plansError || pricingError) throw new Error((domainsError ?? plansError ?? pricingError)!.message);
  const base = data as unknown as Omit<AdminOverview, "domainsList" | "plans" | "domainPricing">;
  return { ...base, domainsList: (domains ?? []).map((domain: any) => ({ id: domain.id, userId: domain.user_id, ownerEmail: domain.profiles?.email ?? "未知用户", siteId: domain.site_id, siteName: domain.sites?.name ?? null, hostname: domain.hostname, type: domain.type, status: domain.status, createdAt: domain.created_at })), plans: plans ?? [], domainPricing: pricing ?? [] };
}

async function requireAdmin(env: Env, user: AuthenticatedUser) {
  const account = await getAccountProfile(env, user);
  if (account.role !== "admin") throw new Error("需要管理员权限");
  return createServiceSupabase(env);
}

async function getEffectivePlanConfig(env: Env, planKey: string | null | undefined) {
  const fallback = getPlanConfig(planKey);
  const supabase = createServiceSupabase(env);
  const { data, error } = await supabase.from("plan_catalog").select("*").eq("key", planKey ?? "free").eq("enabled", true).maybeSingle();
  if (error || !data) return fallback;
  return {
    ...fallback,
    label: data.label,
    enabled: data.enabled,
    quotas: {
      ...fallback.quotas,
      user: { ...fallback.quotas.user, maxSites: data.max_sites, maxPublicSites: data.max_public_sites, maxStorageBytes: Number(data.max_storage_bytes), maxDeploymentsPerDay: data.max_deployments_per_day },
      site: { ...fallback.quotas.site, maxDomainsPerSite: data.max_domains_per_site },
    },
    capabilities: { customDomain: data.custom_domain, passwordProtection: data.password_protection, accessAnalytics: data.access_analytics, removeBranding: data.remove_branding, rollback: data.rollback, sourceBuild: data.source_build },
  };
}

export async function updateAdminUser(env: Env, user: AuthenticatedUser, input: { userId: string; role?: ProfileRole; plan?: string }) {
  const supabase = await requireAdmin(env, user);
  if (input.userId === user.id && input.role && input.role !== "admin") throw new Error("不能移除自己的管理员权限");
  const update: Database["public"]["Tables"]["profiles"]["Update"] = {};
  if (input.role) update.role = input.role;
  if (input.plan) update.plan = input.plan.trim().slice(0, 40);
  if (!Object.keys(update).length) throw new Error("没有可更新的字段");
  const { data, error } = await supabase.from("profiles").update(update).eq("id", input.userId).select("id, email, role, plan, created_at").single();
  if (error) throw new Error(error.message);
  await supabase.from("audit_events").insert({ user_id: user.id, event_type: "admin.user.updated", message: `管理员更新用户 ${data.email}：${data.role}/${data.plan}` });
  return { id: data.id, email: data.email, role: data.role, plan: data.plan, createdAt: data.created_at };
}

export async function updateAdminSite(env: Env, user: AuthenticatedUser, input: { siteId: string; status: "draft" | "active" | "pending_review" | "blocked" }) {
  const supabase = await requireAdmin(env, user);
  const { data, error } = await supabase.from("sites").update({ status: input.status, updated_at: new Date().toISOString() }).eq("id", input.siteId).neq("status", "deleted").select("id, name, status, active_deployment_id").single();
  if (error) throw new Error(error.message);
  const { data: domains } = await supabase.from("domains").select("hostname").eq("site_id", input.siteId).neq("status", "deleted");
  if (input.status === "blocked") {
    await supabase.from("domains").update({ status: "blocked" }).eq("site_id", input.siteId).neq("status", "deleted");
    await Promise.all((domains ?? []).map((domain) => deleteDomainCache(env, domain.hostname.split(".")[0] ?? domain.hostname)));
  } else if ((input.status === "active" || input.status === "pending_review") && data.active_deployment_id) {
    const domainStatus = input.status === "active" ? "active" : "pending_review";
    await supabase.from("domains").update({ status: domainStatus }).eq("site_id", input.siteId).neq("status", "deleted");
    const { data: deployment, error: deploymentError } = await supabase.from("deployments").select("id, r2_prefix, spa_fallback_enabled").eq("id", data.active_deployment_id).single();
    if (deploymentError) throw new Error(deploymentError.message);
    await Promise.all((domains ?? []).map((domain) => cachePublicSlot(env, { hostname: domain.hostname, status: domainStatus }, input.siteId, deployment)));
  }
  await supabase.from("audit_events").insert({ user_id: user.id, site_id: input.siteId, event_type: "admin.site.status_updated", message: `管理员将站点 ${data.name} 调整为 ${input.status}` });
  return { id: data.id, name: data.name, status: data.status };
}

export async function createAdminDomain(env: Env, user: AuthenticatedUser, input: { userId: string; hostname: string; type: "platform_subdomain" | "custom_domain"; siteId?: string | null }) {
  const supabase = await requireAdmin(env, user);
  const hostname = input.hostname.trim().toLowerCase();
  if (!hostname || !hostname.includes(".")) throw new Error("请输入完整域名");
  if (input.siteId) {
    const { data: site } = await supabase.from("sites").select("id, user_id").eq("id", input.siteId).eq("user_id", input.userId).neq("status", "deleted").maybeSingle();
    if (!site) throw new Error("项目不存在或不属于该用户");
  }
  const { data, error } = await supabase.from("domains").insert({ user_id: input.userId, site_id: input.siteId ?? null, hostname, type: input.type, status: "active" }).select("id, user_id, site_id, hostname, type, status, created_at").single();
  if (error?.code === "23505") throw new Error("该域名已存在");
  if (error || !data) throw new Error(error?.message ?? "域名创建失败");
  await supabase.from("audit_events").insert({ user_id: user.id, site_id: input.siteId ?? null, event_type: "admin.domain.created", message: `管理员新增域名 ${hostname}` });
  return data;
}

export async function updateAdminDomain(env: Env, user: AuthenticatedUser, input: { domainId: string; status?: "active" | "pending_review" | "blocked"; siteId?: string | null }) {
  const supabase = await requireAdmin(env, user);
  const { data: current } = await supabase.from("domains").select("hostname, user_id, site_id").eq("id", input.domainId).neq("status", "deleted").single();
  if (!current) throw new Error("域名不存在");
  if (input.siteId) {
    const { data: site } = await supabase.from("sites").select("id").eq("id", input.siteId).eq("user_id", current.user_id).neq("status", "deleted").maybeSingle();
    if (!site) throw new Error("只能绑定该域名所有者的项目");
  }
  const update: Database["public"]["Tables"]["domains"]["Update"] = {};
  if (input.status) update.status = input.status;
  if (input.siteId !== undefined) { update.site_id = input.siteId; update.last_binding_change_at = new Date().toISOString(); }
  const { data, error } = await supabase.from("domains").update(update).eq("id", input.domainId).select("id, hostname, status, site_id").single();
  if (error) throw new Error(error.message);
  await deleteDomainCache(env, current.hostname.split(".")[0] ?? current.hostname);
  await supabase.from("audit_events").insert({ user_id: user.id, site_id: input.siteId ?? current.site_id, event_type: "admin.domain.updated", message: `管理员更新域名 ${current.hostname}` });
  return data;
}

export async function deleteAdminDomain(env: Env, user: AuthenticatedUser, domainId: string) {
  const supabase = await requireAdmin(env, user);
  const { data, error } = await supabase.from("domains").update({ status: "deleted", site_id: null }).eq("id", domainId).neq("status", "deleted").select("id, hostname").single();
  if (error || !data) throw new Error(error?.message ?? "域名不存在");
  await deleteDomainCache(env, data.hostname.split(".")[0] ?? data.hostname);
  await supabase.from("audit_events").insert({ user_id: user.id, event_type: "admin.domain.deleted", message: `管理员删除域名 ${data.hostname}` });
  return { id: data.id };
}

export async function updateAdminPlan(env: Env, user: AuthenticatedUser, key: string, update: Database["public"]["Tables"]["plan_catalog"]["Update"]) {
  const supabase = await requireAdmin(env, user);
  delete update.key;
  const { data, error } = await supabase.from("plan_catalog").update({ ...update, updated_at: new Date().toISOString() }).eq("key", key).select("*").single();
  if (error) throw new Error(error.message);
  await supabase.from("audit_events").insert({ user_id: user.id, event_type: "admin.plan.updated", message: `管理员更新套餐 ${key}` });
  return data;
}

export async function updateAdminDomainPrice(env: Env, user: AuthenticatedUser, type: string, update: Database["public"]["Tables"]["domain_pricing"]["Update"]) {
  const supabase = await requireAdmin(env, user);
  delete update.domain_type;
  const { data, error } = await supabase.from("domain_pricing").update({ ...update, updated_at: new Date().toISOString() }).eq("domain_type", type).select("*").single();
  if (error) throw new Error(error.message);
  await supabase.from("audit_events").insert({ user_id: user.id, event_type: "admin.domain_pricing.updated", message: `管理员更新域名定价 ${type}` });
  return data;
}

export async function createAdminDomainPrice(env: Env, user: AuthenticatedUser, input: Database["public"]["Tables"]["domain_pricing"]["Insert"]) {
  const supabase = await requireAdmin(env, user);
  const suffix = input.hostname_suffix.trim().toLowerCase().replace(/^\.+/, "");
  if (!suffix.includes(".")) throw new Error("请输入完整的平台域名后缀");
  const key = input.domain_type.trim().toLowerCase();
  const { data, error } = await supabase.from("domain_pricing").insert({ ...input, domain_type: key, hostname_suffix: suffix }).select("*").single();
  if (error) throw new Error(error.code === "23505" ? "该平台域名已存在" : error.message);
  await supabase.from("audit_events").insert({ user_id: user.id, event_type: "admin.domain_pricing.created", message: `管理员新增平台域名 ${suffix}` });
  return data;
}

export async function deleteAdminDomainPrice(env: Env, user: AuthenticatedUser, type: string) {
  const supabase = await requireAdmin(env, user);
  const { data, error } = await supabase.from("domain_pricing").delete().eq("domain_type", type).select("hostname_suffix").single();
  if (error) throw new Error(error.message);
  await supabase.from("audit_events").insert({ user_id: user.id, event_type: "admin.domain_pricing.deleted", message: `管理员移除平台域名 ${data.hostname_suffix}` });
  return { domain_type: type };
}

async function getUserPlan(env: Env, user: AuthenticatedUser) {
  const supabase = createServiceSupabase(env);
  const { data, error } = await supabase
    .from("profiles")
    .select("plan")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data?.plan ?? "free";
}

async function assertSiteQuota(env: Env, user: AuthenticatedUser) {
  const supabase = createServiceSupabase(env);
  const plan = await getEffectivePlanConfig(env, await getUserPlan(env, user));
  const { count, error } = await supabase
    .from("sites")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .neq("status", "deleted");

  if (error) {
    throw new Error(error.message);
  }

  if ((count ?? 0) >= plan.quotas.user.maxSites) {
    throw new Error(`免费套餐最多创建 ${plan.quotas.user.maxSites} 个站点`);
  }
}

async function assertUploadSessionQuota(env: Env, user: AuthenticatedUser) {
  const supabase = createServiceSupabase(env);
  const plan = await getEffectivePlanConfig(env, await getUserPlan(env, user));
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const siteIds = await listUserSiteIds(env, user);

  const [
    { count: sessionsThisHour, error: sessionsError },
    { count: deploymentsToday, error: deploymentsError },
  ] = await Promise.all([
    supabase
      .from("upload_sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", hourAgo),
    supabase
      .from("deployments")
      .select("id", { count: "exact", head: true })
      .in(
        "site_id",
        siteIds.length > 0 ? siteIds : ["00000000-0000-0000-0000-000000000000"],
      )
      .gte("created_at", dayAgo),
  ]);

  if (sessionsError) {
    throw new Error(sessionsError.message);
  }

  if (deploymentsError) {
    throw new Error(deploymentsError.message);
  }

  if ((sessionsThisHour ?? 0) >= plan.quotas.user.maxUploadSessionsPerHour) {
    throw new Error(
      `免费套餐每小时最多创建 ${plan.quotas.user.maxUploadSessionsPerHour} 个上传会话`,
    );
  }

  if ((deploymentsToday ?? 0) >= plan.quotas.user.maxDeploymentsPerDay) {
    throw new Error(
      `免费套餐每天最多创建 ${plan.quotas.user.maxDeploymentsPerDay} 次部署`,
    );
  }
}

async function listUserSiteIds(env: Env, user: AuthenticatedUser) {
  const supabase = createServiceSupabase(env);
  const { data, error } = await supabase
    .from("sites")
    .select("id")
    .eq("user_id", user.id)
    .neq("status", "deleted");

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((site) => site.id);
}

async function assertStorageQuota(
  env: Env,
  user: AuthenticatedUser,
  siteId: string,
  nextDeploymentBytes: number,
) {
  const supabase = createServiceSupabase(env);
  const plan = await getEffectivePlanConfig(env, await getUserPlan(env, user));
  const siteIds = await listUserSiteIds(env, user);
  const [{ data, error }, { data: replacingSite, error: siteError }] =
    await Promise.all([
      supabase
        .from("deployments")
        .select("id, total_bytes")
        .in(
          "site_id",
          siteIds.length > 0
            ? siteIds
            : ["00000000-0000-0000-0000-000000000000"],
        )
        .neq("status", "blocked")
        .neq("status", "failed")
        .neq("status", "superseded"),
      supabase
        .from("sites")
        .select("active_deployment_id")
        .eq("id", siteId)
        .eq("user_id", user.id)
        .neq("status", "deleted")
        .maybeSingle(),
    ]);

  if (error) {
    throw new Error(error.message);
  }
  if (siteError || !replacingSite)
    throw new Error(siteError?.message ?? "项目不存在或无权访问");

  const usedBytes = (data ?? []).reduce(
    (total, deployment) =>
      deployment.id === replacingSite.active_deployment_id
        ? total
        : total + Number(deployment.total_bytes ?? 0),
    0,
  );

  if (usedBytes + nextDeploymentBytes > plan.quotas.user.maxStorageBytes) {
    throw new Error(
      `免费套餐总存储最多 ${Math.round(plan.quotas.user.maxStorageBytes / 1024 / 1024)} MB`,
    );
  }
}

function projectStatus(status: string): DraftSite["status"] {
  if (
    status === "active" ||
    status === "pending_review" ||
    status === "blocked"
  )
    return status;
  return "draft";
}

export async function listProjects(
  env: Env,
  user?: AuthenticatedUser,
): Promise<ProjectSummary[]> {
  if (!hasServiceSupabase(env)) {
    return Array.from(draftSites.values()).map((site) => ({
      ...site,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }));
  }

  if (!user) throw new Error("请先登录后再查看项目");
  const supabase = createServiceSupabase(env);
  const { data: sites, error } = await supabase
    .from("sites")
    .select("id, name, status, created_at, updated_at")
    .eq("user_id", user.id)
    .neq("status", "deleted")
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);
  const siteIds = (sites ?? []).map((site) => site.id);
  const { data: domains, error: domainError } = siteIds.length
    ? await supabase
        .from("domains")
        .select("site_id, hostname")
        .in("site_id", siteIds)
        .eq("type", "platform_subdomain")
        .neq("status", "deleted")
    : { data: [], error: null };
  if (domainError) throw new Error(domainError.message);
  const hostnames = new Map(
    (domains ?? []).map((domain) => [domain.site_id, domain.hostname]),
  );

  return (sites ?? []).map((site) => {
    const hostname = hostnames.get(site.id) ?? "";
    return {
      id: site.id,
      name: site.name,
      status: projectStatus(site.status),
      subdomain: hostname ? (hostname.split(".")[0] ?? hostname) : "",
      publicUrl: hostname ? getPublicUrlFromHostname(env, hostname) : "",
      visibility: hostname ? "public" : "private",
      createdAt: site.created_at,
      updatedAt: site.updated_at,
    };
  });
}

export async function getProject(
  env: Env,
  siteId: string,
  user?: AuthenticatedUser,
): Promise<ProjectDetail> {
  const project = (await listProjects(env, user)).find(
    (site) => site.id === siteId,
  );
  if (!project) throw new Error("项目不存在或无权访问");
  if (!hasServiceSupabase(env)) return { ...project, deployments: [] };

  const supabase = createServiceSupabase(env);
  const { data, error } = await supabase
    .from("deployments")
    .select(
      "id, version, status, file_count, total_bytes, created_at, activated_at",
    )
    .eq("site_id", siteId)
    .order("version", { ascending: false });
  if (error) throw new Error(error.message);

  return {
    ...project,
    deployments: (data ?? []).map((deployment) => ({
      id: deployment.id,
      version: deployment.version,
      status: deployment.status,
      fileCount: deployment.file_count,
      totalBytes: deployment.total_bytes,
      createdAt: deployment.created_at,
      activatedAt: deployment.activated_at,
    })),
  };
}

export async function updateProjectName(
  env: Env,
  siteId: string,
  name: string,
  user?: AuthenticatedUser,
) {
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error("项目名称不能为空");
  if (normalizedName.length > 80) throw new Error("项目名称不能超过 80 个字符");

  if (!hasServiceSupabase(env)) {
    const site = draftSites.get(siteId);
    if (!site) throw new Error("项目不存在或无权访问");
    draftSites.set(siteId, { ...site, name: normalizedName });
    return getProject(env, siteId, user);
  }

  if (!user) throw new Error("请先登录后再编辑项目");
  const supabase = createServiceSupabase(env);
  const { error } = await supabase
    .from("sites")
    .update({ name: normalizedName, updated_at: new Date().toISOString() })
    .eq("id", siteId)
    .eq("user_id", user.id)
    .neq("status", "deleted");
  if (error) throw new Error(error.message);
  return getProject(env, siteId, user);
}

export async function deleteProject(
  env: Env,
  siteId: string,
  user?: AuthenticatedUser,
) {
  if (!hasServiceSupabase(env)) {
    if (!draftSites.delete(siteId)) throw new Error("项目不存在或无权访问");
    return { id: siteId };
  }
  if (!user) throw new Error("请先登录后再删除项目");
  const supabase = createServiceSupabase(env);
  const { data: site, error: siteError } = await supabase
    .from("sites")
    .select("id")
    .eq("id", siteId)
    .eq("user_id", user.id)
    .neq("status", "deleted")
    .maybeSingle();
  if (siteError) throw new Error(siteError.message);
  if (!site) throw new Error("项目不存在或无权访问");
  const { data: domains, error: domainReadError } = await supabase
    .from("domains")
    .select("hostname")
    .eq("site_id", siteId)
    .eq("user_id", user.id)
    .neq("status", "deleted");
  if (domainReadError) throw new Error(domainReadError.message);
  const { error: domainError } = await supabase
    .from("domains")
    .update({ site_id: null, last_binding_change_at: new Date().toISOString() })
    .eq("site_id", siteId)
    .eq("user_id", user.id);
  if (domainError) throw new Error(domainError.message);
  await Promise.all((domains ?? []).map((domain) => deleteDomainCache(env, domain.hostname.split(".")[0] ?? domain.hostname)));
  const { error } = await supabase
    .from("sites")
    .update({
      status: "deleted",
      active_deployment_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", siteId)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);
  return { id: siteId };
}

export async function createDraftSite(
  env: Env,
  input: { name: string; user?: AuthenticatedUser },
) {
  if (hasServiceSupabase(env)) {
    if (!input.user) {
      throw new Error("请先登录后再创建站点");
    }

    assertEmailConfirmed(input.user);
    await ensureProfile(env, input.user);
    await assertSiteQuota(env, input.user);

    const supabase = createServiceSupabase(env);
    const { data: site, error: siteError } = await supabase
      .from("sites")
      .insert({
        user_id: input.user.id,
        name: input.name,
        status: "draft",
      })
      .select("id, name, status")
      .single();

    if (siteError) {
      throw new Error(siteError.message);
    }

    return {
      id: site.id,
      name: site.name,
      subdomain: "",
      publicUrl: "",
      status: "draft",
      visibility: "private",
    };
  }

  const site: DraftSite = {
    id: nanoid(),
    name: input.name,
    subdomain: "",
    publicUrl: "",
    status: "draft",
    visibility: "private",
  };

  draftSites.set(site.id, site);
  return site;
}

export async function listPublicSlots(
  env: Env,
  user: AuthenticatedUser,
): Promise<PublicSlot[]> {
  const supabase = createServiceSupabase(env);
  const { data, error } = await supabase
    .from("domains")
    .select("id, site_id, hostname, type, status")
    .eq("user_id", user.id)
    .neq("status", "deleted")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((domain) => ({
    id: domain.id,
    siteId: domain.site_id,
    hostname: domain.hostname,
    publicUrl: getPublicUrlFromHostname(env, domain.hostname),
    type: domain.type,
    status:
      domain.status === "blocked"
        ? "blocked"
        : domain.status === "pending_review"
          ? "pending_review"
          : "active",
  }));
}

async function getOwnedPublishableSite(
  env: Env,
  user: AuthenticatedUser,
  siteId: string,
) {
  const supabase = createServiceSupabase(env);
  const { data: site, error } = await supabase
    .from("sites")
    .select("id, active_deployment_id")
    .eq("id", siteId)
    .eq("user_id", user.id)
    .neq("status", "deleted")
    .single();
  if (error || !site) throw new Error("项目不存在或无权访问");
  if (!site.active_deployment_id)
    throw new Error("请先为项目发布一个版本，再将它设为公开");
  const { data: deployment, error: deploymentError } = await supabase
    .from("deployments")
    .select("id, r2_prefix, spa_fallback_enabled, status")
    .eq("id", site.active_deployment_id)
    .eq("site_id", site.id)
    .single();
  if (deploymentError || !deployment || deployment.status !== "active")
    throw new Error("项目当前没有可公开的有效版本");
  return { site, deployment };
}

async function cachePublicSlot(
  env: Env,
  domain: { hostname: string; status: string },
  siteId: string,
  deployment: { id: string; r2_prefix: string; spa_fallback_enabled: boolean },
) {
  const subdomain = domain.hostname.split(".")[0] ?? domain.hostname;
  await writeDomainCache(env, subdomain, {
    hostname: domain.hostname,
    siteId,
    deploymentId: deployment.id,
    r2Prefix: deployment.r2_prefix,
    spaFallbackEnabled: deployment.spa_fallback_enabled,
    status: domain.status === "pending_review" ? "pending_review" : "active",
  });
}

export async function createPublicSlot(
  env: Env,
  input: { siteId: string; subdomain: string; user: AuthenticatedUser },
) {
  const availability = await checkSubdomainAvailability(env, input.subdomain);
  if (!availability.available)
    throw new Error(availability.reason ?? "公开地址不可用");
  const plan = await getEffectivePlanConfig(env, await getUserPlan(env, input.user));
  const supabase = createServiceSupabase(env);
  const { count, error: countError } = await supabase
    .from("domains")
    .select("id", { count: "exact", head: true })
    .eq("user_id", input.user.id)
    .neq("status", "deleted");
  if (countError) throw new Error(countError.message);
  if ((count ?? 0) >= plan.quotas.user.maxPublicSites)
    throw new Error(
      `当前套餐最多同时公开 ${plan.quotas.user.maxPublicSites} 个项目`,
    );
  const { deployment } = await getOwnedPublishableSite(
    env,
    input.user,
    input.siteId,
  );
  const { data: domain, error } = await supabase
    .from("domains")
    .insert({
      user_id: input.user.id,
      site_id: input.siteId,
      hostname:
        availability.hostname ??
        getDistributionHostname(env, availability.normalized),
      type: "platform_subdomain",
      status: availability.requiresReview ? "pending_review" : "active",
      last_binding_change_at: new Date().toISOString(),
    })
    .select("id, site_id, hostname, type, status")
    .single();
  if (error || !domain) throw new Error(error?.message ?? "公开地址创建失败");
  invalidateSubdomainAvailability(availability.normalized);
  await cachePublicSlot(env, domain, input.siteId, deployment);
  return (await listPublicSlots(env, input.user)).find(
    (slot) => slot.id === domain.id,
  )!;
}

export async function rentPublicSlot(
  env: Env,
  input: { subdomain: string; hostnameSuffix?: string; user: AuthenticatedUser },
) {
  const availability = await checkSubdomainAvailability(env, input.subdomain, input.hostnameSuffix);
  if (!availability.available)
    throw new Error(availability.reason ?? "公开地址不可用");

  const supabase = createServiceSupabase(env);
  const { count, error: countError } = await supabase
    .from("domains")
    .select("id", { count: "exact", head: true })
    .eq("user_id", input.user.id)
    .neq("status", "deleted");
  if (countError) throw new Error(countError.message);
  if ((count ?? 0) >= 10)
    throw new Error("每个账户最多可保留 10 个平台地址");

  const { data: domain, error } = await supabase
    .from("domains")
    .insert({
      user_id: input.user.id,
      site_id: null,
      hostname:
        availability.hostname ??
        getDistributionHostname(env, availability.normalized),
      type: "platform_subdomain",
      status: availability.requiresReview ? "pending_review" : "active",
    })
    .select("id, site_id, hostname, type, status")
    .single();
  if (error?.code === "23505") throw new Error("这个子域名已被占用");
  if (error || !domain) throw new Error(error?.message ?? "平台地址租赁失败");
  invalidateSubdomainAvailability(availability.normalized);

  return (await listPublicSlots(env, input.user)).find(
    (slot) => slot.id === domain.id,
  )!;
}

export async function listPlatformDomainCatalog(env: Env) {
  const fallback = getWorkerPlatformConfig(env).domains.distributionRoot;
  if (!hasServiceSupabase(env)) return [{ domain_type: "platform_subdomain", label: fallback, hostname_suffix: fallback, price_cents: 990, billing_period: "year", enabled: true }];
  const supabase = createServiceSupabase(env);
  const { data, error } = await supabase.from("domain_pricing").select("domain_type, label, hostname_suffix, price_cents, billing_period, enabled").eq("enabled", true).order("price_cents");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function switchPublicSlot(
  env: Env,
  input: { slotId: string; siteId: string | null; user: AuthenticatedUser },
) {
  const supabase = createServiceSupabase(env);
  const { data: domain, error: domainError } = await supabase
    .from("domains")
    .select("id, hostname, status, site_id, last_binding_change_at")
    .eq("id", input.slotId)
    .eq("user_id", input.user.id)
    .neq("status", "deleted")
    .single();
  if (domainError || !domain) throw new Error("公开地址不存在或无权操作");
  if (domain.site_id === input.siteId)
    return (await listPublicSlots(env, input.user)).find(
      (slot) => slot.id === domain.id,
    )!;
  const cooldownMs = 10 * 60 * 1000;
  const lastChange = domain.last_binding_change_at
    ? Date.parse(domain.last_binding_change_at)
    : 0;
  if (lastChange && Date.now() - lastChange < cooldownMs) {
    const remainingMinutes = Math.max(
      1,
      Math.ceil((cooldownMs - (Date.now() - lastChange)) / 60_000),
    );
    throw new Error(
      `该平台地址刚刚发生过绑定变更，请 ${remainingMinutes} 分钟后再试`,
    );
  }
  if (!input.siteId) {
    const { error } = await supabase
      .from("domains")
      .update({
        site_id: null,
        last_binding_change_at: new Date().toISOString(),
      })
      .eq("id", domain.id)
      .eq("user_id", input.user.id);
    if (error) throw new Error(error.message);
    await deleteDomainCache(
      env,
      domain.hostname.split(".")[0] ?? domain.hostname,
    );
  } else {
    const { deployment } = await getOwnedPublishableSite(
      env,
      input.user,
      input.siteId,
    );
    const { error } = await supabase
      .from("domains")
      .update({
        site_id: input.siteId,
        last_binding_change_at: new Date().toISOString(),
      })
      .eq("id", domain.id)
      .eq("user_id", input.user.id);
    if (error) throw new Error(error.message);
    await cachePublicSlot(env, domain, input.siteId, deployment);
  }
  return (await listPublicSlots(env, input.user)).find(
    (slot) => slot.id === domain.id,
  )!;
}

export async function createPrivatePreview(
  env: Env,
  input: { siteId: string; user: AuthenticatedUser; origin: string },
) {
  if (!env.DOMAIN_MAP) throw new Error("私人预览服务尚未配置");
  const { deployment } = await getOwnedPublishableSite(
    env,
    input.user,
    input.siteId,
  );
  const token = nanoid(32);
  await env.DOMAIN_MAP.put(
    `preview:${token}`,
    JSON.stringify({
      siteId: input.siteId,
      deploymentId: deployment.id,
      r2Prefix: deployment.r2_prefix,
      spaFallbackEnabled: deployment.spa_fallback_enabled,
      status: "active",
    }),
    { expirationTtl: 600 },
  );
  return {
    url: `${input.origin}/preview/${token}/`,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  };
}

export async function createAdminPrivatePreview(
  env: Env,
  input: { siteId: string; user: AuthenticatedUser; origin: string },
) {
  if (!env.DOMAIN_MAP) throw new Error("私人预览服务尚未配置");
  const supabase = await requireAdmin(env, input.user);
  const { data: site, error: siteError } = await supabase.from("sites").select("id, active_deployment_id, status").eq("id", input.siteId).neq("status", "deleted").single();
  if (siteError || !site) throw new Error("项目不存在");
  if (!site.active_deployment_id) throw new Error("项目还没有可预览的部署");
  if (site.status === "blocked") throw new Error("已封禁项目不能预览");
  const { data: deployment, error: deploymentError } = await supabase.from("deployments").select("id, r2_prefix, spa_fallback_enabled").eq("id", site.active_deployment_id).eq("site_id", input.siteId).single();
  if (deploymentError || !deployment) throw new Error("找不到可预览的部署");
  const token = nanoid(32);
  await env.DOMAIN_MAP.put(`preview:${token}`, JSON.stringify({ siteId: input.siteId, deploymentId: deployment.id, r2Prefix: deployment.r2_prefix, spaFallbackEnabled: deployment.spa_fallback_enabled, status: "active" }), { expirationTtl: 600 });
  return { url: `${input.origin}/preview/${token}/`, expiresAt: new Date(Date.now() + 600_000).toISOString() };
}

export async function createUploadSession(
  env: Env,
  input: {
    siteId: string;
    scan: DeploymentScanResult;
    user?: AuthenticatedUser;
  },
) {
  if (hasServiceSupabase(env)) {
    if (!input.user) {
      throw new Error("请先登录后再创建上传会话");
    }

    assertEmailConfirmed(input.user);
    await ensureProfile(env, input.user);
    await assertUploadSessionQuota(env, input.user);
    await assertStorageQuota(
      env,
      input.user,
      input.siteId,
      input.scan.totalBytes,
    );

    return createPersistentUploadSession(env, {
      siteId: input.siteId,
      scan: input.scan,
      user: input.user,
    });
  }

  return createMemoryUploadSession(env, input);
}

async function createMemoryUploadSession(
  env: Env,
  input: { siteId: string; scan: DeploymentScanResult },
) {
  const site = draftSites.get(input.siteId);

  if (!site) {
    throw new Error("站点不存在或无权访问");
  }

  if (hasBlockingIssues(input.scan.issues)) {
    return {
      uploadSessionId: nanoid(),
      deploymentId: nanoid(),
      status: "blocked" as const,
    };
  }

  const deploymentId = nanoid();
  const uploadSessionId = nanoid();
  const status =
    input.scan.riskLevel !== "low" || site.status === "pending_review"
      ? "pending_review"
      : "uploading";
  memoryUploadSessions.set(uploadSessionId, {
    siteId: site.id,
    deploymentId,
    subdomain: site.subdomain,
    r2Prefix: `sites/${site.id}/deployments/${deploymentId}`,
    status,
    spaFallbackEnabled: input.scan.spaFallbackRecommended,
    expiresAt:
      Date.now() +
      getPlanConfig("free").quotas.deployment.uploadSessionTtlMinutes *
        60 *
        1000,
  });

  return {
    uploadSessionId,
    deploymentId,
    status,
  };
}

async function createPersistentUploadSession(
  env: Env,
  input: {
    siteId: string;
    scan: DeploymentScanResult;
    user: AuthenticatedUser;
  },
) {
  const supabase = createServiceSupabase(env);
  const { data: site, error: siteError } = await supabase
    .from("sites")
    .select("id, user_id, status")
    .eq("id", input.siteId)
    .eq("user_id", input.user.id)
    .neq("status", "deleted")
    .single();

  if (siteError || !site) {
    throw new Error("站点不存在或无权访问");
  }

  const hasBlockingIssues = input.scan.issues.some(
    (issue) => issue.severity === "error",
  );
  const deploymentStatus = hasBlockingIssues
    ? "blocked"
    : input.scan.riskLevel !== "low" || site.status === "pending_review"
      ? "pending_review"
      : "uploading";

  const { data: versionRows, error: versionError } = await supabase
    .from("deployments")
    .select("version")
    .eq("site_id", input.siteId)
    .order("version", { ascending: false })
    .limit(1);

  if (versionError) {
    throw new Error(versionError.message);
  }

  const nextVersion = (versionRows?.[0]?.version ?? 0) + 1;
  const deploymentId = crypto.randomUUID();
  const r2Prefix = `sites/${input.siteId}/deployments/${deploymentId}`;

  const { error: deploymentError } = await supabase.from("deployments").insert({
    id: deploymentId,
    site_id: input.siteId,
    version: nextVersion,
    status: deploymentStatus,
    r2_prefix: r2Prefix,
    file_count: input.scan.fileCount,
    total_bytes: input.scan.totalBytes,
    entrypoint: input.scan.entrypoint,
    spa_fallback_enabled: input.scan.spaFallbackRecommended,
    risk_score: input.scan.riskScore,
  });

  if (deploymentError) {
    throw new Error(deploymentError.message);
  }

  if (input.scan.files.length > 0) {
    const { error: filesError } = await supabase
      .from("deployment_files")
      .insert(
        input.scan.files.map((file) => ({
          deployment_id: deploymentId,
          path: file.path,
          size: file.size,
          content_type: file.contentType,
          sha256: file.sha256 ?? null,
        })),
      );

    if (filesError) {
      throw new Error(filesError.message);
    }
  }

  const uploadSessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const { error: sessionError } = await supabase
    .from("upload_sessions")
    .insert({
      id: uploadSessionId,
      site_id: input.siteId,
      user_id: input.user.id,
      status: hasBlockingIssues ? "blocked" : "created",
      expires_at: expiresAt,
    });

  if (sessionError) {
    throw new Error(sessionError.message);
  }

  await supabase.from("audit_events").insert({
    user_id: input.user.id,
    site_id: input.siteId,
    deployment_id: deploymentId,
    event_type: "upload_session.created",
    risk_score: input.scan.riskScore,
    message: `Created upload session for deployment ${deploymentId}`,
  });

  return {
    uploadSessionId,
    deploymentId,
    status: deploymentStatus,
  };
}

type UploadArchiveResult = {
  deploymentId: string;
  publicUrl: string;
  status: "active" | "pending_review" | "blocked";
  fileCount: number;
  totalBytes: number;
  riskLevel: DeploymentScanResult["riskLevel"];
  issues: DeploymentScanIssue[];
};

type UploadTarget = {
  siteId: string;
  deploymentId: string;
  subdomain: string;
  publicUrl: string;
  hostname: string;
  r2Prefix: string;
  status: "uploading" | "pending_review";
  spaFallbackEnabled: boolean;
};

function resultFromScan(
  target: UploadTarget,
  scan: DeploymentScanResult,
  status: UploadArchiveResult["status"],
): UploadArchiveResult {
  return {
    deploymentId: target.deploymentId,
    publicUrl: target.publicUrl,
    status,
    fileCount: scan.fileCount,
    totalBytes: scan.totalBytes,
    riskLevel: scan.riskLevel,
    issues: scan.issues,
  };
}

function getPublicUrlFromHostname(env: Env, hostname: string) {
  return `${getWorkerPlatformConfig(env).domains.publicProtocol}://${hostname}`;
}

async function getPersistentUploadTarget(
  env: Env,
  input: {
    uploadSessionId: string;
    deploymentId: string;
    user: AuthenticatedUser;
  },
): Promise<UploadTarget> {
  const supabase = createServiceSupabase(env);
  const { data: session, error: sessionError } = await supabase
    .from("upload_sessions")
    .select("id, site_id, user_id, status, expires_at")
    .eq("id", input.uploadSessionId)
    .eq("user_id", input.user.id)
    .single();

  if (sessionError || !session) {
    throw new Error("上传会话不存在或无权访问");
  }

  if (session.status === "blocked") {
    throw new Error("上传会话已被阻止");
  }

  if (Date.parse(session.expires_at) < Date.now()) {
    await supabase
      .from("upload_sessions")
      .update({ status: "expired" })
      .eq("id", input.uploadSessionId);
    throw new Error("上传会话已过期，请重新创建");
  }

  const { data: deployment, error: deploymentError } = await supabase
    .from("deployments")
    .select("id, site_id, status, r2_prefix, spa_fallback_enabled")
    .eq("id", input.deploymentId)
    .eq("site_id", session.site_id)
    .single();

  if (deploymentError || !deployment) {
    throw new Error("部署记录不存在或不属于当前上传会话");
  }

  if (
    deployment.status !== "uploading" &&
    deployment.status !== "pending_review"
  ) {
    throw new Error("当前部署状态不能继续上传");
  }

  return {
    siteId: session.site_id,
    deploymentId: deployment.id,
    subdomain: "",
    publicUrl: "",
    hostname: "",
    r2Prefix: deployment.r2_prefix,
    status: deployment.status,
    spaFallbackEnabled: deployment.spa_fallback_enabled,
  };
}

async function refreshDeploymentFiles(
  env: Env,
  deploymentId: string,
  scan: DeploymentScanResult,
) {
  const supabase = createServiceSupabase(env);
  const { error: deleteError } = await supabase
    .from("deployment_files")
    .delete()
    .eq("deployment_id", deploymentId);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  if (scan.files.length === 0) {
    return;
  }

  const { error: insertError } = await supabase.from("deployment_files").insert(
    scan.files.map((file) => ({
      deployment_id: deploymentId,
      path: file.path,
      size: file.size,
      content_type: file.contentType,
      sha256: file.sha256 ?? null,
    })),
  );

  if (insertError) {
    throw new Error(insertError.message);
  }
}

async function completePersistentDeploymentUpload(
  env: Env,
  input: {
    uploadSessionId: string;
    deploymentId: string;
    prepared: PreparedDeployment;
    user: AuthenticatedUser;
  },
): Promise<UploadArchiveResult> {
  const target = await getPersistentUploadTarget(env, input);
  const prepared = input.prepared;
  const supabase = createServiceSupabase(env);
  const { data: previousDeployments, error: previousDeploymentsError } =
    await supabase
      .from("deployments")
      .select("r2_prefix")
      .eq("site_id", target.siteId)
      .neq("id", target.deploymentId);

  if (previousDeploymentsError)
    throw new Error(previousDeploymentsError.message);

  if (hasBlockingIssues(prepared.scan.issues)) {
    await supabase
      .from("deployments")
      .update({ status: "blocked" })
      .eq("id", target.deploymentId);
    await supabase
      .from("upload_sessions")
      .update({ status: "blocked" })
      .eq("id", input.uploadSessionId);
    await supabase.from("audit_events").insert({
      user_id: input.user.id,
      site_id: target.siteId,
      deployment_id: target.deploymentId,
      event_type: "deployment.blocked",
      risk_score: prepared.scan.riskScore,
      message: "Server scan blocked the uploaded archive",
    });
    return resultFromScan(target, prepared.scan, "blocked");
  }

  await supabase
    .from("upload_sessions")
    .update({ status: "uploading" })
    .eq("id", input.uploadSessionId);
  await putDeploymentFiles(env, target.r2Prefix, prepared.files);
  await refreshDeploymentFiles(env, target.deploymentId, prepared.scan);

  const finalStatus =
    target.status === "pending_review" || prepared.scan.riskLevel !== "low"
      ? "pending_review"
      : "active";
  const activatedAt =
    finalStatus === "active" ? new Date().toISOString() : null;
  const { error: deploymentError } = await supabase
    .from("deployments")
    .update({
      status: finalStatus,
      file_count: prepared.scan.fileCount,
      total_bytes: prepared.scan.totalBytes,
      entrypoint: prepared.scan.entrypoint,
      spa_fallback_enabled: prepared.scan.spaFallbackRecommended,
      risk_score: prepared.scan.riskScore,
      activated_at: activatedAt,
    })
    .eq("id", target.deploymentId);

  if (deploymentError) {
    throw new Error(deploymentError.message);
  }

  if (finalStatus === "active") {
    const { error: siteError } = await supabase
      .from("sites")
      .update({
        status: "active",
        active_deployment_id: target.deploymentId,
      })
      .eq("id", target.siteId)
      .eq("user_id", input.user.id);

    if (siteError) {
      throw new Error(siteError.message);
    }
  }

  await supabase
    .from("upload_sessions")
    .update({ status: "completed" })
    .eq("id", input.uploadSessionId);
  await supabase.from("audit_events").insert({
    user_id: input.user.id,
    site_id: target.siteId,
    deployment_id: target.deploymentId,
    event_type:
      finalStatus === "active"
        ? "deployment.activated"
        : "deployment.pending_review",
    risk_score: prepared.scan.riskScore,
    message: `Deployment ${target.deploymentId} uploaded with status ${finalStatus}`,
  });

  const { data: boundDomains } = await supabase
    .from("domains")
    .select("hostname, status")
    .eq("site_id", target.siteId)
    .neq("status", "deleted");
  if (boundDomains?.[0]?.hostname)
    target.publicUrl = getPublicUrlFromHostname(env, boundDomains[0].hostname);
  await Promise.all(
    (boundDomains ?? []).map((domain) =>
      cachePublicSlot(env, domain, target.siteId, {
        id: target.deploymentId,
        r2_prefix: target.r2Prefix,
        spa_fallback_enabled: prepared.scan.spaFallbackRecommended,
      }),
    ),
  );
  if (finalStatus === "active") {
    const previous = previousDeployments ?? [];
    const cleanupResults = await Promise.allSettled(
      previous.map((deployment) =>
        deleteDeploymentPrefix(env, deployment.r2_prefix),
      ),
    );
    const cleanedPrefixes = previous
      .filter((_, index) => cleanupResults[index]?.status === "fulfilled")
      .map((deployment) => deployment.r2_prefix);
    if (cleanedPrefixes.length > 0) {
      await supabase
        .from("deployments")
        .update({ status: "superseded" })
        .eq("site_id", target.siteId)
        .neq("id", target.deploymentId)
        .in("r2_prefix", cleanedPrefixes);
    }
  }
  return resultFromScan(target, prepared.scan, finalStatus);
}

async function completeMemoryDeploymentUpload(
  env: Env,
  input: {
    uploadSessionId: string;
    deploymentId: string;
    prepared: PreparedDeployment;
  },
): Promise<UploadArchiveResult> {
  const session = memoryUploadSessions.get(input.uploadSessionId);

  if (!session || session.deploymentId !== input.deploymentId) {
    throw new Error("上传会话不存在或无权访问");
  }

  if (session.expiresAt < Date.now()) {
    memoryUploadSessions.delete(input.uploadSessionId);
    throw new Error("上传会话已过期，请重新创建");
  }

  const site = draftSites.get(session.siteId);

  if (!site) {
    throw new Error("站点不存在或无权访问");
  }

  const target: UploadTarget = {
    siteId: session.siteId,
    deploymentId: session.deploymentId,
    subdomain: session.subdomain,
    publicUrl: getSiteUrl(env, session.subdomain),
    hostname: getDistributionHostname(env, session.subdomain),
    r2Prefix: session.r2Prefix,
    status:
      session.status === "pending_review" ? "pending_review" : "uploading",
    spaFallbackEnabled: session.spaFallbackEnabled,
  };
  const prepared = input.prepared;

  if (hasBlockingIssues(prepared.scan.issues)) {
    session.status = "blocked";
    return resultFromScan(target, prepared.scan, "blocked");
  }

  await putDeploymentFiles(env, target.r2Prefix, prepared.files);

  const finalStatus =
    target.status === "pending_review" || prepared.scan.riskLevel !== "low"
      ? "pending_review"
      : "active";
  site.status = finalStatus === "active" ? "active" : "pending_review";

  const mapping: DomainMapping = {
    hostname: target.hostname,
    siteId: target.siteId,
    deploymentId: target.deploymentId,
    r2Prefix: target.r2Prefix,
    spaFallbackEnabled: prepared.scan.spaFallbackRecommended,
    status: finalStatus,
  };

  const cached = await writeDomainCache(env, target.subdomain, mapping);

  if (!cached && !hasServiceSupabase(env)) {
    throw new Error("DOMAIN_MAP KV binding is not configured");
  }

  memoryUploadSessions.delete(input.uploadSessionId);

  return resultFromScan(target, prepared.scan, finalStatus);
}

async function completeDeploymentUpload(
  env: Env,
  input: {
    uploadSessionId: string;
    deploymentId: string;
    prepared: PreparedDeployment;
    user?: AuthenticatedUser;
  },
) {
  if (hasServiceSupabase(env)) {
    if (!input.user) {
      throw new Error("请先登录后再上传站点文件");
    }

    assertEmailConfirmed(input.user);
    return completePersistentDeploymentUpload(env, {
      uploadSessionId: input.uploadSessionId,
      deploymentId: input.deploymentId,
      prepared: input.prepared,
      user: input.user,
    });
  }

  return completeMemoryDeploymentUpload(env, input);
}

export async function completeArchiveUpload(
  env: Env,
  input: {
    uploadSessionId: string;
    deploymentId: string;
    archive: File;
    user?: AuthenticatedUser;
  },
) {
  return completeDeploymentUpload(env, {
    uploadSessionId: input.uploadSessionId,
    deploymentId: input.deploymentId,
    prepared: await readDeployableArchive(input.archive),
    user: input.user,
  });
}

export async function completeFilesUpload(
  env: Env,
  input: {
    uploadSessionId: string;
    deploymentId: string;
    files: Array<{ file: File; path: string }>;
    user?: AuthenticatedUser;
  },
) {
  return completeDeploymentUpload(env, {
    uploadSessionId: input.uploadSessionId,
    deploymentId: input.deploymentId,
    prepared: await readDeployableFiles(input.files),
    user: input.user,
  });
}

async function provisionLegacyWelcomeDeployment(
  env: Env,
  domain: { hostname: string; site_id: string; status: string },
  site: {
    active_deployment_id: string | null;
    status: string;
    user_id: string;
  },
) {
  if (
    site.active_deployment_id ||
    domain.status !== "active" ||
    site.status === "blocked"
  ) {
    return null;
  }

  const supabase = createServiceSupabase(env);
  const file = createWelcomeFile(env, domain.site_id);
  const content = new Uint8Array(await file.arrayBuffer());
  const deploymentId = crypto.randomUUID();
  const r2Prefix = `sites/${domain.site_id}/deployments/${deploymentId}`;
  const { data: versions, error: versionError } = await supabase
    .from("deployments")
    .select("version")
    .eq("site_id", domain.site_id)
    .order("version", { ascending: false })
    .limit(1);

  if (versionError) return null;

  const activatedAt = new Date().toISOString();
  const { error: deploymentError } = await supabase.from("deployments").insert({
    id: deploymentId,
    site_id: domain.site_id,
    version: (versions?.[0]?.version ?? 0) + 1,
    status: "active",
    r2_prefix: r2Prefix,
    file_count: 1,
    total_bytes: content.byteLength,
    entrypoint: "index.html",
    spa_fallback_enabled: true,
    risk_score: 0,
    activated_at: activatedAt,
  });

  if (deploymentError) {
    return null;
  }

  try {
    await getSiteAssets(env).put(`${r2Prefix}/index.html`, content, {
      httpMetadata: { contentType: "text/html;charset=utf-8" },
    });

    const { error: fileError } = await supabase
      .from("deployment_files")
      .insert({
        deployment_id: deploymentId,
        path: "index.html",
        size: content.byteLength,
        content_type: "text/html;charset=utf-8",
      });
    if (fileError) throw new Error(fileError.message);

    const { data: activatedSite, error: siteError } = await supabase
      .from("sites")
      .update({ status: "active", active_deployment_id: deploymentId })
      .eq("id", domain.site_id)
      .is("active_deployment_id", null)
      .select("id")
      .maybeSingle();
    if (siteError || !activatedSite)
      throw new Error(siteError?.message ?? "Site was activated concurrently");

    await supabase.from("audit_events").insert({
      user_id: site.user_id,
      site_id: domain.site_id,
      deployment_id: deploymentId,
      event_type: "deployment.legacy_welcome_page_created",
      risk_score: 0,
      message:
        "Created the default welcome page for a legacy site without an active deployment",
    });

    const mapping: DomainMapping = {
      hostname: domain.hostname,
      siteId: domain.site_id,
      deploymentId,
      r2Prefix,
      spaFallbackEnabled: true,
      status: "active",
    };
    await writeDomainCache(env, domain.hostname.split(".")[0] ?? "", mapping);
    return mapping;
  } catch {
    await Promise.allSettled([
      deleteDeploymentPrefix(env, r2Prefix),
      supabase.from("deployments").delete().eq("id", deploymentId),
    ]);
    return null;
  }
}

export async function getDomainMapping(env: Env, hostname: string) {
  const subdomain = hostname.split(".")[0] ?? "";
  const value = await readDomainCache(env, subdomain);

  if (value) {
    return JSON.parse(value) as DomainMapping;
  }

  if (!hasServiceSupabase(env)) {
    return null;
  }

  const supabase = createServiceSupabase(env);
  const { data: domain, error: domainError } = await supabase
    .from("domains")
    .select("hostname, status, site_id")
    .eq("hostname", hostname)
    .neq("status", "deleted")
    .maybeSingle();

  if (domainError || !domain || !domain.site_id) {
    return null;
  }
  const boundDomain = { ...domain, site_id: domain.site_id };

  const { data: site, error: siteError } = await supabase
    .from("sites")
    .select("active_deployment_id, status, user_id")
    .eq("id", domain.site_id)
    .neq("status", "deleted")
    .maybeSingle();

  if (siteError || !site) {
    return null;
  }

  if (!site.active_deployment_id) {
    return provisionLegacyWelcomeDeployment(env, boundDomain, site);
  }

  const { data: deployment, error: deploymentError } = await supabase
    .from("deployments")
    .select("id, r2_prefix, spa_fallback_enabled, status")
    .eq("id", site.active_deployment_id)
    .maybeSingle();

  if (deploymentError || !deployment) {
    return null;
  }

  const mapping: DomainMapping = {
    hostname: domain.hostname,
    siteId: boundDomain.site_id,
    deploymentId: deployment.id,
    r2Prefix: deployment.r2_prefix,
    spaFallbackEnabled: deployment.spa_fallback_enabled,
    status:
      domain.status === "blocked" || deployment.status === "blocked"
        ? "blocked"
        : "active",
  };

  await writeDomainCache(env, subdomain, mapping);
  return mapping;
}
