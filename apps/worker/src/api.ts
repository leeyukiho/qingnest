import {
  getPublicSiteUrl,
  validateSubdomain,
} from "@qingnest/shared/config/platform";
import { scanDeploymentFiles } from "@qingnest/shared/deployment/scan";
import type { DeploymentScanResult } from "@qingnest/shared/deployment/types";
import { json, problem, readJson } from "./http";
import { getWorkerPlatformConfig } from "./platform";
import {
  checkSubdomainAvailability,
  completeArchiveUpload,
  completeFilesUpload,
  createDraftSite,
  createPublicSlot,
  createPrivatePreview,
  createUploadSession,
  deleteProject,
  getAccountProfile,
  getAdminOverview,
  getAuthenticatedUser,
  getProject,
  listProjects,
  listPublicSlots,
  rentPublicSlot,
  switchPublicSlot,
  updateAdminSite,
  updateAdminUser,
  updateProjectName,
  signUpWithEmailPassword,
} from "./state";
import { hasServiceSupabase } from "./supabase";
import type { Env } from "./types";

type SiteCreateInput = {
  name?: string;
};

type PublicSlotInput = { siteId?: string; subdomain?: string };
type PublicSlotRentalInput = { subdomain?: string };
type PublicSlotUpdateInput = { siteId?: string | null };

type SiteUpdateInput = { name?: string };

type UploadSessionInput = {
  siteId?: string;
  scan?: DeploymentScanResult;
};

type SignUpInput = {
  email?: string;
  password?: string;
  redirectTo?: string;
};

type AdminUserUpdateInput = { role?: "user" | "admin"; plan?: string };
type AdminSiteUpdateInput = { status?: "draft" | "active" | "pending_review" | "blocked" };

const subdomainCheckWindows = new Map<
  string,
  { count: number; startedAt: number }
>();
const SUBDOMAIN_CHECK_WINDOW_MS = 60_000;
const SUBDOMAIN_CHECK_LIMIT = 30;

function getSubdomainCheckRetryAfter(request: Request) {
  const clientIp = request.headers.get("cf-connecting-ip");
  if (!clientIp) return 0;

  const now = Date.now();
  const current = subdomainCheckWindows.get(clientIp);
  if (!current || now - current.startedAt >= SUBDOMAIN_CHECK_WINDOW_MS) {
    if (subdomainCheckWindows.size >= 1_000) {
      for (const [key, window] of subdomainCheckWindows) {
        if (now - window.startedAt >= SUBDOMAIN_CHECK_WINDOW_MS)
          subdomainCheckWindows.delete(key);
      }
      if (subdomainCheckWindows.size >= 1_000) {
        const oldestKey = subdomainCheckWindows.keys().next().value;
        if (oldestKey) subdomainCheckWindows.delete(oldestKey);
      }
    }
    subdomainCheckWindows.set(clientIp, { count: 1, startedAt: now });
    return 0;
  }

  current.count += 1;
  if (current.count <= SUBDOMAIN_CHECK_LIMIT) return 0;

  return Math.max(
    1,
    Math.ceil(
      (SUBDOMAIN_CHECK_WINDOW_MS - (now - current.startedAt)) / 1_000,
    ),
  );
}

function isUploadedFile(value: unknown): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "name" in value
  );
}

function getFormFiles(formData: FormData, fieldName: string): File[] {
  const files: File[] = [];

  for (const value of formData.getAll(fieldName) as unknown[]) {
    if (isUploadedFile(value)) {
      files.push(value);
    }
  }

  return files;
}

async function maybeGetUser(
  request: Request,
  env: Env,
  options: { requireEmailConfirmed?: boolean } = {},
) {
  return hasServiceSupabase(env)
    ? await getAuthenticatedUser(request, env, options)
    : undefined;
}

