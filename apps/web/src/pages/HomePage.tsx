import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { ArrowDown, Check, Crown, Globe2, LogIn, ScanSearch, ShieldCheck, UploadCloud } from "lucide-react";
import { EncryptedText } from "@/components/ui/encrypted-text";
import { FloatingDock, type FloatingDockItem } from "@/components/ui/floating-dock";
import { AuroraHero } from "@/components/ui/hero-2";
import { HoverBorderGradient } from "@/components/ui/hover-border-gradient";
import { SparklesCore } from "@/components/ui/sparkles";
import { TextHoverEffect } from "@/components/ui/text-hover-effect";
import { VanishingText } from "@/components/ui/vanishing-text";
import { STUDIO_PATH } from "@/app/navigation";
import { BRAND_LAYOUT_ID, CONTENT_TRACK_CLASS, HERO_VANISH_FALLBACK_MS, PRIMARY_CTA_BUTTON_CLASS } from "@/app/ui";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/lib/use-media-query";

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

const qingNestVanishDrawOptions = {
  color: (context: CanvasRenderingContext2D, width: number, height: number) => {
    const gradient = context.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width * 0.46);

    gradient.addColorStop(0, "#f8fdff");
    gradient.addColorStop(0.32, "#67e8f9");
    gradient.addColorStop(0.68, "#2563eb");
    gradient.addColorStop(1, "rgba(14, 165, 233, 0.92)");

    return gradient;
  },
  fillOpacity: 0.08,
  fontFamily: '"Geist Sans", ui-sans-serif, system-ui, sans-serif',
  fontSize: (width: number, height: number) => Math.min((width / 1200) * 178, (height / 300) * 178),
  fontWeight: 800,
  lineHeight: (fontSize: number) => fontSize * 1.12,
  strokeOpacity: 0.7,
  strokeWidth: 0.8,
  textAlign: "center" as const
};

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
    description: "选择永久域名并确认发布，生成可以长期分享的访问链接。",
    dockTitle: "发布",
    icon: Globe2,
    title: "生成访问链接"
  }
];

const pricingPlans = [
  {
    cta: "免费开始",
    description: "适合个人作品、AI 页面和轻量项目。",
    features: ["注册即可发布", "最多 2 个站点", "100 MB 总存储", "每日 5 次部署", "热门站点 72 小时临时保护"],
    highlighted: false,
    name: "免费计划",
    period: "永久免费",
    price: "¥0"
  },
  {
    cta: "升级套餐",
    description: "适合持续发布、更多项目和更高访问量。",
    features: ["最多 20 个站点", "5 GB 总存储", "单站点 500 MB", "每日 100 次部署", "1 个热门站点长期加速"],
    highlighted: true,
    name: "付费套餐",
    period: "/月",
    price: "¥49"
  }
];

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

function QingNestMark({
  layoutId,
  onVanishComplete,
  vanishing = false
}: {
  layoutId?: string;
  onVanishComplete?: () => void;
  vanishing?: boolean;
}) {
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
        {vanishing ? (
          <VanishingText
            canvasClassName="h-full w-full"
            className="block h-full w-full"
            contentClassName="block h-full w-full"
            drawOptions={qingNestVanishDrawOptions}
            onComplete={onVanishComplete}
            onNearComplete={onVanishComplete}
            text="QingNest"
            vanishing
          />
        ) : (
          <TextHoverEffect revealRadius={540} text="QingNest" />
        )}
      </motion.div>
      <BrandSignal />
    </motion.div>
  );
}

