import { scanDeploymentFiles } from "@qingnest/shared/deployment/scan";
import { getPublicSiteUrl, validateSubdomain } from "@qingnest/shared/config/platform";
import { json, problem, readJson } from "./http";
import { getWorkerPlatformConfig } from "./platform";
import {
  checkSubdomainAvailability,
  completeArchiveUpload,
  createDraftSite,
  createUploadSession,
  getAccountProfile,
  getAdminOverview,
  getAuthenticatedUser,
  signUpWithEmailPassword
} from "./state";
import { hasServiceSupabase } from "./supabase";
import type { Env } from "./types";
import type { DeploymentScanResult } from "@qingnest/shared/deployment/types";

type SiteCreateInput = {
  name?: string;
  subdomain?: string;
};

type UploadSessionInput = {
  siteId?: string;
  scan?: DeploymentScanResult;
};

type SignUpInput = {
  email?: string;
  password?: string;
  redirectTo?: string;
};

function isUploadedFile(value: unknown): value is File {
  return typeof value === "object" && value !== null && "arrayBuffer" in value && "name" in value;
}

async function maybeGetUser(
  request: Request,
  env: Env,
  options: { requireEmailConfirmed?: boolean } = {}
) {
  return hasServiceSupabase(env) ? await getAuthenticatedUser(request, env, options) : undefined;
}

export async function handleApi(request: Request, env: Env) {
  const url = new URL(request.url);
  const platformConfig = getWorkerPlatformConfig(env);

  try {
    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({
        service: "worker-api",
        environment: env.ENVIRONMENT,
        supabaseConfigured: hasServiceSupabase(env)
      });
    }

    if (request.method === "GET" && url.pathname === "/api/config/public") {
      return json({
        brand: platformConfig.brand,
        domains: platformConfig.domains,
        subdomainPolicy: platformConfig.subdomainPolicy,
        plans: {
          free: platformConfig.plans.free
        }
      });
    }

    if (request.method === "POST" && url.pathname === "/api/auth/sign-up") {
      const input = await readJson<SignUpInput>(request);
      return json(await signUpWithEmailPassword(env, input), { status: 201 });
    }

    if (request.method === "GET" && url.pathname === "/api/me") {
      const user = await maybeGetUser(request, env, { requireEmailConfirmed: false });

      if (!user) {
        return problem("请先登录", 401);
      }

      return json(await getAccountProfile(env, user));
    }

    if (request.method === "GET" && url.pathname === "/api/admin/overview") {
      const user = await maybeGetUser(request, env, { requireEmailConfirmed: true });

      if (!user) {
        return problem("请先登录", 401);
      }

      return json(await getAdminOverview(env, user));
    }

    if (request.method === "GET" && url.pathname === "/api/subdomains/check") {
      const subdomain = url.searchParams.get("subdomain") ?? "";
      const validation = validateSubdomain(subdomain);

      if (!validation.ok) {
        return json({
          available: false,
          normalized: validation.normalized,
          reason: validation.reason
        });
      }

      const result = await checkSubdomainAvailability(env, validation.normalized);
      return json({
        available: result.available,
        normalized: result.normalized,
        requiresReview: result.requiresReview,
        publicUrl: getPublicSiteUrl(result.normalized, platformConfig.domains),
        reason: result.reason
      });
    }

    if (request.method === "POST" && url.pathname === "/api/sites") {
      const input = await readJson<SiteCreateInput>(request);

      if (!input.subdomain) {
        return problem("缺少子域名");
      }

      const user = await maybeGetUser(request, env);
      const site = await createDraftSite(env, {
        name: input.name?.trim() || "未命名站点",
        subdomain: input.subdomain,
        user
      });
      return json(site, { status: 201 });
    }

    if (request.method === "POST" && url.pathname === "/api/upload-sessions") {
      const input = await readJson<UploadSessionInput>(request);

      if (!input.siteId || !input.scan) {
        return problem("缺少站点或扫描结果");
      }

      const trustedScan = scanDeploymentFiles(
        input.scan.files.map((file) => ({ path: file.path, size: file.size })),
        "free"
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
              : input.scan.riskLevel === "medium" || trustedScan.riskLevel === "medium"
                ? "medium"
                : "low"
        }
      });
      return json(result, { status: 201 });
    }

    const uploadArchiveMatch = url.pathname.match(/^\/api\/upload-sessions\/([^/]+)\/archive$/);

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
        user
      });
      return json(result, { status: 201 });
    }

    return problem("接口不存在", 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "服务异常";
    const status =
      message.includes("管理员") || message.includes("邮箱") || message.includes("无权")
        ? 403
        : message.includes("登录") || message.includes("过期")
          ? 401
          : message.includes("套餐")
            ? 429
            : 500;
    return problem(message, status);
  }
}
