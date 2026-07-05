import { getPlatformConfig } from "@qingnest/shared/config/platform";

function normalizeProtocol(value: string | undefined) {
  return value === "http" || value === "https" ? value : undefined;
}

export const clientPlatformConfig = getPlatformConfig({
  domains: {
    appHost: import.meta.env.VITE_APP_HOST,
    distributionRoot: import.meta.env.VITE_DISTRIBUTION_ROOT,
    publicProtocol: normalizeProtocol(import.meta.env.VITE_PUBLIC_PROTOCOL)
  }
});
