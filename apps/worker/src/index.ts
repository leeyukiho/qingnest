import { handleApi } from "./api";
import { withSecurityHeaders } from "./http";
import { handleSiteRequest } from "./router";
import type { Env } from "./types";
import { runTrafficLifecycle } from "./traffic";
import { evaluateCapacityAlerts } from "./capacity";

export default {
  async fetch(
    request: Request,
    env: Env,
    context: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return withSecurityHeaders(await handleApi(request, env));
    }

    return handleSiteRequest(request, env, context);
  },
  async scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext) {
    context.waitUntil(Promise.all([runTrafficLifecycle(env), evaluateCapacityAlerts(env)]));
  },
};
