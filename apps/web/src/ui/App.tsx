import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { AnimatePresence, LayoutGroup, motion, type Variants } from "framer-motion";
import {
  ArrowDown,
  BadgeCheck,
  Check,
  Crown,
  Globe2,
  LayoutDashboard,
  Loader2,
  Lock,
  LogIn,
  MailCheck,
  Plus,
  ScanSearch,
  ShieldCheck,
  UploadCloud,
  UserRound
} from "lucide-react";
import {
  checkSubdomain,
  createSite,
  getAdminOverview,
  getCurrentAccount,
  setAccessTokenProvider,
  signUpWithEmailPassword,
  type AccountProfile,
  type AdminOverview,
  type SiteDraft,
  type SubdomainCheck
} from "@/lib/api";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { EncryptedText } from "@/components/ui/encrypted-text";
import { FloatingDock, type FloatingDockItem } from "@/components/ui/floating-dock";
import { AuroraHero } from "@/components/ui/hero-2";
import { HoverBorderGradient } from "@/components/ui/hover-border-gradient";
import { Navbar, NavbarButton, NavbarLogo, NavBody } from "@/components/ui/resizable-navbar";
import { SparklesCore } from "@/components/ui/sparkles";
import { TextHoverEffect } from "@/components/ui/text-hover-effect";
import { cn } from "@/lib/utils";

const pageVariants: Variants = {
  enter: (direction: number) => ({
    opacity: 0,
    y: direction > 0 ? 42 : -42
  }),
  center: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.48,
      ease: [0.22, 1, 0.36, 1]
    }
  },
  exit: (direction: number) => ({
    opacity: 0,
    y: direction > 0 ? -42 : 42,
    transition: {
      duration: 0.28,
      ease: [0.4, 0, 0.2, 1]
    }
  })
};

const CONTENT_TRACK_CLASS = "mx-auto w-[calc(100vw-32px)] max-w-7xl sm:w-[calc(100vw-48px)]";
const BRAND_LAYOUT_ID = "qingnest-wordmark";
const SIGNUP_CONFIRMATION_STORAGE_KEY = "qingnest:signup-confirmation-email";
const SIGNUP_CONFIRMATION_TTL_MS = 24 * 60 * 60 * 1000;

type AppLocation = {
  pathname: string;
  search: string;
  hash: string;
};

type AuthMode = "sign_in" | "sign_up";
type AuthStatus = "verified" | "pending_confirmation" | null;
type SignupConfirmationRecord = {
  sentAt: number;
  expiresAt: number;
};
type SignupConfirmationStore = Record<string, SignupConfirmationRecord>;

const steps = [
  {
    accentClass: "border-cyan-200/30 bg-cyan-400/10 text-cyan-100",
    description: "导出 AI 生成或本地开发完成的静态页面，打包为包含入口 HTML 的 ZIP。",
    dockTitle: "上传",
    icon: UploadCloud,
    title: "准备站点包"
  },
  {
    accentClass: "border-sky-200/30 bg-sky-400/10 text-sky-100",
    description: "上传后自动检查入口文件、资源路径、文件规模和潜在发布风险。",
    dockTitle: "检查",
    icon: ScanSearch,
    title: "上传并检查"
  },
  {
    accentClass: "border-amber-200/30 bg-amber-400/10 text-amber-100",
    description: "邮箱验证完成后创建站点，确认发布后生成可访问链接。",
    dockTitle: "发布",
    icon: Globe2,
    title: "生成访问链接"
  }
];

function getBrowserLocation(): AppLocation {
  if (typeof window === "undefined") {
    return { pathname: "/", search: "", hash: "" };
  }

  return {
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash
  };
}

function isHomePathname(pathname: string) {
  return pathname === "/" || pathname === "/index.html";
}

function getInitialPage() {
  if (typeof window === "undefined") return 0;

  return isHomePathname(window.location.pathname) && window.location.hash === "#steps" ? 1 : 0;
}

function getAuthMode(search: string): AuthMode {
  return new URLSearchParams(search).get("mode") === "sign_up" ? "sign_up" : "sign_in";
}

function getAuthStatus(search: string): AuthStatus {
  const params = new URLSearchParams(search);

  if (params.get("verified") === "1") return "verified";
  if (params.get("pending_confirmation") === "1") return "pending_confirmation";

  return null;
}

function getAuthErrorMessage(message: string) {
  if (/email not confirmed/i.test(message)) {
    return "邮箱还没有验证。请在 24 小时内打开注册邮件中的验证链接，验证后再登录。";
  }

  if (/invalid login credentials/i.test(message)) {
    return "邮箱或密码不正确。";
  }

  if (/user already registered/i.test(message)) {
    return "这个邮箱已经注册，可以直接登录。";
  }

  return message;
}

