import { getPlatformConfig } from "@qingnest/shared/config/platform";
import type { Env } from "./types";

function normalizeProtocol(value: string | undefined) {
  return value === "http" || value === "https" ? value : undefined;
}

export function getWorkerPlatformConfig(env: Pick<Env, "APP_HOST" | "DISTRIBUTION_ROOT" | "PUBLIC_PROTOCOL">) {
  return getPlatformConfig({
    domains: {
      appHost: env.APP_HOST,
      distributionRoot: env.DISTRIBUTION_ROOT,
      publicProtocol: normalizeProtocol(env.PUBLIC_PROTOCOL)
    }
  });
}
