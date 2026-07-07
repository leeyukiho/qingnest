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
