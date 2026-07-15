import { platformConfig } from "@qingnest/shared/config/platform";
import { getCacheControl, getContentType } from "@qingnest/shared/deployment/mime";
import { problem, withSecurityHeaders } from "./http";
import { getDomainMapping } from "./state";
import type { Env } from "./types";
import { isTrafficLimited, recordTraffic } from "./traffic";

const ORIGINAL_CACHE_CONTROL_HEADER = "x-qingnest-origin-cache-control";
const previewMappingCache = new Map<string, { value: Awaited<ReturnType<typeof getDomainMapping>>; expiresAt: number }>();
const PREVIEW_MAPPING_TTL_MS = 60_000;
const PREVIEW_MAPPING_MAX_ENTRIES = 500;

function sanitizePath(pathname: string) {
  const decoded = decodeURIComponent(pathname);
  return decoded.replace(/\\/g, "/").replace(/^\/+/, "");
}

function candidatePaths(pathname: string) {
  const clean = sanitizePath(pathname);

  if (!clean || clean.endsWith("/")) {
    return [`${clean}index.html`];
  }

  // Asset requests must never fall through to HTML candidates. Besides hiding
  // broken assets behind the SPA shell, that can turn one miss into four R2 reads.
  if (/\/[^/]+\.[^/]+$/.test(`/${clean}`)) {
    return [clean];
  }

  const candidates = [clean];

  if (!clean.endsWith(".html")) {
    candidates.push(`${clean}.html`, `${clean}/index.html`);
  }

  return candidates;
}

function getPublicCacheKey(request: Request) {
  const url = new URL(request.url);
  url.search = "";
  return new Request(url.toString(), { method: "GET" });
}

async function readPublicEdgeCache(request: Request) {
  if (request.method !== "GET" && request.method !== "HEAD") return null;

  try {
    const cached = await caches.default.match(getPublicCacheKey(request));
    if (!cached) return null;

    const headers = new Headers(cached.headers);
    const originalCacheControl = headers.get(ORIGINAL_CACHE_CONTROL_HEADER);
    headers.delete(ORIGINAL_CACHE_CONTROL_HEADER);
    if (originalCacheControl) headers.set("cache-control", originalCacheControl);
    headers.set("x-qingnest-cache", "HIT");

    return new Response(request.method === "HEAD" ? null : cached.body, {
      status: cached.status,
      statusText: cached.statusText,
      headers,
    });
  } catch {
    return null;
  }
}

function cachePublicResponse(
  request: Request,
  response: Response,
  context?: ExecutionContext,
  ttlSeconds?: number,
) {
  if (request.method !== "GET" || !context) return;

  const cachedResponse = response.clone();
  const headers = new Headers(cachedResponse.headers);
  const originalCacheControl = headers.get("cache-control") ?? "no-store";
  const maxAge = originalCacheControl.match(/(?:^|,)\s*max-age=(\d+)/i)?.[1];
  const cacheTtl = ttlSeconds ?? (maxAge ? Number(maxAge) : platformConfig.cache.edgeTtlSeconds);
  headers.set(ORIGINAL_CACHE_CONTROL_HEADER, originalCacheControl);
  headers.set("cache-control", `public, max-age=${cacheTtl}`);
  headers.delete("set-cookie");

  context.waitUntil(
    caches.default
      .put(
        getPublicCacheKey(request),
        new Response(cachedResponse.body, {
          status: cachedResponse.status,
          statusText: cachedResponse.statusText,
          headers,
        }),
      )
      .catch(() => undefined),
  );
}

async function getPreviewMapping(env: Env, token: string) {
  const cached = previewMappingCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) previewMappingCache.delete(token);

  const value = env.DOMAIN_MAP ? await env.DOMAIN_MAP.get(`preview:${token}`) : null;
  const mapping = value
    ? JSON.parse(value) as Awaited<ReturnType<typeof getDomainMapping>>
    : null;
  previewMappingCache.set(token, { value: mapping, expiresAt: Date.now() + PREVIEW_MAPPING_TTL_MS });
  while (previewMappingCache.size > PREVIEW_MAPPING_MAX_ENTRIES) {
    const oldestKey = previewMappingCache.keys().next().value;
    if (oldestKey === undefined) break;
    previewMappingCache.delete(oldestKey);
  }
  return mapping;
}