function HeroScreen({
  brandLayoutId,
  mobile = false,
  onNext,
  onStart
}: {
  brandLayoutId?: string;
  mobile?: boolean;
  onNext: () => void;
  onStart: () => void;
}) {
  const [isStarting, setIsStarting] = useState(false);
  const startTimeoutRef = useRef<number | null>(null);
  const hasStartedRouteRef = useRef(false);

  useEffect(() => {
    return () => {
      if (startTimeoutRef.current) {
        window.clearTimeout(startTimeoutRef.current);
      }
    };
  }, []);

  const finishStart = useCallback(() => {
    if (hasStartedRouteRef.current) return;

    hasStartedRouteRef.current = true;

    if (startTimeoutRef.current) {
      window.clearTimeout(startTimeoutRef.current);
      startTimeoutRef.current = null;
    }

    onStart();
  }, [onStart]);

  const handleVanishTextComplete = useCallback(() => {
    finishStart();
  }, [finishStart]);

  function handleStart() {
    if (isStarting) return;

    hasStartedRouteRef.current = false;
    setIsStarting(true);
    startTimeoutRef.current = window.setTimeout(finishStart, HERO_VANISH_FALLBACK_MS);
  }

  return (
    <AuroraHero className={mobile ? "min-h-[100svh]" : "h-dvh min-h-dvh"} particles>
      <section
        className={cn(
          CONTENT_TRACK_CLASS,
          mobile
            ? "relative flex min-h-[100svh] flex-col items-center justify-center gap-5 overflow-hidden pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-[calc(4.5rem+env(safe-area-inset-top))] text-center"
            : "relative flex h-dvh max-h-dvh flex-col items-center justify-center gap-5 overflow-hidden pb-20 pt-16 text-center sm:gap-6 md:pb-24 md:pt-16"
        )}
        id="home"
      >
        <QingNestMark layoutId={brandLayoutId} onVanishComplete={handleVanishTextComplete} vanishing={isStarting} />

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
            注册赠送永久域名
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
            className={cn("h-12 min-w-40 px-5", PRIMARY_CTA_BUTTON_CLASS)}
            containerClassName="rounded-full"
            aria-disabled={isStarting}
            onClick={handleStart}
            type="button"
          >
            <LogIn aria-hidden="true" className="h-4 w-4" strokeWidth={1.9} />
            <span>开始免费搭建</span>
          </HoverBorderGradient>
        </motion.div>

        <motion.button
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "absolute inline-flex min-h-11 items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-zinc-400 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:pointer-events-none",
            mobile ? "bottom-[max(1.25rem,env(safe-area-inset-bottom))]" : "bottom-5 sm:bottom-7 md:bottom-8"
          )}
          disabled={isStarting}
          initial={{ opacity: 0, y: 12 }}
          onClick={onNext}
          transition={{ delay: 0.32, duration: 0.42, ease: "easeOut" }}
          type="button"
        >
          <span>发布方法</span>
          <ArrowDown aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
        </motion.button>
      </section>
    </AuroraHero>
  );
}

