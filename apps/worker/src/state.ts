import { nanoid } from "nanoid";
import type { User } from "@supabase/supabase-js";
import { unzipSync } from "fflate";
import { getPlanConfig, getPublicSiteUrl, platformConfig, validateSubdomain } from "@qingnest/shared/config/platform";
import { getContentType } from "@qingnest/shared/deployment/mime";
import { prepareDeploymentFiles, type ScanInputFile } from "@qingnest/shared/deployment/scan";
import type { DeploymentScanIssue, DeploymentScanResult } from "@qingnest/shared/deployment/types";
import { getWorkerPlatformConfig } from "./platform";
import { createAuthSupabase, createServiceSupabase, hasAuthSupabase, hasServiceSupabase } from "./supabase";
import type { ProfileRole } from "./supabase";
import type { DomainMapping, Env } from "./types";

type DraftSite = {
  id: string;
  name: string;
  subdomain: string;
  publicUrl: string;
  status: "draft" | "pending_review" | "active";
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

const SIGNUP_CONFIRMATION_TTL_SECONDS = 24 * 60 * 60;
const draftSites = new Map<string, DraftSite>();
const claimedSubdomains = new Set<string>();
const memoryUploadSessions = new Map<string, MemoryUploadSession>();
const textPreviewExtensions = new Set([".html", ".htm", ".js", ".mjs", ".css", ".json", ".txt"]);

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
    bytes.slice(0, platformConfig.deployment.maxPreviewHtmlBytes)
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
      content
    });
  }

  return prepareDeploymentFiles(files, "free");
}

async function putDeploymentFiles(env: Env, r2Prefix: string, files: DeployableArchiveFile[]) {
  for (const file of files) {
    await env.SITE_ASSETS.put(`${r2Prefix}/${file.path}`, file.content, {
      httpMetadata: {
        contentType: getContentType(file.path)
      }
    });
  }
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
  const localDev = (url.hostname === "127.0.0.1" || url.hostname === "localhost") && url.port === "5173";
  const allowedHost = url.hostname === appHost || localDev || url.hostname.endsWith(".pages.dev");

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

function getSignupConfirmationHtml(input: { actionLink: string; expiresAt: string }) {
  const expiresAt = new Date(input.expiresAt).toLocaleString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    day: "2-digit"
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

function getSignupConfirmationText(input: { actionLink: string; expiresAt: string }) {
  return [
    "确认你的 QingNest 轻巢邮箱",
    "",
    "欢迎注册 QingNest 轻巢。请打开下面的链接确认邮箱，然后再登录创建站点。",
    input.actionLink,
    "",
    `链接有效期到 ${new Date(input.expiresAt).toLocaleString("zh-CN")}，且只能使用一次。`,
    "如果不是你本人注册，可以忽略这封邮件。"
  ].join("\n");
}

async function sendSignupConfirmationEmail(
  env: Env,
  input: { email: string; actionLink: string; expiresAt: string }
) {
  if (!env.RESEND_API_KEY || env.RESEND_API_KEY.includes("replace-with")) {
    throw new Error("Resend API key 未配置");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from: getResendFrom(env),
      to: [input.email],
      subject: "确认你的 QingNest 轻巢邮箱",
      html: getSignupConfirmationHtml(input),
      text: getSignupConfirmationText(input)
    })
  });

  if (!response.ok) {
    let message = "验证邮件发送失败";

    try {
      const body = (await response.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      // Keep the generic error if Resend returns a non-JSON body.
    }

    throw new Error(message);
  }
}

async function clearSignupConfirmationSendLock(
  serviceSupabase: ReturnType<typeof createServiceSupabase>,
  email: string
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
  input: { email: string; userId?: string }
) {
  if (input.userId) {
    const { error } = await serviceSupabase.auth.admin.deleteUser(input.userId);

    if (error) {
      throw new Error(`验证邮件发送失败，且无法清理未完成注册用户：${error.message}`);
    }
  }

  await clearSignupConfirmationSendLock(serviceSupabase, input.email);
}

function isAuthUserEmailConfirmed(user: User) {
  return Boolean(user.email_confirmed_at ?? user.confirmed_at);
}