export async function handleSiteRequest(
  request: Request,
  env: Env,
  context?: ExecutionContext,
) {
  const url = new URL(request.url);
  const previewMatch = url.pathname.match(/^\/preview\/([^/]+)(\/.*)?$/);
  if (request.method !== "GET" && request.method !== "HEAD") {
    const response = withSecurityHeaders(problem("静态站点只支持 GET 和 HEAD 请求", 405));
    response.headers.set("allow", "GET, HEAD");
    return response;
  }

  // A public cache hit is self-contained: no KV mapping, traffic-limit KV or R2
  // lookup is needed. Enforcement changes converge when the short edge TTL ends.
  const cachedResponse = previewMatch ? null : await readPublicEdgeCache(request);
  if (cachedResponse) {
    recordTraffic(
      env,
      request,
      url.hostname,
      cachedResponse.status,
      Number(cachedResponse.headers.get("content-length") ?? 0),
    );
    return cachedResponse;
  }

  if (!previewMatch && await isTrafficLimited(env, url.hostname)) {
    const response = withSecurityHeaders(problem("本站点的免费流量保护额度已用尽，站长升级套餐后可恢复访问", 429));
    response.headers.set("retry-after", "3600");
    return response;
  }

  const mapping = previewMatch
    ? await getPreviewMapping(env, previewMatch[1])
    : await getDomainMapping(env, url.hostname);
  const requestPathname = previewMatch ? (previewMatch[2] || "/") : url.pathname;

  if (!mapping) {
    const response = withSecurityHeaders(problem("站点不存在", 404));
    if (!previewMatch) {
      cachePublicResponse(
        request,
        response,
        context,
        platformConfig.cache.edgeNegativeTtlSeconds,
      );
    }
    return response;
  }

  if (mapping.status === "blocked") {
    const response = withSecurityHeaders(problem("站点已下架", 451));
    if (!previewMatch) cachePublicResponse(request, response, context, platformConfig.cache.edgeNegativeTtlSeconds);
    return response;
  }

  if (mapping.status === "pending_review") {
    const response = withSecurityHeaders(problem("站点正在审核中", 403));
    if (!previewMatch) cachePublicResponse(request, response, context, platformConfig.cache.edgeNegativeTtlSeconds);
    return response;
  }

  const siteAssets = env.SITE_ASSETS;

  if (!siteAssets) {
    return withSecurityHeaders(problem("SITE_ASSETS R2 binding is not configured", 503));
  }

  for (const path of candidatePaths(requestPathname)) {
    const object = await siteAssets.get(`${mapping.r2Prefix}/${path}`);

    if (object) {
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("content-type", getContentType(path));
      headers.set("cache-control", getCacheControl(path));
      headers.set("content-length", String(object.size));
      headers.set("etag", object.httpEtag);
      headers.set("x-qingnest-cache", "MISS");

      for (const [key, value] of Object.entries(platformConfig.securityHeaders)) {
        headers.set(key, value);
      }

      const response = new Response(request.method === "HEAD" ? null : object.body, { headers });
      recordTraffic(env, request, url.hostname, 200, object.size);
      if (!previewMatch) cachePublicResponse(request, response, context);
      return response;
    }
  }

  if (mapping.spaFallbackEnabled) {
    const object = await siteAssets.get(`${mapping.r2Prefix}/index.html`);

    if (object) {
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("content-type", platformConfig.mimeTypes[".html"]);
      headers.set("cache-control", platformConfig.cache.html);
      headers.set("content-length", String(object.size));
      headers.set("etag", object.httpEtag);
      headers.set("x-qingnest-cache", "MISS");

      for (const [key, value] of Object.entries(platformConfig.securityHeaders)) {
        headers.set(key, value);
      }

      const response = new Response(request.method === "HEAD" ? null : object.body, { headers });
      recordTraffic(env, request, url.hostname, 200, object.size);
      if (!previewMatch) cachePublicResponse(request, response, context);
      return response;
    }
  }

  const response = withSecurityHeaders(problem("文件不存在", 404));
  if (!previewMatch) {
    cachePublicResponse(
      request,
      response,
      context,
      platformConfig.cache.edgeNegativeTtlSeconds,
    );
  }
  return response;
}


