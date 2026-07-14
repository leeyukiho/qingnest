import { z } from "zod";

const planSchema = z.object({
  label: z.string(),
  enabled: z.boolean(),
  requirements: z.object({
    requireEmailVerified: z.boolean(),
    requireTurnstile: z.boolean(),
    manualReviewOnHighRisk: z.boolean()
  }),
  quotas: z.object({
    user: z.object({
      maxSites: z.number().int().positive(),
      maxPublicSites: z.number().int().positive(),
      maxStorageBytes: z.number().int().positive(),
      maxDeploymentsPerDay: z.number().int().positive(),
      maxUploadSessionsPerHour: z.number().int().positive()
    }),
    site: z.object({
      maxSiteBytes: z.number().int().positive(),
      maxRetainedDeployments: z.number().int().positive(),
      maxDomainsPerSite: z.number().int().positive()
    }),
    deployment: z.object({
      maxArchiveBytes: z.number().int().positive(),
      maxFileBytes: z.number().int().positive(),
      maxFiles: z.number().int().positive(),
      maxPathLength: z.number().int().positive(),
      uploadSessionTtlMinutes: z.number().int().positive()
    }),
    traffic: z.object({
      maxRequestsPerMinute: z.number().int().positive(),
      maxRequestsPerDay: z.number().int().positive(),
      maxBandwidthBytesPerMonth: z.number().int().positive()
    })
  }),
  capabilities: z.object({
    customDomain: z.boolean(),
    passwordProtection: z.boolean(),
    accessAnalytics: z.boolean(),
    removeBranding: z.boolean(),
    rollback: z.boolean(),
    sourceBuild: z.boolean()
  })
});

export const platformConfigSchema = z.object({
  brand: z.object({
    name: z.string(),
    cnName: z.string(),
    supportEmail: z.string().email(),
    abuseEmail: z.string().email()
  }),
  domains: z.object({
    appHost: z.string(),
    distributionRoot: z.string(),
    publicProtocol: z.enum(["http", "https"])
  }),
  subdomainPolicy: z.object({
    minLength: z.number().int().positive(),
    maxLength: z.number().int().positive(),
    pattern: z.string(),
    disallowConsecutiveHyphen: z.boolean(),
    reserved: z.array(z.string()),
    manualReviewKeywords: z.array(z.string())
  }),
  plans: z.record(planSchema),
  abuseControls: z.object({
    newUserCooldownMinutes: z.number().int().nonnegative(),
    maxSitesCreatedPerHour: z.number().int().positive(),
    maxFailedDeploymentsPerHour: z.number().int().positive(),
    autoBlockRiskScore: z.number().int().positive(),
    manualReviewRiskScore: z.number().int().positive(),
    rateLimitWindowSeconds: z.number().int().positive()
  }),
  deployment: z.object({
    acceptedArchiveExtensions: z.array(z.string()),
    entrypoints: z.array(z.string()),
    staticOutputDirectories: z.array(z.string()),
    sourceIndicators: z.array(z.string()),
    blockedPaths: z.array(z.string()),
    spaFallbackDefault: z.boolean(),
    maxPreviewHtmlBytes: z.number().int().positive()
  }),
  riskRules: z.object({
    highRiskKeywords: z.array(z.string()),
    externalFormActionRiskScore: z.number().int().nonnegative(),
    passwordInputRiskScore: z.number().int().nonnegative(),
    obfuscatedScriptRiskScore: z.number().int().nonnegative(),
    highRiskThreshold: z.number().int().positive(),
    manualReviewThreshold: z.number().int().positive()
  }),
  mimeTypes: z.record(z.string()),
  cache: z.object({
    html: z.string(),
    assetsWithHash: z.string(),
    assetsDefault: z.string()
  }),
  securityHeaders: z.record(z.string())
});

export type PlatformConfig = z.infer<typeof platformConfigSchema>;
export type PlanKey = keyof PlatformConfig["plans"];