async function findAuthUserByEmail(serviceSupabase: ReturnType<typeof createServiceSupabase>, email: string) {
  const perPage = 1000;

  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await serviceSupabase.auth.admin.listUsers({ page, perPage });

    if (error) {
      throw new Error(error.message);
    }

    const user = data.users.find((candidate) => normalizeEmail(candidate.email ?? "") === email);

    if (user) return user;
    if (data.users.length < perPage) return null;
  }

  throw new Error("用户数量过多，无法确认邮箱状态");
}

async function updatePendingSignupPassword(
  serviceSupabase: ReturnType<typeof createServiceSupabase>,
  input: { email: string; password: string }
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
    password: input.password
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function signUpWithEmailPassword(
  env: Env,
  input: { email?: string; password?: string; redirectTo?: string }
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

  const { data: claims, error: claimError } = await serviceSupabase.rpc("claim_signup_confirmation_email", {
    p_email: email,
    p_ttl_seconds: SIGNUP_CONFIRMATION_TTL_SECONDS
  });

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
      password: input.password
    });

    return {
      email,
      alreadySent: true,
      sentAt: claim.sent_at,
      expiresAt: claim.expires_at
    };
  }

  const { data: linkData, error: linkError } = await serviceSupabase.auth.admin.generateLink({
    type: "signup",
    email,
    password: input.password,
    options: {
      redirectTo: input.redirectTo
    }
  });

  const actionLink = linkData.properties?.action_link;

  if (linkError || !actionLink) {
    await clearSignupConfirmationSendLock(serviceSupabase, email);

    throw new Error(getSignUpErrorMessage(linkError?.message ?? "无法生成邮箱验证链接"));
  }

  try {
    await sendSignupConfirmationEmail(env, {
      email,
      actionLink,
      expiresAt: claim.expires_at
    });
  } catch (sendError) {
    await rollbackGeneratedSignup(serviceSupabase, {
      email,
      userId: linkData.user?.id
    });

    throw sendError;
  }

  return {
    email,
    alreadySent: false,
    sentAt: claim.sent_at,
    expiresAt: claim.expires_at
  };
}

function assertEmailConfirmed(user: AuthenticatedUser) {
  if (!user.emailConfirmed) {
    throw new Error("请先验证邮箱后再创建站点。注册验证邮件有效期为 24 小时，创建时不会重复发送。");
  }
}

