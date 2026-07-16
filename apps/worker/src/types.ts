export type Env = {
  ENVIRONMENT: string;
  APP_HOST?: string;
  DISTRIBUTION_ROOT?: string;
  PUBLIC_PROTOCOL?: "http" | "https";
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  RESEND_FROM_NAME?: string;
  SITE_ASSETS?: R2Bucket;
  DOMAIN_MAP?: KVNamespace;
  TRAFFIC_ANALYTICS?: AnalyticsEngineDataset;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_ZONE_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_WORKER_SCRIPT?: string;
  CLOUDFLARE_R2_BUCKET_NAME?: string;
  CLOUDFLARE_KV_NAMESPACE_ID?: string;
  FM_API_BASE_URL?: string;
  FM_MERCHANT_NUM?: string;
  FM_SECRET?: string;
  FM_PAY_TYPE?: "aloop";
  FM_NOTIFY_URL?: string;
  FM_RETURN_URL?: string;
  FM_QUERY_ENABLED?: string;
  FM_PAY_URL_HOSTS?: string;
};

export type ApiResponse<T> = {
  ok: boolean;
  data?: T;
  error?: string;
};

export type DomainMapping = {
  hostname: string;
  siteId: string;
  deploymentId: string;
  r2Prefix: string;
  spaFallbackEnabled: boolean;
  status: "active" | "pending_review" | "blocked";
};
