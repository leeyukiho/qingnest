import { platformConfig } from "@qingnest/shared/config/platform";
import { getCacheControl, getContentType } from "@qingnest/shared/deployment/mime";
import { problem, withSecurityHeaders } from "./http";
import { getDomainMapping } from "./state";
import type { Env } from "./types";

function sanitizePath(pathname: string) {
  const decoded = decodeURIComponent(pathname);
  return decoded.replace(/\\/g, "/").replace(/^\/+/, "");
}

function candidatePaths(pathname: string) {
  const clean = sanitizePath(pathname);

  if (!clean || clean.endsWith("/")) {
    return [`${clean}index.html`];
  }

  const candidates = [clean];

  if (!clean.endsWith(".html")) {
    candidates.push(`${clean}.html`, `${clean}/index.html`);
  }

  return candidates;
}

export async function handleSiteRequest(request: Request, env: Env) {
  const url = new URL(request.url);
  const mapping = await getDomainMapping(env, url.hostname);

  if (!mapping) {
    return withSecurityHeaders(problem("站点不存在", 404));
  }

  if (mapping.status === "blocked") {
    return withSecurityHeaders(problem("站点已下架", 451));
  }

  if (mapping.status === "pending_review") {
    return withSecurityHeaders(problem("站点正在审核中", 403));
  }

  for (const path of candidatePaths(url.pathname)) {
    const object = await env.SITE_ASSETS.get(`${mapping.r2Prefix}/${path}`);

    if (object) {
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("content-type", getContentType(path));
      headers.set("cache-control", getCacheControl(path));

      for (const [key, value] of Object.entries(platformConfig.securityHeaders)) {
        headers.set(key, value);
      }

      return new Response(object.body, { headers });
    }
  }

  if (mapping.spaFallbackEnabled) {
    const object = await env.SITE_ASSETS.get(`${mapping.r2Prefix}/index.html`);

    if (object) {
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("content-type", platformConfig.mimeTypes[".html"]);
      headers.set("cache-control", platformConfig.cache.html);

      for (const [key, value] of Object.entries(platformConfig.securityHeaders)) {
        headers.set(key, value);
      }

      return new Response(object.body, { headers });
    }
  }

  return withSecurityHeaders(problem("文件不存在", 404));
}


