import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "./types";

type EmptyRelationships = [];
type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type ProfileRole = "user" | "admin";

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          plan: string;
          role: ProfileRole;
          created_at: string;
        };
        Insert: {
          id: string;
          email: string;
          plan?: string;
          role?: ProfileRole;
          created_at?: string;
        };
        Update: {
          email?: string;
          plan?: string;
          role?: ProfileRole;
        };
        Relationships: EmptyRelationships;
      };
      auth_email_sends: {
        Row: {
          email: string;
          purpose: "signup_confirmation";
          sent_at: string;
          expires_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          email: string;
          purpose: "signup_confirmation";
          sent_at?: string;
          expires_at: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          sent_at?: string;
          expires_at?: string;
          updated_at?: string;
        };
        Relationships: EmptyRelationships;
      };
      sites: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          status: "draft" | "active" | "pending_review" | "blocked" | "deleted";
          active_deployment_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          status?: "draft" | "active" | "pending_review" | "blocked" | "deleted";
          active_deployment_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          status?: "draft" | "active" | "pending_review" | "blocked" | "deleted";
          active_deployment_id?: string | null;
          updated_at?: string;
        };
        Relationships: EmptyRelationships;
      };
      domains: {
        Row: {
          id: string;
          user_id: string;
          site_id: string | null;
          hostname: string;
          type: "platform_subdomain" | "custom_domain";
          status: "active" | "pending_review" | "blocked" | "deleted";
          created_at: string;
          last_binding_change_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          site_id?: string | null;
          hostname: string;
          type: "platform_subdomain" | "custom_domain";
          status?: "active" | "pending_review" | "blocked" | "deleted";
          created_at?: string;
          last_binding_change_at?: string | null;
        };
        Update: {
          site_id?: string | null;
          status?: "active" | "pending_review" | "blocked" | "deleted";
          last_binding_change_at?: string | null;
        };
        Relationships: EmptyRelationships;
      };
      deployments: {
        Row: {
          id: string;
          site_id: string;
          version: number;
          status: "uploading" | "scanning" | "active" | "failed" | "blocked" | "pending_review" | "superseded";
          r2_prefix: string;
          file_count: number;
          total_bytes: number;
          entrypoint: string | null;
          spa_fallback_enabled: boolean;
          risk_score: number;
          created_at: string;
          activated_at: string | null;
        };
        Insert: {
          id?: string;
          site_id: string;
          version: number;
          status?: "uploading" | "scanning" | "active" | "failed" | "blocked" | "pending_review" | "superseded";
          r2_prefix: string;
          file_count?: number;
          total_bytes?: number;
          entrypoint?: string | null;
          spa_fallback_enabled?: boolean;
          risk_score?: number;
          created_at?: string;
          activated_at?: string | null;
        };
        Update: {
          status?: "uploading" | "scanning" | "active" | "failed" | "blocked" | "pending_review" | "superseded";
          file_count?: number;
          total_bytes?: number;
          entrypoint?: string | null;
          spa_fallback_enabled?: boolean;
          risk_score?: number;
          activated_at?: string | null;
        };
        Relationships: EmptyRelationships;
      };
      deployment_files: {
        Row: {
          id: string;
          deployment_id: string;
          path: string;
          size: number;
          content_type: string;
          sha256: string | null;
        };
        Insert: {
          id?: string;
          deployment_id: string;
          path: string;
          size: number;
          content_type: string;
          sha256?: string | null;
        };
        Update: Record<string, never>;
        Relationships: EmptyRelationships;
      };
      upload_sessions: {
        Row: {
          id: string;
          site_id: string;
          user_id: string;
          status: "created" | "uploading" | "completed" | "expired" | "blocked";
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          site_id: string;
          user_id: string;
          status?: "created" | "uploading" | "completed" | "expired" | "blocked";
          expires_at: string;
          created_at?: string;
        };
        Update: {
          status?: "created" | "uploading" | "completed" | "expired" | "blocked";
        };
        Relationships: EmptyRelationships;
      };
      audit_events: {
        Row: {
          id: string;
          user_id: string | null;
          site_id: string | null;
          deployment_id: string | null;
          event_type: string;
          risk_score: number;
          message: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          site_id?: string | null;
          deployment_id?: string | null;
          event_type: string;
          risk_score?: number;
          message: string;
          created_at?: string;
        };
        Update: Record<string, never>;
        Relationships: EmptyRelationships;
      };
      abuse_reports: {
        Row: {
          id: string;
          hostname: string;
          url: string | null;
          reporter_email: string | null;
          reason: string;
          status: "open" | "reviewing" | "resolved" | "rejected";
          created_at: string;
        };
        Insert: {
          id?: string;
          hostname: string;
          url?: string | null;
          reporter_email?: string | null;
          reason: string;
          status?: "open" | "reviewing" | "resolved" | "rejected";
          created_at?: string;
        };
        Update: {
          status?: "open" | "reviewing" | "resolved" | "rejected";
        };
        Relationships: EmptyRelationships;
      };
      plan_catalog: {
        Row: { key: string; label: string; enabled: boolean; monthly_price_cents: number; renewal_price_cents: number; max_sites: number; max_public_sites: number; max_storage_bytes: number; max_deployments_per_day: number; max_upload_sessions_per_hour: number; max_domains_per_site: number; max_files: number; custom_domain: boolean; password_protection: boolean; access_analytics: boolean; remove_branding: boolean; rollback: boolean; source_build: boolean; updated_at: string };
        Insert: { key: string; label: string; enabled?: boolean; monthly_price_cents?: number; renewal_price_cents?: number; max_sites: number; max_public_sites: number; max_storage_bytes: number; max_deployments_per_day: number; max_upload_sessions_per_hour?: number; max_domains_per_site: number; max_files?: number; custom_domain?: boolean; password_protection?: boolean; access_analytics?: boolean; remove_branding?: boolean; rollback?: boolean; source_build?: boolean; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["plan_catalog"]["Insert"]>;
        Relationships: EmptyRelationships;
      };
      domain_pricing: {
        Row: { domain_type: string; label: string; hostname_suffix: string; price_cents: number; billing_period: "month" | "year" | "one_time"; enabled: boolean; cloudflare_zone_id: string | null; cloudflare_zone_status: string | null; cloudflare_nameservers: string[]; cloudflare_dns_record_id: string | null; cloudflare_worker_route_id: string | null; setup_status: "pending_zone" | "pending_nameservers" | "configuring" | "active" | "error"; setup_error: string | null; last_checked_at: string | null; next_check_at: string | null; updated_at: string };
        Insert: { domain_type: string; label: string; hostname_suffix: string; price_cents?: number; billing_period: "month" | "year" | "one_time"; enabled?: boolean; cloudflare_zone_id?: string | null; cloudflare_zone_status?: string | null; cloudflare_nameservers?: string[]; cloudflare_dns_record_id?: string | null; cloudflare_worker_route_id?: string | null; setup_status?: "pending_zone" | "pending_nameservers" | "configuring" | "active" | "error"; setup_error?: string | null; last_checked_at?: string | null; next_check_at?: string | null; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["domain_pricing"]["Insert"]>;
        Relationships: EmptyRelationships;
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_admin_overview: {
        Args: { p_admin_id: string };
        Returns: Json;
      };
      claim_signup_confirmation_email: {
        Args: {
          p_email: string;
          p_ttl_seconds?: number;
        };
        Returns: {
          claimed: boolean;
          sent_at: string;
          expires_at: string;
        }[];
      };
    };
    CompositeTypes: Record<string, never>;
  };
};

function isConfiguredValue(value: string | undefined) {
  return Boolean(value && !value.includes("replace-with") && !value.includes("your-project"));
}

export function hasServiceSupabase(env: Env) {
  return isConfiguredValue(env.SUPABASE_URL) && isConfiguredValue(env.SUPABASE_SERVICE_ROLE_KEY);
}

export function hasAuthSupabase(env: Env) {
  return hasServiceSupabase(env) && isConfiguredValue(env.SUPABASE_ANON_KEY);
}

export function createAuthSupabase(env: Env): SupabaseClient<Database> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new Error("Supabase auth credentials are not configured");
  }

  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

export function createServiceSupabase(env: Env): SupabaseClient<Database> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase service credentials are not configured");
  }

  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}