function isSessionEmailConfirmed(session: Session | null) {
  return Boolean(session?.user.email_confirmed_at ?? session?.user.confirmed_at);
}

function normalizeAuthEmail(value: string) {
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

function getSignupConfirmationRecord(email: string) {
  return readSignupConfirmationStore()[email] ?? null;
}

function rememberSignupConfirmationEmail(email: string, serverRecord?: { sentAt: string; expiresAt: string }) {
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

function clearSignupConfirmationEmail(email: string) {
  const store = readSignupConfirmationStore();
  if (!store[email]) return;

  delete store[email];
  writeSignupConfirmationStore(store);
}

function formatConfirmationExpiry(expiresAt: number) {
  return new Date(expiresAt).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getSignupConfirmationNotice(record: SignupConfirmationRecord) {
  return `验证邮件已经发送，请不要重复点击。请在 ${formatConfirmationExpiry(record.expiresAt)} 前完成邮箱验证；验证后可以从邮件直接进入 QingNest，也可以回到这里切换到登录并输入密码。`;
}

function SiteNavbar({
  animateBrand,
  authReady,
  compact,
  firstScreen,
  isAuthenticated,
  onNavigate
}: {
  animateBrand: boolean;
  authReady: boolean;
  compact: boolean;
  firstScreen: boolean;
  isAuthenticated: boolean;
  onNavigate: (path: string) => void;
}) {
  return (
    <Navbar forceScrolled={compact} showDivider={!firstScreen}>
      <NavBody className={firstScreen ? "!justify-end" : undefined}>
        {!firstScreen ? (
          <NavbarLogo
            animateSubtitle={animateBrand}
            layoutId={animateBrand ? BRAND_LAYOUT_ID : undefined}
            onClick={(event) => {
              event.preventDefault();
              onNavigate("/");
            }}
            showUnderline={!firstScreen}
          />
        ) : null}
        <div className="flex items-center gap-4 sm:gap-5">
          <NavbarButton aria-label="定价" showUnderline={!firstScreen} variant="secondary">
            定价
          </NavbarButton>
          {isAuthenticated ? (
            <NavbarButton aria-label="工作台" onClick={() => onNavigate("/app")} showUnderline={!firstScreen} variant="secondary">
              工作台
            </NavbarButton>
          ) : null}
          <NavbarButton
            aria-label="登录"
            disabled={!authReady}
            onClick={() => onNavigate("/auth")}
            showUnderline={!firstScreen}
            variant="secondary"
          >
            登录
          </NavbarButton>
        </div>
      </NavBody>
    </Navbar>
  );
}

function BrandSignal() {
  return (
    <div
      className="pointer-events-none relative mx-auto -mt-2 h-24 w-[calc(100vw-2rem)] max-w-[42rem] overflow-hidden sm:-mt-4 sm:h-32 md:-mt-6 md:h-40"
      data-particle-clear-zone="qingnest"
    >
      <div className="absolute inset-x-[13%] top-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-300 to-transparent blur-[2px]" />
      <div className="absolute inset-x-[13%] top-0 h-px bg-gradient-to-r from-transparent via-sky-100 to-transparent shadow-[0_0_22px_rgba(56,189,248,0.62)]" />
      <div className="absolute inset-x-[38%] top-0 h-[5px] bg-gradient-to-r from-transparent via-blue-400 to-transparent blur-sm" />
      <div className="absolute inset-x-[38%] top-0 h-px bg-gradient-to-r from-transparent via-cyan-100 to-transparent" />
      <SparklesCore
        background="transparent"
        className="h-full w-full [mask-image:radial-gradient(360px_210px_at_top,white_18%,white_48%,transparent_82%)]"
        maxSize={1.15}
        minSize={0.35}
        particleColor="#7dd3fc"
        particleDensity={520}
      />
    </div>
  );
}

function QingNestMark({ layoutId }: { layoutId?: string }) {
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="relative flex w-full max-w-6xl flex-col items-center justify-center overflow-visible"
      initial={{ opacity: 0, y: 24 }}
      transition={{ delay: 0.08, duration: 0.56, ease: "easeOut" }}
    >
      <h1 className="sr-only">QingNest</h1>
      <motion.div
        className="relative z-20 mx-auto aspect-[4/1] w-full max-w-[48rem] overflow-visible"
        data-particle-emphasis="qingnest"
        data-particle-text="QingNest"
        layout="preserve-aspect"
        layoutId={layoutId}
        transition={{ duration: 0.68, ease: [0.22, 1, 0.36, 1] }}
      >
        <TextHoverEffect revealRadius={540} text="QingNest" />
      </motion.div>
      <BrandSignal />
    </motion.div>
  );
}

function HeroScreen({
  brandLayoutId,
  onNext,
  onStart
}: {
  brandLayoutId?: string;
  onNext: () => void;
  onStart: () => void;
}) {
  return (
    <AuroraHero className="h-dvh min-h-dvh">
      <section
        className={cn(
          CONTENT_TRACK_CLASS,
          "relative flex h-dvh max-h-dvh flex-col items-center justify-center gap-5 overflow-hidden pb-20 pt-16 text-center sm:gap-6 md:pb-24 md:pt-16"
        )}
        id="home"
      >
        <QingNestMark layoutId={brandLayoutId} />

        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto flex w-full min-w-0 max-w-4xl flex-col items-center gap-4"
          initial={{ opacity: 0, y: 20 }}
          transition={{ delay: 0.16, duration: 0.5, ease: "easeOut" }}
        >
          <p className="mx-auto max-w-full text-[clamp(1.35rem,6.4vw,3.35rem)] font-semibold leading-tight tracking-normal text-white">
            <EncryptedText
              className="[overflow-wrap:anywhere]"
              encryptedClassName="text-zinc-500"
              revealedClassName="text-white"
              revealDelayMs={90}
              text="轻巢，让静态网页一键上线分享"
            />
          </p>
          <p className="text-[clamp(0.82rem,2.2vw,1rem)] font-medium leading-6 text-cyan-100/75">
            注册后先验证邮箱，再创建站点和发布内容
          </p>
        </motion.div>

        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center gap-3 sm:flex-row"
          initial={{ opacity: 0, y: 18 }}
          transition={{ delay: 0.24, duration: 0.45, ease: "easeOut" }}
        >
          <HoverBorderGradient
            alwaysOn
            aria-label="登录并开始使用 QingNest"
            as="button"
            className="h-12 min-w-40 bg-white px-5 text-black hover:bg-zinc-100"
            containerClassName="rounded-full"
            onClick={onStart}
            type="button"
          >
            <LogIn aria-hidden="true" className="h-4 w-4" strokeWidth={1.9} />
            <span>开始免费搭建</span>
          </HoverBorderGradient>
        </motion.div>

        <motion.button
          animate={{ opacity: 1, y: 0 }}
          className="absolute bottom-5 inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-zinc-400 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-black sm:bottom-7 md:bottom-8"
          initial={{ opacity: 0, y: 12 }}
          onClick={onNext}
          transition={{ delay: 0.32, duration: 0.42, ease: "easeOut" }}
          type="button"
        >
          <span>查看发布方法</span>
          <ArrowDown aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
        </motion.button>
      </section>
    </AuroraHero>
  );
}

function StepsScreen() {
  const [activeStep, setActiveStep] = useState(0);
  const dockItems: FloatingDockItem[] = steps.map((step, index) => {
    const Icon = step.icon;

    return {
      active: activeStep === index,
      icon: <Icon className="h-full w-full text-neutral-200" strokeWidth={1.9} />,
      onClick: () => setActiveStep(index),
      title: step.dockTitle
    };
  });

  return (
    <AuroraHero className="h-dvh min-h-dvh">
      <section
        className={cn(
          CONTENT_TRACK_CLASS,
          "flex h-dvh max-h-dvh flex-col justify-center gap-4 overflow-hidden pb-7 pt-24 sm:gap-6 md:gap-7 md:pt-24"
        )}
        id="steps"
      >
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="max-w-3xl"
          initial={{ opacity: 0, y: 22 }}
          transition={{ duration: 0.48, ease: "easeOut" }}
        >
          <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-cyan-100 shadow-[0_0_36px_rgba(34,211,238,0.16)] backdrop-blur">
            <ShieldCheck aria-hidden="true" className="h-4 w-4 text-cyan-200" strokeWidth={1.8} />
            三步完成发布
          </p>
          <h2 className="mt-4 text-[clamp(2rem,5vw,4.75rem)] font-bold leading-none tracking-normal text-white">
            上传、检查、发布
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400 sm:text-base sm:leading-7">
            邮箱验证只在创建站点前强制执行，注册表单提交成功后会立即显示完成状态。
          </p>
        </motion.div>

        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-4"
          initial={{ opacity: 0, y: 26 }}
          transition={{ delay: 0.12, duration: 0.5, ease: "easeOut" }}
        >
          {steps.map((step, index) => {
            const Icon = step.icon;
            const isActive = activeStep === index;

            return (
              <motion.article
                className={cn(
                  "glass-surface grid min-h-[6.4rem] grid-cols-[2.5rem_1fr] items-start gap-x-4 gap-y-1 rounded-lg p-4 outline-none transition-colors duration-300 md:flex md:min-h-56 md:flex-col md:justify-between md:gap-4 md:p-6",
                  isActive ? "is-active border-white/20" : null
                )}
                key={step.title}
                onFocus={() => setActiveStep(index)}
                onMouseEnter={() => setActiveStep(index)}
                tabIndex={0}
                whileHover={{ y: -6 }}
              >
                <div className="flex w-full items-center justify-between gap-3 md:items-start">
                  <span
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border md:h-12 md:w-12",
                      step.accentClass
                    )}
                  >
                    <Icon aria-hidden="true" className="h-5 w-5 md:h-6 md:w-6" strokeWidth={1.9} />
                  </span>
                  <span className="hidden text-sm font-semibold text-zinc-500 md:inline">0{index + 1}</span>
                </div>
                <div className="min-w-0 flex-1 md:flex-none">
                  <div className="mb-1 flex items-center gap-2 md:hidden">
                    <span className="text-xs font-semibold text-zinc-500">0{index + 1}</span>
                    {isActive ? (
                      <Check
                        aria-hidden="true"
                        className="h-4 w-4 rounded-full bg-cyan-300 p-0.5 text-black"
                        strokeWidth={2.3}
                      />
                    ) : null}
                  </div>
                  <h3 className="text-lg font-semibold tracking-normal text-white md:text-2xl">{step.title}</h3>
                  <p className="mt-1 text-sm leading-5 text-zinc-400 md:mt-4 md:text-base md:leading-7">
                    {step.description}
                  </p>
                </div>
              </motion.article>
            );
          })}
        </motion.div>

        <FloatingDock className="shrink-0" items={dockItems} />
      </section>
    </AuroraHero>
  );
}