export async function handleApi(request: Request, env: Env) {
  const url = new URL(request.url);
  const platformConfig = getWorkerPlatformConfig(env);

  try {
    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({
        service: "worker-api",
        environment: env.ENVIRONMENT,
        supabaseConfigured: hasServiceSupabase(env),
      });
    }

    if (request.method === "GET" && url.pathname === "/api/config/public") {
      return json({
        brand: platformConfig.brand,
        domains: platformConfig.domains,
        subdomainPolicy: platformConfig.subdomainPolicy,
        plans: {
          free: platformConfig.plans.free,
        },
      });
    }

    if (request.method === "POST" && url.pathname === "/api/auth/sign-up") {
      const input = await readJson<SignUpInput>(request);
      return json(await signUpWithEmailPassword(env, input), { status: 201 });
    }

    if (request.method === "GET" && url.pathname === "/api/me") {
      const user = await maybeGetUser(request, env, {
        requireEmailConfirmed: false,
      });

      if (!user) {
        return problem("请先登录", 401);
      }

      return json(await getAccountProfile(env, user));
    }

    if (request.method === "GET" && url.pathname === "/api/admin/overview") {
      const user = await maybeGetUser(request, env, {
        requireEmailConfirmed: true,
      });

      if (!user) {
        return problem("请先登录", 401);
      }

      return json(await getAdminOverview(env, user));
    }

    const adminUserMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (request.method === "PATCH" && adminUserMatch) {
      const user = await maybeGetUser(request, env, { requireEmailConfirmed: true });
      if (!user) return problem("请先登录", 401);
      const input = await readJson<AdminUserUpdateInput>(request);
      return json(await updateAdminUser(env, user, { userId: decodeURIComponent(adminUserMatch[1] ?? ""), ...input }));
    }

    const adminSiteMatch = url.pathname.match(/^\/api\/admin\/sites\/([^/]+)$/);
    if (request.method === "PATCH" && adminSiteMatch) {
      const user = await maybeGetUser(request, env, { requireEmailConfirmed: true });
      if (!user) return problem("请先登录", 401);
      const input = await readJson<AdminSiteUpdateInput>(request);
      if (!input.status) return problem("请选择站点状态", 400);
      return json(await updateAdminSite(env, user, { siteId: decodeURIComponent(adminSiteMatch[1] ?? ""), status: input.status }));
    }

    if (request.method === "GET" && url.pathname === "/api/subdomains/check") {
      const retryAfter = getSubdomainCheckRetryAfter(request);
      if (retryAfter > 0) {
        const response = problem("检查过于频繁，请稍后再试", 429);
        response.headers.set("retry-after", String(retryAfter));
        return response;
      }
      const subdomain = url.searchParams.get("subdomain") ?? "";
      const validation = validateSubdomain(subdomain);

      if (!validation.ok) {
        return json({
          available: false,
          normalized: validation.normalized,
          reason: validation.reason,
        });
      }

      const result = await checkSubdomainAvailability(
        env,
        validation.normalized,
      );
      return json(
        {
          available: result.available,
          normalized: result.normalized,
          requiresReview: result.requiresReview,
          publicUrl: getPublicSiteUrl(
            result.normalized,
            platformConfig.domains,
          ),
          reason: result.reason,
        },
        { headers: { "cache-control": "private, max-age=15" } },
      );
    }

    if (request.method === "POST" && url.pathname === "/api/sites") {
      const input = await readJson<SiteCreateInput>(request);

      const user = await maybeGetUser(request, env);
      const site = await createDraftSite(env, {
        name: input.name?.trim() || "未命名站点",
        user,
      });
      return json(site, { status: 201 });
    }

    if (request.method === "GET" && url.pathname === "/api/sites") {
      const user = await maybeGetUser(request, env);
      return json(await listProjects(env, user));
    }

    if (request.method === "GET" && url.pathname === "/api/public-slots") {
      const user = await maybeGetUser(request, env);
      if (!user) return problem("请先登录", 401);
      return json(await listPublicSlots(env, user));
    }

    if (request.method === "POST" && url.pathname === "/api/public-slots") {
      const input = await readJson<PublicSlotInput>(request);
      if (!input.siteId || !input.subdomain)
        return problem("缺少项目或公开地址");
      const user = await maybeGetUser(request, env);
      if (!user) return problem("请先登录", 401);
      return json(
        await createPublicSlot(env, {
          siteId: input.siteId,
          subdomain: input.subdomain,
          user,
        }),
        { status: 201 },
      );
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/public-slots/rent"
    ) {
      const input = await readJson<PublicSlotRentalInput>(request);
      if (!input.subdomain) return problem("请输入地址前缀", 400);
      const user = await maybeGetUser(request, env);
      if (!user) return problem("请先登录", 401);
      return json(
        await rentPublicSlot(env, {
          subdomain: input.subdomain,
          user,
        }),
        { status: 201 },
      );
    }

    const slotMatch = url.pathname.match(/^\/api\/public-slots\/([^/]+)$/);
    if (request.method === "PATCH" && slotMatch) {
      const input = await readJson<PublicSlotUpdateInput>(request);
      const user = await maybeGetUser(request, env);
      if (!user) return problem("请先登录", 401);
      return json(
        await switchPublicSlot(env, {
          slotId: decodeURIComponent(slotMatch[1] ?? ""),
          siteId: input.siteId ?? null,
          user,
        }),
      );
    }

    const siteMatch = url.pathname.match(/^\/api\/sites\/([^/]+)$/);
    if (request.method === "GET" && siteMatch) {
      const user = await maybeGetUser(request, env);
      return json(
        await getProject(env, decodeURIComponent(siteMatch[1] ?? ""), user),
      );
    }

    if (request.method === "PATCH" && siteMatch) {
      const input = await readJson<SiteUpdateInput>(request);
      const user = await maybeGetUser(request, env);
      return json(
        await updateProjectName(
          env,
          decodeURIComponent(siteMatch[1] ?? ""),
          input.name ?? "",
          user,
        ),
      );
    }

    if (request.method === "DELETE" && siteMatch) {
      const user = await maybeGetUser(request, env);
      return json(
        await deleteProject(env, decodeURIComponent(siteMatch[1] ?? ""), user),
      );
    }

    const previewMatch = url.pathname.match(/^\/api\/sites\/([^/]+)\/preview$/);
    if (request.method === "POST" && previewMatch) {
      const user = await maybeGetUser(request, env);
      if (!user) return problem("请先登录", 401);
      return json(
        await createPrivatePreview(env, {
          siteId: decodeURIComponent(previewMatch[1] ?? ""),
          user,
          origin: url.origin,
        }),
      );
    }

    if (request.method === "POST" && url.pathname === "/api/upload-sessions") {
      const input = await readJson<UploadSessionInput>(request);

      if (!input.siteId || !input.scan) {
        return problem("缺少站点或扫描结果");
      }

      const trustedScan = scanDeploymentFiles(
        input.scan.files.map((file) => ({ path: file.path, size: file.size })),
        "free",
      );
      const user = await maybeGetUser(request, env);

      const result = await createUploadSession(env, {
        siteId: input.siteId,
        user,
        scan: {
          ...input.scan,
          issues: [...input.scan.issues, ...trustedScan.issues],
          riskScore: Math.max(input.scan.riskScore, trustedScan.riskScore),
          riskLevel:
            input.scan.riskLevel === "high" || trustedScan.riskLevel === "high"
              ? "high"
              : input.scan.riskLevel === "medium" ||
                  trustedScan.riskLevel === "medium"
                ? "medium"
                : "low",
        },
      });
      return json(result, { status: 201 });
    }

    const uploadArchiveMatch = url.pathname.match(
      /^\/api\/upload-sessions\/([^/]+)\/archive$/,
    );

    if (request.method === "POST" && uploadArchiveMatch) {
      const uploadSessionId = decodeURIComponent(uploadArchiveMatch[1] ?? "");
      const formData = await request.formData();
      const deploymentId = formData.get("deploymentId");
      const archive = formData.get("archive");

      if (typeof deploymentId !== "string" || !deploymentId) {
        return problem("缺少部署 ID");
      }

      if (!isUploadedFile(archive)) {
        return problem("缺少 ZIP 文件");
      }

      const user = await maybeGetUser(request, env);
      const result = await completeArchiveUpload(env, {
        uploadSessionId,
        deploymentId,
        archive,
        user,
      });
      return json(result, { status: 201 });
    }

    const uploadFilesMatch = url.pathname.match(
      /^\/api\/upload-sessions\/([^/]+)\/files$/,
    );

    if (request.method === "POST" && uploadFilesMatch) {
      const uploadSessionId = decodeURIComponent(uploadFilesMatch[1] ?? "");
      const formData = await request.formData();
      const deploymentId = formData.get("deploymentId");
      const files = getFormFiles(formData, "files");
      const paths = formData
        .getAll("paths")
        .filter((path): path is string => typeof path === "string");

      if (typeof deploymentId !== "string" || !deploymentId) {
        return problem("缺少部署 ID");
      }

      if (files.length === 0) {
        return problem("缺少项目文件");
      }

      if (files.length !== paths.length) {
        return problem("项目文件路径不完整");
      }

      const user = await maybeGetUser(request, env);
      const result = await completeFilesUpload(env, {
        uploadSessionId,
        deploymentId,
        files: files.map((file, index) => ({
          file,
          path: paths[index] ?? file.name,
        })),
        user,
      });
      return json(result, { status: 201 });
    }

    return problem("接口不存在", 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "服务异常";
    const status =
      message.includes("管理员") ||
      message.includes("邮箱") ||
      message.includes("无权")
        ? 403
        : message.includes("登录") || message.includes("过期")
          ? 401
          : message.includes("套餐") || message.includes("分钟后再试")
            ? 429
            : message.includes("不存在")
              ? 404
              : message.includes("不可用") || message.includes("已被")
                ? 409
                : message.includes("缺少") ||
                    message.includes("不能") ||
                    message.includes("无效") ||
                    message.includes("必须")
                  ? 400
                  : 500;
    return problem(message, status);
  }
}