export async function getAuthenticatedUser(
  request: Request,
  env: Env,
  options: { requireEmailConfirmed?: boolean } = {}
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

  const emailConfirmed = Boolean(data.user.email_confirmed_at ?? data.user.confirmed_at);

  if ((options.requireEmailConfirmed ?? true) && !emailConfirmed) {
    throw new Error("请先验证邮箱后再继续操作。注册验证邮件有效期为 24 小时。");
  }

  return {
    id: data.user.id,
    email: data.user.email ?? "",
    emailConfirmed
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

export async function checkSubdomainAvailability(env: Env, subdomain: string) {
  const validation = validateSubdomain(subdomain);

  if (!validation.ok) {
    return {
      available: false,
      normalized: validation.normalized,
      reason: validation.reason
    };
  }

  const hostname = getDistributionHostname(env, validation.normalized);
  const cached = claimedSubdomains.has(validation.normalized)
    ? "claimed"
    : await env.DOMAIN_MAP.get(validation.normalized).catch(() => null);
  const existing = cached ?? (hasServiceSupabase(env) ? await findDomainByHostname(env, hostname) : null);

  return {
    available: !existing,
    normalized: validation.normalized,
    requiresReview: validation.requiresReview,
    publicUrl: getSiteUrl(env, validation.normalized),
    reason: existing ? "这个子域名已被占用" : undefined,
    hostname
  };
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

export async function getAccountProfile(env: Env, user: AuthenticatedUser): Promise<AccountProfile> {
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

  return {
    id: user.id,
    email: data.email || user.email,
    emailConfirmed: user.emailConfirmed,
    role: data.role,
    plan: data.plan,
    createdAt: data.created_at
  };
}

export async function getAdminOverview(env: Env, user: AuthenticatedUser): Promise<AdminOverview> {
  const account = await getAccountProfile(env, user);

  if (account.role !== "admin") {
    throw new Error("需要管理员权限");
  }

  const supabase = createServiceSupabase(env);
  const [
    { count: users, error: usersError },
    { count: sites, error: sitesError },
    { count: activeSites, error: activeSitesError },
    { count: pendingReviewSites, error: pendingReviewSitesError },
    { count: deployments, error: deploymentsError }
  ] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("sites").select("id", { count: "exact", head: true }).neq("status", "deleted"),
    supabase.from("sites").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("sites").select("id", { count: "exact", head: true }).eq("status", "pending_review"),
    supabase.from("deployments").select("id", { count: "exact", head: true })
  ]);

  const error = usersError ?? sitesError ?? activeSitesError ?? pendingReviewSitesError ?? deploymentsError;

  if (error) {
    throw new Error(error.message);
  }

  return {
    users: users ?? 0,
    sites: sites ?? 0,
    activeSites: activeSites ?? 0,
    pendingReviewSites: pendingReviewSites ?? 0,
    deployments: deployments ?? 0
  };
}

async function getUserPlan(env: Env, user: AuthenticatedUser) {
  const supabase = createServiceSupabase(env);
  const { data, error } = await supabase.from("profiles").select("plan").eq("id", user.id).maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data?.plan ?? "free";
}

async function assertSiteQuota(env: Env, user: AuthenticatedUser) {
  const supabase = createServiceSupabase(env);
  const plan = getPlanConfig(await getUserPlan(env, user));
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
  const plan = getPlanConfig(await getUserPlan(env, user));
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const siteIds = await listUserSiteIds(env, user);

  const [{ count: sessionsThisHour, error: sessionsError }, { count: deploymentsToday, error: deploymentsError }] =
    await Promise.all([
      supabase
        .from("upload_sessions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .gte("created_at", hourAgo),
      supabase
        .from("deployments")
        .select("id", { count: "exact", head: true })
        .in("site_id", siteIds.length > 0 ? siteIds : ["00000000-0000-0000-0000-000000000000"])
        .gte("created_at", dayAgo)
    ]);

  if (sessionsError) {
    throw new Error(sessionsError.message);
  }

  if (deploymentsError) {
    throw new Error(deploymentsError.message);
  }

  if ((sessionsThisHour ?? 0) >= plan.quotas.user.maxUploadSessionsPerHour) {
    throw new Error(`免费套餐每小时最多创建 ${plan.quotas.user.maxUploadSessionsPerHour} 个上传会话`);
  }

  if ((deploymentsToday ?? 0) >= plan.quotas.user.maxDeploymentsPerDay) {
    throw new Error(`免费套餐每天最多创建 ${plan.quotas.user.maxDeploymentsPerDay} 次部署`);
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

async function assertStorageQuota(env: Env, user: AuthenticatedUser, nextDeploymentBytes: number) {
  const supabase = createServiceSupabase(env);
  const plan = getPlanConfig(await getUserPlan(env, user));
  const siteIds = await listUserSiteIds(env, user);
  const { data, error } = await supabase
    .from("deployments")
    .select("total_bytes")
    .in("site_id", siteIds.length > 0 ? siteIds : ["00000000-0000-0000-0000-000000000000"])
    .neq("status", "blocked")
    .neq("status", "failed");

  if (error) {
    throw new Error(error.message);
  }

  const usedBytes = (data ?? []).reduce((total, deployment) => total + Number(deployment.total_bytes ?? 0), 0);

  if (usedBytes + nextDeploymentBytes > plan.quotas.user.maxStorageBytes) {
    throw new Error(`免费套餐总存储最多 ${Math.round(plan.quotas.user.maxStorageBytes / 1024 / 1024)} MB`);
  }
}

export async function createDraftSite(
  env: Env,
  input: { name: string; subdomain: string; user?: AuthenticatedUser }
) {
  const availability = await checkSubdomainAvailability(env, input.subdomain);

  if (!availability.available) {
    throw new Error(availability.reason ?? "子域名不可用");
  }

  if (hasServiceSupabase(env)) {
    if (!input.user) {
      throw new Error("请先登录后再创建站点");
    }

    assertEmailConfirmed(input.user);
    await ensureProfile(env, input.user);
    await assertSiteQuota(env, input.user);

    const supabase = createServiceSupabase(env);
    const siteStatus = availability.requiresReview ? "pending_review" : "draft";
    const { data: site, error: siteError } = await supabase
      .from("sites")
      .insert({
        user_id: input.user.id,
        name: input.name,
        status: siteStatus
      })
      .select("id, name, status")
      .single();

    if (siteError) {
      throw new Error(siteError.message);
    }

    const { error: domainError } = await supabase.from("domains").insert({
      site_id: site.id,
      hostname: availability.hostname ?? getDistributionHostname(env, availability.normalized),
      type: "platform_subdomain",
      status: availability.requiresReview ? "pending_review" : "active"
    });

    if (domainError) {
      throw new Error(domainError.message);
    }

    const createdSite: DraftSite = {
      id: site.id,
      name: site.name,
      subdomain: availability.normalized,
      publicUrl: getSiteUrl(env, availability.normalized),
      status: site.status === "active" ? "active" : site.status === "pending_review" ? "pending_review" : "draft"
    };

    claimedSubdomains.add(createdSite.subdomain);
    return createdSite;
  }

  const site: DraftSite = {
    id: nanoid(),
    name: input.name,
    subdomain: availability.normalized,
    publicUrl: getSiteUrl(env, availability.normalized),
    status: availability.requiresReview ? "pending_review" : "draft"
  };

  draftSites.set(site.id, site);
  claimedSubdomains.add(site.subdomain);
  return site;
}

export async function createUploadSession(
  env: Env,
  input: { siteId: string; scan: DeploymentScanResult; user?: AuthenticatedUser }
) {
  if (hasServiceSupabase(env)) {
    if (!input.user) {
      throw new Error("请先登录后再创建上传会话");
    }

    assertEmailConfirmed(input.user);
    await ensureProfile(env, input.user);
    await assertUploadSessionQuota(env, input.user);
    await assertStorageQuota(env, input.user, input.scan.totalBytes);

    return createPersistentUploadSession(env, {
      siteId: input.siteId,
      scan: input.scan,
      user: input.user
    });
  }

  return createMemoryUploadSession(env, input);
}

async function createMemoryUploadSession(env: Env, input: { siteId: string; scan: DeploymentScanResult }) {
  const site = draftSites.get(input.siteId);

  if (!site) {
    throw new Error("站点不存在或无权访问");
  }

  if (hasBlockingIssues(input.scan.issues)) {
    return {
      uploadSessionId: nanoid(),
      deploymentId: nanoid(),
      status: "blocked" as const
    };
  }

  const deploymentId = nanoid();
  const uploadSessionId = nanoid();
  const status = input.scan.riskLevel !== "low" || site.status === "pending_review" ? "pending_review" : "uploading";
  memoryUploadSessions.set(uploadSessionId, {
    siteId: site.id,
    deploymentId,
    subdomain: site.subdomain,
    r2Prefix: `sites/${site.id}/deployments/${deploymentId}`,
    status,
    spaFallbackEnabled: input.scan.spaFallbackRecommended,
    expiresAt: Date.now() + getPlanConfig("free").quotas.deployment.uploadSessionTtlMinutes * 60 * 1000
  });

  return {
    uploadSessionId,
    deploymentId,
    status
  };
}

async function createPersistentUploadSession(
  env: Env,
  input: { siteId: string; scan: DeploymentScanResult; user: AuthenticatedUser }
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

  const hasBlockingIssues = input.scan.issues.some((issue) => issue.severity === "error");
  const deploymentStatus =
    hasBlockingIssues
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
    risk_score: input.scan.riskScore
  });

  if (deploymentError) {
    throw new Error(deploymentError.message);
  }

  if (input.scan.files.length > 0) {
    const { error: filesError } = await supabase.from("deployment_files").insert(
      input.scan.files.map((file) => ({
        deployment_id: deploymentId,
        path: file.path,
        size: file.size,
        content_type: file.contentType,
        sha256: file.sha256 ?? null
      }))
    );

    if (filesError) {
      throw new Error(filesError.message);
    }
  }

  const uploadSessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const { error: sessionError } = await supabase.from("upload_sessions").insert({
    id: uploadSessionId,
    site_id: input.siteId,
    user_id: input.user.id,
    status: hasBlockingIssues ? "blocked" : "created",
    expires_at: expiresAt
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
    message: `Created upload session for deployment ${deploymentId}`
  });

  return {
    uploadSessionId,
    deploymentId,
    status: deploymentStatus
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
  status: UploadArchiveResult["status"]
): UploadArchiveResult {
  return {
    deploymentId: target.deploymentId,
    publicUrl: target.publicUrl,
    status,
    fileCount: scan.fileCount,
    totalBytes: scan.totalBytes,
    riskLevel: scan.riskLevel,
    issues: scan.issues
  };
}

function getPublicUrlFromHostname(env: Env, hostname: string) {
  return `${getWorkerPlatformConfig(env).domains.publicProtocol}://${hostname}`;
}

async function getPersistentUploadTarget(
  env: Env,
  input: { uploadSessionId: string; deploymentId: string; user: AuthenticatedUser }
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
    await supabase.from("upload_sessions").update({ status: "expired" }).eq("id", input.uploadSessionId);
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

  if (deployment.status !== "uploading" && deployment.status !== "pending_review") {
    throw new Error("当前部署状态不能继续上传");
  }

  const { data: domain, error: domainError } = await supabase
    .from("domains")
    .select("hostname")
    .eq("site_id", session.site_id)
    .eq("type", "platform_subdomain")
    .neq("status", "deleted")
    .single();

  if (domainError || !domain?.hostname) {
    throw new Error("站点域名不存在");
  }

  const subdomain = domain.hostname.split(".")[0] ?? domain.hostname;

  return {
    siteId: session.site_id,
    deploymentId: deployment.id,
    subdomain,
    publicUrl: getPublicUrlFromHostname(env, domain.hostname),
    hostname: domain.hostname,
    r2Prefix: deployment.r2_prefix,
    status: deployment.status,
    spaFallbackEnabled: deployment.spa_fallback_enabled
  };
}

async function refreshDeploymentFiles(env: Env, deploymentId: string, scan: DeploymentScanResult) {
  const supabase = createServiceSupabase(env);
  const { error: deleteError } = await supabase.from("deployment_files").delete().eq("deployment_id", deploymentId);

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
      sha256: file.sha256 ?? null
    }))
  );

  if (insertError) {
    throw new Error(insertError.message);
  }
}

