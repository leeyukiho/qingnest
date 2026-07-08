import type { Session } from "@supabase/supabase-js";

export type AuthMode = "sign_in" | "sign_up";
export type AuthStatus = "verified" | "pending_confirmation" | null;
type SignupConfirmationRecord = {
  sentAt: number;
  expiresAt: number;
};
type SignupConfirmationStore = Record<string, SignupConfirmationRecord>;

const SIGNUP_CONFIRMATION_STORAGE_KEY = "qingnest:signup-confirmation-email";
const SIGNUP_CONFIRMATION_TTL_MS = 24 * 60 * 60 * 1000;

export function getAuthMode(search: string): AuthMode {
  return new URLSearchParams(search).get("mode") === "sign_up" ? "sign_up" : "sign_in";
}

export function getAuthStatus(search: string): AuthStatus {
  const params = new URLSearchParams(search);

  if (params.get("verified") === "1") return "verified";
  if (params.get("pending_confirmation") === "1") return "pending_confirmation";

  return null;
}

export function getAuthErrorMessage(message: string) {
  if (/email not confirmed/i.test(message)) {
    return "邮箱未验证，请先完成邮件验证后登录。";
  }

  if (/invalid login credentials/i.test(message)) {
    return "邮箱或密码不正确。";
  }

  if (/user already registered/i.test(message)) {
    return "邮箱已注册，可直接登录。";
  }

  return message;
}

export function isSessionEmailConfirmed(session: Session | null) {
  return Boolean(session?.user.email_confirmed_at ?? session?.user.confirmed_at);
}

export function normalizeAuthEmail(value: string) {
  return value.trim().toLowerCase();
}

function isSignupConfirmationRecord(value: unknown): value is SignupConfirmationRecord {
  if (typeof value !== "object" || value === null) return false;

  const record = value as Partial<SignupConfirmationRecord>;
  return typeof record.sentAt === "number" && typeof record.expiresAt === "number";
}

function readSignupConfirmationStore(): SignupConfirmationStore {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(SIGNUP_CONFIRMATION_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};

    const now = Date.now();
    const store: SignupConfirmationStore = {};

    for (const [email, record] of Object.entries(parsed)) {
      if (isSignupConfirmationRecord(record) && record.expiresAt > now) {
        store[email] = record;
      }
    }

    return store;
  } catch {
    return {};
  }
}

function writeSignupConfirmationStore(store: SignupConfirmationStore) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(SIGNUP_CONFIRMATION_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // A blocked localStorage should not prevent signup.
  }
}

export function rememberSignupConfirmationEmail(email: string, serverRecord?: { sentAt: string; expiresAt: string }) {
  const now = Date.now();
  const sentAt = serverRecord ? Date.parse(serverRecord.sentAt) : now;
  const expiresAt = serverRecord ? Date.parse(serverRecord.expiresAt) : now + SIGNUP_CONFIRMATION_TTL_MS;
  const store = readSignupConfirmationStore();

  store[email] = {
    sentAt: Number.isNaN(sentAt) ? now : sentAt,
    expiresAt: Number.isNaN(expiresAt) ? now + SIGNUP_CONFIRMATION_TTL_MS : expiresAt
  };

  writeSignupConfirmationStore(store);
  return store[email];
}

export function clearSignupConfirmationEmail(email: string) {
  const store = readSignupConfirmationStore();
  if (!store[email]) return;

  delete store[email];
  writeSignupConfirmationStore(store);
}

export function getSignupConfirmationNotice() {
  return "验证邮件已发送，请完成邮箱验证后登录。";
}
