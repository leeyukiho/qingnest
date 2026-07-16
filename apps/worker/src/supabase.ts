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
          plan_expires_at: string | null;
          role: ProfileRole;
          created_at: string;
        };
        Insert: {
          id: string;
          email: string;
          plan?: string;
          plan_expires_at?: string | null;
          role?: ProfileRole;
          created_at?: string;
        };
        Update: {
          email?: string;
          plan?: string;
          plan_expires_at?: string | null;
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
          expires_at: string;
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
          expires_at?: string;
          last_binding_change_at?: string | null;
        };
        Update: {
          site_id?: string | null;
          status?: "active" | "pending_review" | "blocked" | "deleted";
          expires_at?: string;
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
        Row: { key: string; label: string; enabled: boolean; monthly_price_cents: number; renewal_price_cents: number; max_sites: number; max_public_sites: number; max_storage_bytes: number; max_deployments_per_day: number; max_upload_sessions_per_hour: number; max_domains_per_site: number; max_site_bytes: number; max_files: number; custom_domain: boolean; password_protection: boolean; access_analytics: boolean; remove_branding: boolean; rollback: boolean; source_build: boolean; updated_at: string };
        Insert: { key: string; label: string; enabled?: boolean; monthly_price_cents?: number; renewal_price_cents?: number; max_sites: number; max_public_sites: number; max_storage_bytes: number; max_deployments_per_day: number; max_upload_sessions_per_hour?: number; max_domains_per_site: number; max_site_bytes?: number; max_files?: number; custom_domain?: boolean; password_protection?: boolean; access_analytics?: boolean; remove_branding?: boolean; rollback?: boolean; source_build?: boolean; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["plan_catalog"]["Insert"]>;
        Relationships: EmptyRelationships;
      };
      domain_pricing: {
        Row: { domain_type: string; label: string; hostname_suffix: string; price_cents: number; billing_period: "month" | "year" | "one_time"; monthly_price_cents: number; quarterly_price_cents: number; semiannual_price_cents: number; annual_price_cents: number; renewal_window_days: number; max_advance_months: number; enabled: boolean; cloudflare_zone_id: string | null; cloudflare_zone_status: string | null; cloudflare_nameservers: string[]; cloudflare_dns_record_id: string | null; cloudflare_worker_route_id: string | null; setup_status: "pending_zone" | "pending_nameservers" | "configuring" | "active" | "error"; setup_error: string | null; last_checked_at: string | null; next_check_at: string | null; updated_at: string };
        Insert: { domain_type: string; label: string; hostname_suffix: string; price_cents?: number; billing_period: "month" | "year" | "one_time"; monthly_price_cents?: number; quarterly_price_cents?: number; semiannual_price_cents?: number; annual_price_cents?: number; renewal_window_days?: number; max_advance_months?: number; enabled?: boolean; cloudflare_zone_id?: string | null; cloudflare_zone_status?: string | null; cloudflare_nameservers?: string[]; cloudflare_dns_record_id?: string | null; cloudflare_worker_route_id?: string | null; setup_status?: "pending_zone" | "pending_nameservers" | "configuring" | "active" | "error"; setup_error?: string | null; last_checked_at?: string | null; next_check_at?: string | null; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["domain_pricing"]["Insert"]>;
        Relationships: EmptyRelationships;
      };
      orders: {
        Row: { id: string; order_no: string; user_id: string; type: "plan_subscription" | "domain_rental" | "domain_renewal"; status: "pending" | "payment_failed" | "paid" | "fulfilling" | "fulfilled" | "fulfillment_failed" | "expired" | "refund_pending" | "refunded" | "cancelled"; currency: "CNY"; amount_cents: number; product_key: string; product_name: string; product_snapshot: Json; provider: "fm"; provider_order_id: string | null; pay_url: string | null; expires_at: string; paid_at: string | null; fulfilled_at: string | null; failure_code: string | null; failure_message: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; order_no: string; user_id: string; type: "plan_subscription" | "domain_rental" | "domain_renewal"; status?: Database["public"]["Tables"]["orders"]["Row"]["status"]; currency?: "CNY"; amount_cents: number; product_key: string; product_name: string; product_snapshot: Json; provider?: "fm"; provider_order_id?: string | null; pay_url?: string | null; expires_at: string; paid_at?: string | null; fulfilled_at?: string | null; failure_code?: string | null; failure_message?: string | null; created_at?: string; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["orders"]["Insert"]>;
        Relationships: EmptyRelationships;
      };
      payments: {
        Row: { id: string; order_id: string; provider: "fm"; provider_order_id: string; channel_order_no: string | null; status: "success" | "refunded"; amount_cents: number; actual_amount_cents: number; pay_type: string; payee: string | null; paid_at: string; signature_valid: boolean; source: "notify" | "query" | "admin"; raw_payload: Json; received_at: string };
        Insert: Omit<Database["public"]["Tables"]["payments"]["Row"], "id" | "received_at"> & { id?: string; received_at?: string };
        Update: Partial<Database["public"]["Tables"]["payments"]["Insert"]>;
        Relationships: EmptyRelationships;
      };
      domain_reservations: {
        Row: { id: string; order_id: string; user_id: string; hostname: string; status: "active" | "converted" | "released"; expires_at: string; created_at: string; updated_at: string };
        Insert: Omit<Database["public"]["Tables"]["domain_reservations"]["Row"], "id" | "created_at" | "updated_at"> & { id?: string; created_at?: string; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["domain_reservations"]["Insert"]>;
        Relationships: EmptyRelationships;
      };
      fulfillment_jobs: {
        Row: { id: string; order_id: string; type: "plan_subscription" | "domain_rental" | "domain_renewal"; status: "pending" | "processing" | "completed" | "failed"; attempts: number; last_error: string | null; next_attempt_at: string | null; created_at: string; completed_at: string | null; updated_at: string };
        Insert: { id?: string; order_id: string; type: Database["public"]["Tables"]["fulfillment_jobs"]["Row"]["type"]; status?: Database["public"]["Tables"]["fulfillment_jobs"]["Row"]["status"]; attempts?: number; last_error?: string | null; next_attempt_at?: string | null; created_at?: string; completed_at?: string | null; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["fulfillment_jobs"]["Insert"]>;
        Relationships: EmptyRelationships;
      };
      refunds: {
        Row: { id: string; order_id: string; amount_cents: number; status: "pending" | "completed" | "rejected"; reason: string; channel_reference: string | null; operator_id: string | null; created_at: string; completed_at: string | null };
        Insert: Omit<Database["public"]["Tables"]["refunds"]["Row"], "id" | "created_at"> & { id?: string; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["refunds"]["Insert"]>;
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
      create_plan_payment_order: { Args: { p_user_id: string; p_order_no: string; p_plan_key: string; p_duration_months: number; p_expires_at: string }; Returns: Database["public"]["Tables"]["orders"]["Row"] };
      create_domain_payment_order: { Args: { p_user_id: string; p_order_no: string; p_hostname: string; p_hostname_suffix: string; p_duration_months: number; p_expires_at: string }; Returns: Database["public"]["Tables"]["orders"]["Row"] };
      create_domain_renewal_order: { Args: { p_user_id: string; p_order_no: string; p_domain_id: string; p_duration_months: number; p_expires_at: string }; Returns: Database["public"]["Tables"]["orders"]["Row"] };
      confirm_fm_payment: { Args: { p_order_no: string; p_provider_order_id: string; p_channel_order_no: string; p_amount_cents: number; p_actual_amount_cents: number; p_pay_type: string; p_payee: string; p_paid_at: string; p_source: "notify" | "query" | "admin"; p_raw_payload: Json }; Returns: Json };
      record_order_refund: { Args: { p_order_id: string; p_operator_id: string; p_reason: string; p_channel_reference: string }; Returns: Json };
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
