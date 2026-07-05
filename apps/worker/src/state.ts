import { nanoid } from "nanoid";
import { getPublicSiteUrl, validateSubdomain } from "@qingnest/shared/config/platform";
import type { DeploymentScanResult } from "@qingnest/shared/deployment/types";
import { getWorkerPlatformConfig } from "./platform";
import { createAuthSupabase, createServiceSupabase, hasAuthSupabase, hasServiceSupabase } from "./supabase";
import type { DomainMapping, Env } from "./types";

type DraftSite = {
  id: string;
  name: string;
  subdomain: string;
  publicUrl: string;
  status: "draft" | "pending_review" | "active";
};

export type AuthenticatedUser = {
  id: string;
  email: string;
};

const draftSites = new Map<string, DraftSite>();
const claimedSubdomains = new Set<string>();

function getSiteUrl(env: Env, subdomain: string) {
  return getPublicSiteUrl(subdomain, getWorkerPlatformConfig(env).domains);
}

function getDistributionHostname(env: Env, subdomain: string) {
  return new URL(getSiteUrl(env, subdomain)).hostname;
}

function getBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");

  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

export async function getAuthenticatedUser(request: Request, env: Env): Promise<AuthenticatedUser> {
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

  return {
    id: data.user.id,
    email: data.user.email ?? ""
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

    await ensureProfile(env, input.user);

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

  const hasBlockingIssues = input.scan.issues.some((issue) => issue.severity === "error");

  if (hasBlockingIssues) {
    return {
      uploadSessionId: nanoid(),
      deploymentId: nanoid(),
      status: "blocked" as const
    };
  }

  const deploymentId = nanoid();
  const status = input.scan.riskLevel === "high" || site.status === "pending_review" ? "pending_review" : "uploading";
  const mapping: DomainMapping = {
    hostname: getDistributionHostname(env, site.subdomain),
    siteId: site.id,
    deploymentId,
    r2Prefix: `sites/${site.id}/deployments/${deploymentId}`,
    spaFallbackEnabled: input.scan.spaFallbackRecommended,
    status: status === "uploading" ? "active" : "pending_review"
  };

  await env.DOMAIN_MAP.put(site.subdomain, JSON.stringify(mapping)).catch(() => undefined);

  return {
    uploadSessionId: nanoid(),
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
      : input.scan.riskLevel === "high" || site.status === "pending_review"
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

  const { data: domain, error: domainError } = await supabase
    .from("domains")
    .select("hostname, status")
    .eq("site_id", input.siteId)
    .eq("type", "platform_subdomain")
    .neq("status", "deleted")
    .maybeSingle();

  if (domainError) {
    throw new Error(domainError.message);
  }

  if (domain?.hostname && deploymentStatus !== "blocked") {
    const subdomain = domain.hostname.split(".")[0] ?? domain.hostname;
    const mapping: DomainMapping = {
      hostname: domain.hostname,
      siteId: input.siteId,
      deploymentId,
      r2Prefix,
      spaFallbackEnabled: input.scan.spaFallbackRecommended,
      status: deploymentStatus === "uploading" ? "active" : "pending_review"
    };

    await env.DOMAIN_MAP.put(subdomain, JSON.stringify(mapping)).catch(() => undefined);
  }

  return {
    uploadSessionId,
    deploymentId,
    status: deploymentStatus
  };
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