async function completePersistentArchiveUpload(
  env: Env,
  input: { uploadSessionId: string; deploymentId: string; archive: File; user: AuthenticatedUser }
): Promise<UploadArchiveResult> {
  const target = await getPersistentUploadTarget(env, input);
  const prepared = await readDeployableArchive(input.archive);
  const supabase = createServiceSupabase(env);

  if (hasBlockingIssues(prepared.scan.issues)) {
    await supabase.from("deployments").update({ status: "blocked" }).eq("id", target.deploymentId);
    await supabase.from("upload_sessions").update({ status: "blocked" }).eq("id", input.uploadSessionId);
    await supabase.from("audit_events").insert({
      user_id: input.user.id,
      site_id: target.siteId,
      deployment_id: target.deploymentId,
      event_type: "deployment.blocked",
      risk_score: prepared.scan.riskScore,
      message: "Server scan blocked the uploaded archive"
    });
    return resultFromScan(target, prepared.scan, "blocked");
  }

  await supabase.from("upload_sessions").update({ status: "uploading" }).eq("id", input.uploadSessionId);
  await putDeploymentFiles(env, target.r2Prefix, prepared.files);
  await refreshDeploymentFiles(env, target.deploymentId, prepared.scan);

  const finalStatus = target.status === "pending_review" || prepared.scan.riskLevel !== "low" ? "pending_review" : "active";
  const activatedAt = finalStatus === "active" ? new Date().toISOString() : null;
  const { error: deploymentError } = await supabase
    .from("deployments")
    .update({
      status: finalStatus,
      file_count: prepared.scan.fileCount,
      total_bytes: prepared.scan.totalBytes,
      entrypoint: prepared.scan.entrypoint,
      spa_fallback_enabled: prepared.scan.spaFallbackRecommended,
      risk_score: prepared.scan.riskScore,
      activated_at: activatedAt
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
        active_deployment_id: target.deploymentId
      })
      .eq("id", target.siteId)
      .eq("user_id", input.user.id);

    if (siteError) {
      throw new Error(siteError.message);
    }
  }

  await supabase.from("upload_sessions").update({ status: "completed" }).eq("id", input.uploadSessionId);
  await supabase.from("audit_events").insert({
    user_id: input.user.id,
    site_id: target.siteId,
    deployment_id: target.deploymentId,
    event_type: finalStatus === "active" ? "deployment.activated" : "deployment.pending_review",
    risk_score: prepared.scan.riskScore,
    message: `Deployment ${target.deploymentId} uploaded with status ${finalStatus}`
  });

  const mapping: DomainMapping = {
    hostname: target.hostname,
    siteId: target.siteId,
    deploymentId: target.deploymentId,
    r2Prefix: target.r2Prefix,
    spaFallbackEnabled: prepared.scan.spaFallbackRecommended,
    status: finalStatus
  };

  await env.DOMAIN_MAP.put(target.subdomain, JSON.stringify(mapping));
  return resultFromScan(target, prepared.scan, finalStatus);
}

