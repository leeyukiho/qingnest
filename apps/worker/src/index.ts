import { handleApi } from "./api";
import { withSecurityHeaders } from "./http";
import { handleSiteRequest } from "./router";
import type { Env } from "./types";
import { runTrafficLifecycle } from "./traffic";
import { evaluateCapacityAlerts } from "./capacity";
import { syncPlatformDomains } from "./platform-domains";

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
  async scheduled(controller: ScheduledController, env: Env, context: ExecutionContext) {
    const scheduledAt = new Date(controller.scheduledTime);
    const capacityDue = scheduledAt.getUTCMinutes() === 0 && scheduledAt.getUTCHours() % 6 === 0;
    context.waitUntil(Promise.all([
      runTrafficLifecycle(env),
      capacityDue ? evaluateCapacityAlerts(env) : Promise.resolve(),
      syncPlatformDomains(env),
    ]));
  },
};