function StepsScreen({ mobile = false }: { mobile?: boolean }) {
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
    <AuroraHero className={mobile ? "min-h-[100svh]" : "h-dvh min-h-dvh"} particles>
      <section
        className={cn(
          CONTENT_TRACK_CLASS,
          mobile
            ? "flex min-h-[100svh] flex-col justify-start gap-4 overflow-visible pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(5rem+env(safe-area-inset-top))]"
            : "flex h-dvh max-h-dvh flex-col justify-center gap-4 overflow-hidden pb-7 pt-24 sm:gap-6 md:gap-7 md:pt-24"
        )}
        id="steps"
      >
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto max-w-3xl text-center"
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
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-zinc-400 sm:text-base sm:leading-7">
            选择一个永久域名，上传包含入口 HTML 的 ZIP，扫描通过后即可发布。
          </p>
        </motion.div>

        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="grid w-full grid-cols-1 gap-3 md:grid-cols-3 md:gap-4"
          initial={{ opacity: 0, y: 26 }}
          transition={{ delay: 0.12, duration: 0.5, ease: "easeOut" }}
        >
          {steps.map((step, index) => {
            const Icon = step.icon;
            const isActive = activeStep === index;

            return (
              <motion.article
                className={cn(
                  "glass-surface flex min-h-[6.5rem] flex-row items-center justify-start gap-3 rounded-lg p-3 text-left outline-none transition-colors duration-300 md:min-h-56 md:flex-col md:items-center md:justify-between md:gap-4 md:p-6 md:text-center",
                  isActive ? "is-active border-white/20" : null
                )}
                key={step.title}
                onFocus={() => setActiveStep(index)}
                onMouseEnter={() => setActiveStep(index)}
                tabIndex={0}
                whileHover={{ y: -6 }}
              >
                <div className="relative flex w-auto shrink-0 items-center justify-center md:w-full">
                  <span
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border md:h-12 md:w-12",
                      step.accentClass
                    )}
                  >
                    <Icon aria-hidden="true" className="h-5 w-5 md:h-6 md:w-6" strokeWidth={1.9} />
                  </span>
                  <span className="absolute right-0 top-1 hidden text-sm font-semibold text-zinc-500 md:inline">
                    0{index + 1}
                  </span>
                </div>
                <div className="min-w-0 flex-1 md:flex-none">
                  <div className="mb-1 flex items-center justify-start gap-2 md:hidden">
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

function PricingScreen({ mobile = false, onStart }: { mobile?: boolean; onStart: () => void }) {
  return (
    <AuroraHero className={mobile ? "min-h-[100svh]" : "h-dvh min-h-dvh"} particles>
      <section
        className={cn(
          CONTENT_TRACK_CLASS,
          mobile
            ? "flex min-h-[100svh] flex-col justify-start gap-4 overflow-visible pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(5rem+env(safe-area-inset-top))]"
            : "flex h-dvh max-h-dvh flex-col justify-start gap-4 overflow-y-auto pb-6 pt-24 sm:gap-5 md:justify-center md:gap-7 md:pt-24"
        )}
        id="pricing"
      >
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto max-w-3xl text-center"
          initial={{ opacity: 0, y: 22 }}
          transition={{ duration: 0.48, ease: "easeOut" }}
        >
          <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-cyan-100 shadow-[0_0_36px_rgba(34,211,238,0.16)] backdrop-blur">
            <Crown aria-hidden="true" className="h-4 w-4 text-cyan-200" strokeWidth={1.8} />
            定价
          </p>
          <h2 className="mt-4 text-[clamp(2.4rem,6vw,5.25rem)] font-bold leading-none tracking-normal text-white">
            定价
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-zinc-400 sm:text-base sm:leading-7">
            免费计划覆盖基础发布；付费套餐提供更高站点、存储和部署额度。
          </p>
        </motion.div>

        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto grid w-full max-w-5xl gap-3 sm:grid-cols-2 md:gap-4"
          initial={{ opacity: 0, y: 26 }}
          transition={{ delay: 0.12, duration: 0.5, ease: "easeOut" }}
        >
          {pricingPlans.map((plan) => (
            <motion.article
              className={cn(
                "glass-surface flex min-h-[19rem] flex-col items-center rounded-lg p-5 text-center outline-none transition-colors duration-300 md:p-6",
                plan.highlighted ? "is-active border-cyan-200/30 bg-cyan-300/[0.08]" : null
              )}
              key={plan.name}
              whileHover={{ y: -6 }}
            >
              <div className="flex w-full flex-col items-center gap-3">
                <div className="min-w-0">
                  <h3 className="text-xl font-semibold tracking-normal text-white md:text-2xl">{plan.name}</h3>
                  <p className="mt-2 text-sm leading-6 text-zinc-400">{plan.description}</p>
                </div>
                {plan.highlighted ? (
                  <span className="shrink-0 rounded-full border border-cyan-200/25 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100">
                    推荐
                  </span>
                ) : null}
              </div>

              <div className="mt-5 flex items-end justify-center gap-2">
                <span className="text-4xl font-bold leading-none tracking-normal text-white">{plan.price}</span>
                <span className="pb-1 text-sm font-medium text-zinc-500">{plan.period}</span>
              </div>

              <ul className="mt-5 space-y-2 text-sm leading-6 text-zinc-300">
                {plan.features.map((feature) => (
                  <li className="flex items-start justify-center gap-2" key={feature}>
                    <Check aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-cyan-200" strokeWidth={2.1} />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <button
                className={cn(
                  "mt-auto inline-flex h-10 w-full items-center justify-center rounded-lg px-4 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-black",
                  plan.highlighted
                    ? "bg-cyan-200 text-black hover:bg-cyan-100"
                    : "border border-white/10 bg-white/[0.04] text-zinc-100 hover:bg-white/10"
                )}
                onClick={onStart}
                type="button"
              >
                {plan.cta}
              </button>
            </motion.article>
          ))}
        </motion.div>
      </section>
    </AuroraHero>
  );
}

type HomePageProps = {
  direction: number;
  isHomeRoute: boolean;
  onGoToPage: (page: number) => void;
  onNavigate: (path: string) => void;
  page: number;
  session: Session | null;
};

function MobileHomePage({
  onGoToPage,
  onNavigate,
  page,
  session
}: Omit<HomePageProps, "direction" | "isHomeRoute">) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const visiblePageRef = useRef(-1);
  const startPath = session ? STUDIO_PATH : "/auth?mode=sign_up";

  const scrollToPage = useCallback(
    (nextPage: number, behavior: ScrollBehavior = "smooth") => {
      const container = scrollContainerRef.current;
      const section = container?.querySelector<HTMLElement>(`[data-home-page="${nextPage}"]`);

      if (!container || !section) return;

      container.scrollTo({ behavior, top: section.offsetTop });
    },
    []
  );

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    const section = container?.querySelector<HTMLElement>(`[data-home-page="${page}"]`);

    if (!container || !section || visiblePageRef.current === page) return;

    visiblePageRef.current = page;
    container.scrollTo({ behavior: "auto", top: section.offsetTop });
  }, [page]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const sections = Array.from(container.querySelectorAll<HTMLElement>("[data-home-page]"));
    const observer = new IntersectionObserver(
      (entries) => {
        const centeredEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort((first, second) => second.intersectionRatio - first.intersectionRatio)[0];
        const nextPage = Number((centeredEntry?.target as HTMLElement | undefined)?.dataset.homePage);

        if (!Number.isInteger(nextPage) || visiblePageRef.current === nextPage) return;

        visiblePageRef.current = nextPage;
        onGoToPage(nextPage);
      },
      {
        root: container,
        rootMargin: "-42% 0px -42% 0px",
        threshold: 0
      }
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [onGoToPage]);

  return (
    <div
      className="absolute inset-0 h-dvh w-screen touch-pan-y snap-y snap-proximity overflow-x-hidden overflow-y-auto overscroll-y-contain scroll-smooth"
      ref={scrollContainerRef}
    >
      <div className="snap-start" data-home-page="0">
        <HeroScreen mobile onNext={() => scrollToPage(1)} onStart={() => onNavigate(startPath)} />
      </div>
      <div className="snap-start" data-home-page="1">
        <StepsScreen mobile />
      </div>
      <div className="snap-start" data-home-page="2">
        <PricingScreen mobile onStart={() => onNavigate(startPath)} />
      </div>
    </div>
  );
}

export function HomePage({
  direction,
  isHomeRoute,
  onGoToPage,
  onNavigate,
  page,
  session
}: HomePageProps) {
  const isMobileViewport = useMediaQuery("(max-width: 767px), (hover: none) and (pointer: coarse)");

  if (isMobileViewport) {
    return (
      <MobileHomePage
        onGoToPage={onGoToPage}
        onNavigate={onNavigate}
        page={page}
        session={session}
      />
    );
  }

  return (
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
            onNext={() => onGoToPage(1)}
            onStart={() => onNavigate(session ? STUDIO_PATH : "/auth?mode=sign_up")}
          />
        ) : page === 1 ? (
          <StepsScreen />
        ) : (
          <PricingScreen onStart={() => onNavigate(session ? STUDIO_PATH : "/auth?mode=sign_up")} />
        )}
      </motion.div>
    </AnimatePresence>
  );
}
