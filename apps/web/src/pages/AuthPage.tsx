import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { AnimatePresence, motion } from "framer-motion";
import { BadgeCheck, Eye, EyeOff, Loader2, Lock, LogIn } from "lucide-react";
import { signUpWithEmailPassword, type SignUpConfirmationResult } from "@/lib/api";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { AuroraHero } from "@/components/ui/hero-2";
import { HoverBorderGradient } from "@/components/ui/hover-border-gradient";
import { TextHoverEffect } from "@/components/ui/text-hover-effect";
import {
  AUTH_TOGGLE_ACTIVE_CLASS,
  AUTH_TOGGLE_BUTTON_CLASS,
  AUTH_TOGGLE_INACTIVE_CLASS,
  CONTENT_TRACK_CLASS,
  PRIMARY_CTA_BUTTON_CLASS
} from "@/app/ui";
import {
  clearSignupConfirmationEmail,
  getAuthErrorMessage,
  getSignupConfirmationNotice,
  isSessionEmailConfirmed,
  normalizeAuthEmail,
  rememberSignupConfirmationEmail,
  type AuthMode,
  type AuthStatus
} from "@/app/auth";
import { STUDIO_PATH } from "@/app/navigation";
import { cn } from "@/lib/utils";

export function AuthPage({
  initialMode,
  onAuthenticated,
  onNavigate,
  status
}: {
  initialMode: AuthMode;
  onAuthenticated: (nextSession: Session) => void;
  onNavigate: (path: string, options?: { replace?: boolean }) => void;
  status: AuthStatus;
}) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [signUpComplete, setSignUpComplete] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMode(initialMode);
    if (initialMode === "sign_in") setPasswordConfirmation("");
  }, [initialMode]);

  useEffect(() => {
    if (status === "verified") {
      setMode("sign_in");
      setPasswordConfirmation("");
      setNotice("邮箱已验证。你现在可以输入注册时设置的密码登录。");
      setError(null);
      setSignUpComplete(false);
      return;
    }

    if (status === "pending_confirmation") {
      setMode("sign_in");
      setPasswordConfirmation("");
      setNotice("请先打开注册邮件完成邮箱验证，验证成功后再用密码登录。");
      setError(null);
      setSignUpComplete(false);
    }
  }, [status]);

  function moveToSignInAfterSignup(result: SignUpConfirmationResult) {
    const normalizedEmail = normalizeAuthEmail(result.email);

    setEmail(normalizedEmail);
    setPassword("");
    setPasswordConfirmation("");
    setMode("sign_in");
    setNotice(getSignupConfirmationNotice());
    setError(null);
    setSignUpComplete(false);
    onNavigate("/auth?mode=sign_in", { replace: true });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setError(null);

    if (!supabase || !isSupabaseConfigured) {
      setError("Supabase 尚未配置，请先填写 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY。");
      return;
    }

    const normalizedEmail = normalizeAuthEmail(email);

    if (!normalizedEmail) {
      setError("请输入邮箱。");
      return;
    }

    if (password.length < 6) {
      setError("密码至少需要 6 位。");
      return;
    }

    if (mode === "sign_up" && password !== passwordConfirmation) {
      setError("两次输入的密码不一致。");
      return;
    }

    setSubmitting(true);

    try {
      if (mode === "sign_up") {
        const signUpResult = await signUpWithEmailPassword({
          email: normalizedEmail,
          password,
          redirectTo: `${window.location.origin}/auth?mode=sign_in&verified=1`
        });

        rememberSignupConfirmationEmail(normalizedEmail, signUpResult);

        moveToSignInAfterSignup(signUpResult);
      } else {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password
        });

        if (signInError) throw signInError;

        if (!isSessionEmailConfirmed(data.session)) {
          await supabase.auth.signOut();
          throw new Error("Email not confirmed");
        }

        clearSignupConfirmationEmail(normalizedEmail);
        if (data.session) onAuthenticated(data.session);
        onNavigate(STUDIO_PATH);
      }
    } catch (authError) {
      const message = authError instanceof Error ? authError.message : "认证失败";
      const friendlyMessage = getAuthErrorMessage(message);

      if (friendlyMessage.includes("已注册")) {
        clearSignupConfirmationEmail(normalizedEmail);
        setEmail(normalizedEmail);
        setMode("sign_in");
        setPassword("");
        setPasswordConfirmation("");
        setNotice(null);
        onNavigate("/auth?mode=sign_in", { replace: true });
      }

      setError(friendlyMessage);
    } finally {
      setSubmitting(false);
    }
  }

  const statusMessage = error ?? notice;
  const statusTone = error ? "error" : notice ? "success" : null;

  return (
    <AuroraHero className="min-h-dvh">
      <section className={cn(CONTENT_TRACK_CLASS, "grid min-h-dvh items-center gap-6 pb-10 pt-24 lg:grid-cols-[1fr_28rem]")}>
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="max-w-3xl"
          initial={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.46, ease: "easeOut" }}
        >
          <h1 className="sr-only">QingNest</h1>
          <div className="aspect-[4/1] w-full max-w-[40rem] overflow-visible">
            <TextHoverEffect revealRadius={540} text="QingNest" />
          </div>
          <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-300 sm:text-lg">
            一键发布静态站点，自动检查文件风险，注册即赠永久域名，让 AI 页面和个人作品更快上线分享。
          </p>
        </motion.div>

        <motion.form
          animate={{ opacity: 1, y: 0 }}
          className="glass-surface rounded-lg p-5 sm:p-6"
          initial={{ opacity: 0, y: 24 }}
          onSubmit={handleSubmit}
          transition={{ delay: 0.08, duration: 0.48, ease: "easeOut" }}
        >
          <div className="grid grid-cols-2 gap-2 rounded-lg border border-white/10 bg-white/[0.04] p-1">
            {(["sign_in", "sign_up"] as const).map((item) => (
              <button
                className={cn(
                  AUTH_TOGGLE_BUTTON_CLASS,
                  mode === item ? AUTH_TOGGLE_ACTIVE_CLASS : AUTH_TOGGLE_INACTIVE_CLASS
                )}
                key={item}
                onClick={() => {
                  setMode(item);
                  setError(null);
                  setSignUpComplete(false);
                  setPasswordConfirmation("");
                }}
                type="button"
              >
                {item === "sign_in" ? "登录" : "注册"}
              </button>
            ))}
          </div>

          <label className="mt-5 block text-sm font-medium text-zinc-200" htmlFor="auth-email">
            邮箱
          </label>
          <input
            autoComplete="email"
            className="mt-2 h-11 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-sm text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-cyan-300"
            id="auth-email"
            onChange={(event) => {
              setEmail(event.target.value);
              setSignUpComplete(false);
            }}
            placeholder="you@example.com"
            required
            type="email"
            value={email}
          />

          <label className="mt-4 block text-sm font-medium text-zinc-200" htmlFor="auth-password">
            密码
          </label>
          <div className="relative mt-2">
            <input
              autoComplete={mode === "sign_in" ? "current-password" : "new-password"}
              className="h-11 w-full rounded-lg border border-white/10 bg-black/40 py-0 pl-3 pr-11 text-sm text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-cyan-300"
              id="auth-password"
              onChange={(event) => {
                setPassword(event.target.value);
                setSignUpComplete(false);
              }}
              placeholder="至少 6 位"
              required
              type={passwordVisible ? "text" : "password"}
              value={password}
            />
            <button
              aria-label={passwordVisible ? "隐藏密码" : "显示密码"}
              className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
              onClick={() => setPasswordVisible((visible) => !visible)}
              type="button"
            >
              {passwordVisible ? (
                <EyeOff aria-hidden="true" className="h-4 w-4" strokeWidth={1.9} />
              ) : (
                <Eye aria-hidden="true" className="h-4 w-4" strokeWidth={1.9} />
              )}
            </button>
          </div>

          {mode === "sign_up" ? (
            <>
              <label className="mt-4 block text-sm font-medium text-zinc-200" htmlFor="auth-password-confirmation">
                确认密码
              </label>
              <div className="relative mt-2">
                <input
                  autoComplete="new-password"
                  className="h-11 w-full rounded-lg border border-white/10 bg-black/40 py-0 pl-3 pr-11 text-sm text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-cyan-300"
                  id="auth-password-confirmation"
                  onChange={(event) => {
                    setPasswordConfirmation(event.target.value);
                    setSignUpComplete(false);
                  }}
                  placeholder="再次输入密码"
                  required
                  type={passwordVisible ? "text" : "password"}
                  value={passwordConfirmation}
                />
                <button
                  aria-label={passwordVisible ? "隐藏密码" : "显示密码"}
                  className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                  onClick={() => setPasswordVisible((visible) => !visible)}
                  type="button"
                >
                  {passwordVisible ? (
                    <EyeOff aria-hidden="true" className="h-4 w-4" strokeWidth={1.9} />
                  ) : (
                    <Eye aria-hidden="true" className="h-4 w-4" strokeWidth={1.9} />
                  )}
                </button>
              </div>
            </>
          ) : null}

          <div className="mt-2 h-8 overflow-hidden">
            <AnimatePresence initial={false} mode="wait">
              {statusMessage ? (
                <motion.p
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "flex h-full items-center gap-1.5 overflow-hidden rounded-lg border px-2.5 text-[11px] leading-none",
                    statusTone === "error"
                      ? "border-rose-300/20 bg-rose-400/10 text-rose-100"
                      : "border-emerald-300/20 bg-emerald-400/10 text-emerald-100"
                  )}
                  exit={{ opacity: 0, y: -6 }}
                  initial={{ opacity: 0, y: 6 }}
                  key={`${statusTone}:${statusMessage}`}
                  title={statusMessage}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                >
                  {statusTone === "error" ? (
                    <Lock aria-hidden="true" className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                  ) : (
                    <BadgeCheck aria-hidden="true" className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                  )}
                  <span className="min-w-0 truncate whitespace-nowrap leading-none">{statusMessage}</span>
                </motion.p>
              ) : null}
            </AnimatePresence>
          </div>

          <HoverBorderGradient
            alwaysOn
            aria-label={mode === "sign_in" ? "登录" : "注册"}
            as="button"
            className={cn("h-11 w-full", PRIMARY_CTA_BUTTON_CLASS)}
            containerClassName="mt-4 w-full rounded-full"
            disabled={submitting || (mode === "sign_up" && signUpComplete)}
            type="submit"
          >
            {submitting ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <LogIn aria-hidden="true" className="h-4 w-4" />}
            <span>{mode === "sign_in" ? "登录" : signUpComplete ? "验证邮件已发送" : "注册并发送验证邮件"}</span>
          </HoverBorderGradient>
        </motion.form>
      </section>
    </AuroraHero>
  );
}
