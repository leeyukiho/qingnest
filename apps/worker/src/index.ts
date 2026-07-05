import { handleApi } from "./api";
import { withSecurityHeaders } from "./http";
import { handleSiteRequest } from "./router";
import type { Env } from "./types";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return withSecurityHeaders(await handleApi(request, env));
    }

    return handleSiteRequest(request, env);
  }
};