async function completeMemoryArchiveUpload(
  env: Env,
  input: { uploadSessionId: string; deploymentId: string; archive: File }
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
    status: session.status === "pending_review" ? "pending_review" : "uploading",
    spaFallbackEnabled: session.spaFallbackEnabled
  };
  const prepared = await readDeployableArchive(input.archive);

  if (hasBlockingIssues(prepared.scan.issues)) {
    session.status = "blocked";
    return resultFromScan(target, prepared.scan, "blocked");
  }

  await putDeploymentFiles(env, target.r2Prefix, prepared.files);

  const finalStatus = target.status === "pending_review" || prepared.scan.riskLevel !== "low" ? "pending_review" : "active";
  site.status = finalStatus === "active" ? "active" : "pending_review";

  const mapping: DomainMapping = {
    hostname: target.hostname,
    siteId: target.siteId,
    deploymentId: target.deploymentId,
    r2Prefix: target.r2Prefix,
    spaFallbackEnabled: prepared.scan.spaFallbackRecommended,
    status: finalStatus
  };

  await env.DOMAIN_MAP.put(target.subdomain, JSON.stringify(mapping));
  memoryUploadSessions.delete(input.uploadSessionId);

  return resultFromScan(target, prepared.scan, finalStatus);
}

export async function completeArchiveUpload(
  env: Env,
  input: { uploadSessionId: string; deploymentId: string; archive: File; user?: AuthenticatedUser }
) {
  if (hasServiceSupabase(env)) {
    if (!input.user) {
      throw new Error("请先登录后再上传站点文件");
    }

    assertEmailConfirmed(input.user);
    return completePersistentArchiveUpload(env, {
      uploadSessionId: input.uploadSessionId,
      deploymentId: input.deploymentId,
      archive: input.archive,
      user: input.user
    });
  }

  return completeMemoryArchiveUpload(env, input);
}

export async function getDomainMapping(env: Env, hostname: string) {
  const subdomain = hostname.split(".")[0] ?? "";
  const value = await env.DOMAIN_MAP.get(subdomain);

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

  if (domainError || !domain) {
    return null;
  }

  const { data: site, error: siteError } = await supabase
    .from("sites")
    .select("active_deployment_id")
    .eq("id", domain.site_id)
    .neq("status", "deleted")
    .maybeSingle();

  if (siteError || !site?.active_deployment_id) {
    return null;
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
    siteId: domain.site_id,
    deploymentId: deployment.id,
    r2Prefix: deployment.r2_prefix,
    spaFallbackEnabled: deployment.spa_fallback_enabled,
    status: domain.status === "blocked" || deployment.status === "blocked" ? "blocked" : "active"
  };

  await env.DOMAIN_MAP.put(subdomain, JSON.stringify(mapping)).catch(() => undefined);
  return mapping;
}
