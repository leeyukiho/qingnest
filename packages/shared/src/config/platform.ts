import rawConfig from "../../config/platform.json";
import { platformConfigSchema, type PlatformConfig } from "./schema";

export const platformConfig: PlatformConfig = platformConfigSchema.parse(rawConfig);

export type DomainConfig = PlatformConfig["domains"];

type PlatformConfigOverrides = {
  domains?: Partial<DomainConfig>;
};

function cleanDomainOverrides(overrides: Partial<DomainConfig> | undefined) {
  return Object.fromEntries(
    Object.entries(overrides ?? {}).filter(([, value]) => typeof value === "string" && value.trim().length > 0)
  ) as Partial<DomainConfig>;
}

export function getPlatformConfig(overrides: PlatformConfigOverrides = {}) {
  return platformConfigSchema.parse({
    ...platformConfig,
    domains: {
      ...platformConfig.domains,
      ...cleanDomainOverrides(overrides.domains)
    }
  });
}

export function getPlanConfig(plan: string | null | undefined) {
  return platformConfig.plans[plan ?? "free"] ?? platformConfig.plans.free;
}

export function getPublicSiteUrl(subdomain: string, domains: DomainConfig = platformConfig.domains) {
  const { publicProtocol, distributionRoot } = domains;
  return `${publicProtocol}://${subdomain}.${distributionRoot}`;
}

export function isReservedSubdomain(subdomain: string) {
  const normalized = subdomain.toLowerCase();
  return platformConfig.subdomainPolicy.reserved.includes(normalized);
}

export function validateSubdomain(subdomain: string) {
  const normalized = subdomain.trim().toLowerCase();
  const policy = platformConfig.subdomainPolicy;
  const pattern = new RegExp(policy.pattern);

  if (normalized.length < policy.minLength || normalized.length > policy.maxLength) {
    return {
      ok: false,
      normalized,
      reason: `子域名长度必须是 ${policy.minLength}-${policy.maxLength} 个字符`
    };
  }

  if (!pattern.test(normalized)) {
    return {
      ok: false,
      normalized,
      reason: "只能使用小写字母、数字和短横线，且不能以短横线开头或结尾"
    };
  }

  if (policy.disallowConsecutiveHyphen && normalized.includes("--")) {
    return {
      ok: false,
      normalized,
      reason: "不能包含连续短横线"
    };
  }

  if (isReservedSubdomain(normalized)) {
    return {
      ok: false,
      normalized,
      reason: "这个子域名是平台保留词"
    };
  }

  const requiresReview = policy.manualReviewKeywords.some((keyword) => normalized.includes(keyword));
  return { ok: true, normalized, requiresReview };
}