function AuthScreen({
  initialMode,
  onNavigate,
  status
}: {
  initialMode: AuthMode;
  onNavigate: (path: string) => void;
  status: AuthStatus;
}) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [signUpComplete, setSignUpComplete] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    if (status === "verified") {
      setMode("sign_in");
      setNotice("邮箱已验证。你现在可以输入注册时设置的密码登录。");
      setError(null);
      setSignUpComplete(false);
      return;
    }

    if (status === "pending_confirmation") {
      setMode("sign_in");
      setNotice("请先打开注册邮件完成邮箱验证，验证成功后再用密码登录。");
      setError(null);
      setSignUpComplete(false);
    }
  }, [status]);

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

    if (mode === "sign_up") {
      const record = getSignupConfirmationRecord(normalizedEmail);

      if (record) {
        setNotice(getSignupConfirmationNotice(record));
        setSignUpComplete(true);
        return;
      }
    }

    if (password.length < 6) {
      setError("密码至少需要 6 位。");
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

        const record = rememberSignupConfirmationEmail(normalizedEmail, signUpResult);

        setNotice(getSignupConfirmationNotice(record));
        setSignUpComplete(true);
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
        onNavigate("/app");
      }
    } catch (authError) {
      const message = authError instanceof Error ? authError.message : "认证失败";
      setError(getAuthErrorMessage(message));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuroraHero className="min-h-dvh">
      <section className={cn(CONTENT_TRACK_CLASS, "grid min-h-dvh items-center gap-6 pb-10 pt-24 lg:grid-cols-[1fr_28rem]")}>
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="max-w-3xl"
          initial={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.46, ease: "easeOut" }}
        >
          <p className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-4 py-2 text-sm font-medium text-emerald-100">
            <MailCheck aria-hidden="true" className="h-4 w-4" strokeWidth={1.9} />
            邮箱验证有效期 24 小时
          </p>
          <h1 className="mt-5 text-[clamp(2.6rem,8vw,5.8rem)] font-bold leading-none tracking-normal text-white">
            QingNest
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-300 sm:text-lg">
            注册后会立刻发送验证邮件。邮箱验证成功前不能登录进入工作台；验证后可以从邮件直接进入，也可以回到这里用密码登录。
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
                  "h-10 rounded-md text-sm font-semibold transition-colors",
                  mode === item ? "bg-white text-black" : "text-zinc-300 hover:bg-white/10 hover:text-white"
                )}
                key={item}
                onClick={() => {
                  setMode(item);
                  setError(null);
                  setNotice(null);
                  setSignUpComplete(false);
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
          <input
            autoComplete={mode === "sign_in" ? "current-password" : "new-password"}
            className="mt-2 h-11 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-sm text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-cyan-300"
            id="auth-password"
            onChange={(event) => {
              setPassword(event.target.value);
              setSignUpComplete(false);
            }}
            placeholder="至少 6 位"
            required
            type="password"
            value={password}
          />

          {notice ? (
            <p className="mt-4 rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-3 py-3 text-sm leading-6 text-emerald-100">
              {notice}
            </p>
          ) : null}
          {error ? (
            <p className="mt-4 rounded-lg border border-rose-300/20 bg-rose-400/10 px-3 py-3 text-sm leading-6 text-rose-100">
              {error}
            </p>
          ) : null}

          <HoverBorderGradient
            alwaysOn
            aria-label={mode === "sign_in" ? "登录" : "注册"}
            as="button"
            className="mt-6 h-11 w-full bg-white text-black hover:bg-zinc-100"
            containerClassName="w-full rounded-full"
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

function DashboardScreen({
  account,
  authReady,
  onNavigate,
  session
}: {
  account: AccountProfile | null;
  authReady: boolean;
  onNavigate: (path: string) => void;
  session: Session | null;
}) {
  const [siteName, setSiteName] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [availability, setAvailability] = useState<SubdomainCheck | null>(null);
  const [createdSite, setCreatedSite] = useState<SiteDraft | null>(null);
  const [checking, setChecking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const emailConfirmed = account?.emailConfirmed ?? isSessionEmailConfirmed(session);

  const roleLabel = account?.role === "admin" ? "管理员" : "用户";

  async function handleCheckSubdomain() {
    setMessage(null);
    setError(null);
    setAvailability(null);

    if (!subdomain.trim()) {
      setError("请输入子域名。");
      return;
    }

    setChecking(true);
    try {
      const result = await checkSubdomain(subdomain.trim());
      setAvailability(result);
      setMessage(result.available ? "子域名可用。" : result.reason ?? "子域名不可用。");
    } catch (checkError) {
      const text = checkError instanceof Error ? checkError.message : "检查失败";
      setError(text);
    } finally {
      setChecking(false);
    }
  }

  async function handleCreateSite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    setCreatedSite(null);

    if (!emailConfirmed) {
      setError("请先验证邮箱。注册验证邮件有效期为 24 小时，创建站点时不会重复发送。");
      return;
    }

    setCreating(true);
    try {
      const site = await createSite({
        name: siteName.trim() || "未命名站点",
        subdomain: subdomain.trim()
      });
      setCreatedSite(site);
      setMessage("站点已创建，可以继续上传静态页面包。");
    } catch (createError) {
      const text = createError instanceof Error ? createError.message : "创建失败";
      setError(text);
    } finally {
      setCreating(false);
    }
  }

  if (!authReady) {
    return <LoadingScreen label="正在读取账号" />;
  }

  if (!session) {
    return (
      <AuroraHero className="min-h-dvh">
        <section className={cn(CONTENT_TRACK_CLASS, "flex min-h-dvh items-center pt-20")}>
          <div className="max-w-xl">
            <h1 className="text-4xl font-bold tracking-normal text-white">登录后继续</h1>
            <p className="mt-4 text-base leading-7 text-zinc-300">创建站点需要登录账号，邮箱验证会在创建时强制检查。</p>
            <HoverBorderGradient
              alwaysOn
              as="button"
              className="mt-6 h-11 bg-white text-black hover:bg-zinc-100"
              onClick={() => onNavigate("/auth")}
              type="button"
            >
              <LogIn aria-hidden="true" className="h-4 w-4" />
              登录
            </HoverBorderGradient>
          </div>
        </section>
      </AuroraHero>
    );
  }

  return (
    <AuroraHero className="min-h-dvh">
      <section className={cn(CONTENT_TRACK_CLASS, "min-h-dvh pb-10 pt-24")}>
        <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
          <aside className="glass-surface h-fit rounded-lg p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/10 text-white">
                {account?.role === "admin" ? <Crown className="h-5 w-5" /> : <UserRound className="h-5 w-5" />}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{account?.email ?? session.user.email}</p>
                <p className="mt-1 text-xs font-medium text-zinc-500">{roleLabel} · {account?.plan ?? "free"}</p>
              </div>
            </div>

            <div
              className={cn(
                "mt-5 flex items-start gap-3 rounded-lg border px-3 py-3 text-sm leading-6",
                emailConfirmed
                  ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100"
                  : "border-amber-300/20 bg-amber-400/10 text-amber-100"
              )}
            >
              {emailConfirmed ? <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" /> : <Lock className="mt-0.5 h-4 w-4 shrink-0" />}
              <span>{emailConfirmed ? "邮箱已验证，可以创建站点。" : "邮箱未验证。验证邮件有效期 24 小时，创建站点前必须验证。"}</span>
            </div>

            {account?.role === "admin" ? (
              <button
                className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] text-sm font-semibold text-zinc-200 transition-colors hover:bg-white/10 hover:text-white"
                onClick={() => onNavigate("/admin")}
                type="button"
              >
                <LayoutDashboard className="h-4 w-4" />
                管理员面板
              </button>
            ) : null}
          </aside>

          <div className="glass-surface rounded-lg p-5 sm:p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h1 className="text-2xl font-semibold tracking-normal text-white">创建站点</h1>
                <p className="mt-1 text-sm leading-6 text-zinc-400">选择子域名并创建草稿站点。</p>
              </div>
              <span className="inline-flex h-9 w-fit items-center gap-2 rounded-full border border-white/10 bg-black/30 px-3 text-sm font-medium text-zinc-300">
                <ShieldCheck className="h-4 w-4 text-cyan-200" />
                Supabase Auth
              </span>
            </div>

            <form className="mt-6 grid gap-4" onSubmit={handleCreateSite}>
              <label className="grid gap-2 text-sm font-medium text-zinc-200">
                站点名称
                <input
                  className="h-11 rounded-lg border border-white/10 bg-black/40 px-3 text-sm text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-cyan-300"
                  onChange={(event) => setSiteName(event.target.value)}
                  placeholder="我的页面"
                  value={siteName}
                />
              </label>

              <label className="grid gap-2 text-sm font-medium text-zinc-200">
                子域名
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <input
                    className="h-11 rounded-lg border border-white/10 bg-black/40 px-3 text-sm text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-cyan-300"
                    onChange={(event) => {
                      setSubdomain(event.target.value);
                      setAvailability(null);
                    }}
                    placeholder="my-page"
                    required
                    value={subdomain}
                  />
                  <button
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-zinc-200 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
                    disabled={checking}
                    onClick={handleCheckSubdomain}
                    type="button"
                  >
                    {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
                    检查
                  </button>
                </div>
              </label>

              {availability ? (
                <p
                  className={cn(
                    "rounded-lg border px-3 py-3 text-sm leading-6",
                    availability.available
                      ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100"
                      : "border-rose-300/20 bg-rose-400/10 text-rose-100"
                  )}
                >
                  {availability.available ? `${availability.normalized} 可用。` : availability.reason ?? "子域名不可用。"}
                </p>
              ) : null}

              {message ? (
                <p className="rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-3 py-3 text-sm leading-6 text-emerald-100">
                  {message}
                </p>
              ) : null}
              {error ? (
                <p className="rounded-lg border border-rose-300/20 bg-rose-400/10 px-3 py-3 text-sm leading-6 text-rose-100">
                  {error}
                </p>
              ) : null}

              <HoverBorderGradient
                alwaysOn
                as="button"
                className="h-11 w-full bg-white text-black hover:bg-zinc-100 sm:w-fit"
                containerClassName="w-full rounded-full sm:w-fit"
                disabled={creating || !emailConfirmed}
                type="submit"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                创建站点
              </HoverBorderGradient>
            </form>

            {createdSite ? (
              <div className="mt-6 rounded-lg border border-cyan-300/20 bg-cyan-400/10 p-4">
                <p className="text-sm font-semibold text-cyan-100">{createdSite.name}</p>
                <a className="mt-2 block break-all text-sm text-cyan-200 hover:text-white" href={createdSite.publicUrl}>
                  {createdSite.publicUrl}
                </a>
                <p className="mt-2 text-xs font-medium uppercase tracking-normal text-zinc-500">{createdSite.status}</p>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </AuroraHero>
  );
}

function AdminScreen({
  account,
  authReady,
  onNavigate,
  session
}: {
  account: AccountProfile | null;
  authReady: boolean;
  onNavigate: (path: string) => void;
  session: Session | null;
}) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!session || account?.role !== "admin") return;

    let active = true;
    setLoading(true);
    setError(null);

    getAdminOverview()
      .then((data) => {
        if (active) setOverview(data);
      })
      .catch((adminError) => {
        const text = adminError instanceof Error ? adminError.message : "无法读取管理员数据";
        if (active) setError(text);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [account?.role, session]);

  if (!authReady) {
    return <LoadingScreen label="正在读取账号" />;
  }

  if (!session) {
    return (
      <RouteMessage
        actionLabel="登录"
        icon={LogIn}
        message="管理员面板需要登录。"
        onAction={() => onNavigate("/auth")}
        title="登录后继续"
      />
    );
  }

  if (account && account.role !== "admin") {
    return (
      <RouteMessage
        actionLabel="回到工作台"
        icon={Lock}
        message="当前账号是用户权限。管理员角色需要在 Supabase profiles.role 中由服务端或 SQL 设置。"
        onAction={() => onNavigate("/app")}
        title="需要管理员权限"
      />
    );
  }

  const stats = overview
    ? [
        ["用户", overview.users],
        ["站点", overview.sites],
        ["已发布", overview.activeSites],
        ["待审核", overview.pendingReviewSites],
        ["部署", overview.deployments]
      ]
    : [];

  return (
    <AuroraHero className="min-h-dvh">
      <section className={cn(CONTENT_TRACK_CLASS, "min-h-dvh pb-10 pt-24")}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-400/10 px-4 py-2 text-sm font-medium text-amber-100">
              <Crown className="h-4 w-4" />
              管理员
            </p>
            <h1 className="mt-4 text-3xl font-semibold tracking-normal text-white">平台概览</h1>
          </div>
          <button
            className="inline-flex h-10 w-fit items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-zinc-200 transition-colors hover:bg-white/10 hover:text-white"
            onClick={() => onNavigate("/app")}
            type="button"
          >
            <LayoutDashboard className="h-4 w-4" />
            工作台
          </button>
        </div>

        {loading ? (
          <div className="mt-8 flex items-center gap-3 text-sm text-zinc-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在读取数据
          </div>
        ) : null}

        {error ? (
          <p className="mt-8 rounded-lg border border-rose-300/20 bg-rose-400/10 px-3 py-3 text-sm leading-6 text-rose-100">
            {error}
          </p>
        ) : null}

        {overview ? (
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {stats.map(([label, value]) => (
              <div className="glass-surface rounded-lg p-4" key={label}>
                <p className="text-sm font-medium text-zinc-500">{label}</p>
                <p className="mt-3 text-3xl font-semibold tracking-normal text-white">{value}</p>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </AuroraHero>
  );
}

function RouteMessage({
  actionLabel,
  icon: Icon,
  message,
  onAction,
  title
}: {
  actionLabel: string;
  icon: typeof LogIn;
  message: string;
  onAction: () => void;
  title: string;
}) {
  return (
    <AuroraHero className="min-h-dvh">
      <section className={cn(CONTENT_TRACK_CLASS, "flex min-h-dvh items-center pt-20")}>
        <div className="max-w-xl">
          <span className="flex h-12 w-12 items-center justify-center rounded-lg border border-white/10 bg-white/10 text-white">
            <Icon className="h-5 w-5" />
          </span>
          <h1 className="mt-5 text-4xl font-bold tracking-normal text-white">{title}</h1>
          <p className="mt-4 text-base leading-7 text-zinc-300">{message}</p>
          <HoverBorderGradient
            alwaysOn
            as="button"
            className="mt-6 h-11 bg-white text-black hover:bg-zinc-100"
            onClick={onAction}
            type="button"
          >
            {actionLabel}
          </HoverBorderGradient>
        </div>
      </section>
    </AuroraHero>
  );
}

function LoadingScreen({ label }: { label: string }) {
  return (
    <AuroraHero className="min-h-dvh">
      <section className={cn(CONTENT_TRACK_CLASS, "flex min-h-dvh items-center justify-center pt-20")}>
        <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-zinc-200">
          <Loader2 className="h-4 w-4 animate-spin" />
          {label}
        </div>
      </section>
    </AuroraHero>
  );
}

export function App() {
  const [location, setLocation] = useState(getBrowserLocation);
  const [page, setPage] = useState(getInitialPage);
  const [direction, setDirection] = useState(1);
  const [animateBrand, setAnimateBrand] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [account, setAccount] = useState<AccountProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const wheelLockRef = useRef(false);

  const pathname = location.pathname;
  const isHomeRoute = isHomePathname(pathname);
  const firstScreen = isHomeRoute && page === 0;
  const authMode = useMemo(() => getAuthMode(location.search), [location.search]);
  const authStatus = useMemo(() => getAuthStatus(location.search), [location.search]);

  const navigate = useCallback((path: string, options: { replace?: boolean } = {}) => {
    if (typeof window === "undefined") return;

    if (options.replace) {
      window.history.replaceState({}, "", path);
    } else {
      window.history.pushState({}, "", path);
    }

    setLocation(getBrowserLocation());
  }, []);

  const goToPage = useCallback(
    (nextPage: number) => {
      if (nextPage === page) return;

      setAnimateBrand(isHomeRoute && ((page === 0 && nextPage === 1) || (page === 1 && nextPage === 0)));
      setDirection(nextPage > page ? 1 : -1);
      setPage(nextPage);
    },
    [isHomeRoute, page]
  );

  useEffect(() => {
    const updateLocation = () => setLocation(getBrowserLocation());
    window.addEventListener("popstate", updateLocation);
    return () => window.removeEventListener("popstate", updateLocation);
  }, []);

  useEffect(() => {
    if (!isHomeRoute) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();

      if (wheelLockRef.current || Math.abs(event.deltaY) < 16) return;

      const nextPage = event.deltaY > 0 ? 1 : 0;
      if (nextPage === page) return;

      wheelLockRef.current = true;
      goToPage(nextPage);
      window.setTimeout(() => {
        wheelLockRef.current = false;
      }, 680);
    };

    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleWheel);
  }, [goToPage, isHomeRoute, page]);

  useEffect(() => {
    if (!supabase || !isSupabaseConfigured) {
      setAccessTokenProvider(null);
      setAuthReady(true);
      return;
    }

    const supabaseClient = supabase;

    setAccessTokenProvider(async () => {
      const { data } = await supabaseClient.auth.getSession();
      return data.session?.access_token ?? null;
    });

    let active = true;

    supabaseClient.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setAuthReady(true);
    });

    const {
      data: { subscription }
    } = supabaseClient.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) setAccount(null);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
      setAccessTokenProvider(null);
    };
  }, []);

  useEffect(() => {
    if (!authReady || !session || isSessionEmailConfirmed(session)) return;

    let active = true;

    supabase?.auth.signOut().finally(() => {
      if (!active) return;

      setSession(null);
      setAccount(null);

      if (pathname !== "/auth") {
        navigate("/auth?mode=sign_in&pending_confirmation=1", { replace: true });
      }
    });

    return () => {
      active = false;
    };
  }, [authReady, navigate, pathname, session]);

  useEffect(() => {
    if (!session) {
      setAccount(null);
      return;
    }

    let active = true;

    getCurrentAccount()
      .then((profile) => {
        if (active) setAccount(profile);
      })
      .catch(() => {
        if (!active) return;
        setAccount({
          id: session.user.id,
          email: session.user.email ?? "",
          emailConfirmed: isSessionEmailConfirmed(session),
          role: "user",
          plan: "free",
          createdAt: session.user.created_at ?? new Date().toISOString()
        });
      });

    return () => {
      active = false;
    };
  }, [session]);

  useEffect(() => {
    if (authReady && session && pathname === "/auth" && isSessionEmailConfirmed(session)) {
      navigate("/app", { replace: true });
    }
  }, [authReady, navigate, pathname, session]);

  let routeContent: React.ReactNode;

  if (isHomeRoute) {
    routeContent = (
      <AnimatePresence custom={direction} initial={false} mode="wait">
        <motion.div
          animate="center"
          className="absolute inset-0 h-dvh w-screen overflow-hidden"
          custom={direction}
          exit="exit"
          initial="enter"
          key={page}
          variants={pageVariants}
        >
          {page === 0 ? (
            <HeroScreen
              brandLayoutId={isHomeRoute ? BRAND_LAYOUT_ID : undefined}
              onNext={() => goToPage(1)}
              onStart={() => navigate(session ? "/app" : "/auth?mode=sign_up")}
            />
          ) : (
            <StepsScreen />
          )}
        </motion.div>
      </AnimatePresence>
    );
  } else if (pathname === "/auth") {
    routeContent = <AuthScreen initialMode={authMode} onNavigate={navigate} status={authStatus} />;
  } else if (pathname === "/admin") {
    routeContent = <AdminScreen account={account} authReady={authReady} onNavigate={navigate} session={session} />;
  } else {
    routeContent = <DashboardScreen account={account} authReady={authReady} onNavigate={navigate} session={session} />;
  }

  return (
    <main className={cn("fixed inset-0 h-dvh w-screen bg-black text-white", isHomeRoute ? "overflow-hidden" : "overflow-y-auto")}>
      <LayoutGroup>
        <SiteNavbar
          animateBrand={animateBrand}
          authReady={authReady}
          compact={page === 1 || !isHomeRoute}
          firstScreen={firstScreen}
          isAuthenticated={Boolean(session)}
          onNavigate={navigate}
        />
        {routeContent}
      </LayoutGroup>
    </main>
  );
}
