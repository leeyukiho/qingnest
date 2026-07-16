import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { clearAdminReadCaches, getCurrentAccount, setAccessTokenProvider, subscribeToAccountChanges, type AccountProfile } from "@/lib/api";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { SiteNavbar } from "@/app/SiteNavbar";
import { LAST_HOME_PAGE_INDEX } from "@/app/ui";
import { getAuthMode, getAuthStatus, isSessionEmailConfirmed } from "@/app/auth";
import {
  clampHomePage,
  getBrowserLocation,
  getHomePageFromHash,
  getHomePathForPage,
  getInitialPage,
  isHomePathname,
  isStudioPathname,
  PRICING_PATH,
  STUDIO_ADMIN_PATH,
  STUDIO_BILLING_PATH,
  STUDIO_PAYMENT_RESULT_PATH,
  STUDIO_DOMAIN_PURCHASE_PATH,
  STUDIO_DOMAINS_PATH,
  STUDIO_MY_DOMAINS_PATH,
  STUDIO_NOTIFICATIONS_PATH,
  STUDIO_PATH,
  STUDIO_PROJECTS_PATH,
  STUDIO_PROFILE_PATH
} from "@/app/navigation";
import { StudioLoading, StudioSilentGate } from "@/app/feedback";
import { AdminPage } from "@/pages/AdminPage";
import { AuthPage } from "@/pages/AuthPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { HomePage } from "@/pages/HomePage";
import { ProfilePage } from "@/pages/ProfilePage";
import { ProjectDetailPage } from "@/pages/ProjectDetailPage";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { DomainsPage } from "@/pages/DomainsPage";
import { DomainPurchasePage } from "@/pages/DomainPurchasePage";
import { BillingPage } from "@/pages/BillingPage";
import { NotificationsPage } from "@/pages/NotificationsPage";
import { PricingPage } from "@/pages/PricingPage";
import { PaymentResultPage } from "@/pages/PaymentResultPage";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/lib/use-media-query";
import { ToastProvider } from "@/app/toast";

const SIDEBAR_ACCOUNT_CACHE_KEY = "kuaipage:sidebar-account";

function getCachedSidebarAccount() {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(window.sessionStorage.getItem(SIDEBAR_ACCOUNT_CACHE_KEY) ?? "null") as AccountProfile | null;
  } catch {
    return null;
  }
}

export function App() {
  const [location, setLocation] = useState(getBrowserLocation);
  const [page, setPage] = useState(getInitialPage);
  const [direction, setDirection] = useState(1);
  const [animateBrand, setAnimateBrand] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [account, setAccount] = useState<AccountProfile | null>(null);
  const [cachedSidebarAccount, setCachedSidebarAccount] = useState<AccountProfile | null>(getCachedSidebarAccount);
  const [authReady, setAuthReady] = useState(false);
  const wheelLockRef = useRef(false);
  const accountRefreshedAtRef = useRef(0);
  const shouldReduceMotion = useReducedMotion();
  const isMobileViewport = useMediaQuery("(max-width: 767px), (hover: none) and (pointer: coarse)");

  const pathname = location.pathname;
  const isHomeRoute = isHomePathname(pathname);
  const isLegacyProtectedRoute = pathname === "/app" || pathname === "/profile" || pathname === "/studio/admin";
  const isProtectedRoute = isStudioPathname(pathname) || isLegacyProtectedRoute;
  const authMode = useMemo(() => getAuthMode(location.search), [location.search]);
  const authStatus = useMemo(() => getAuthStatus(location.search), [location.search]);
  const studioActive = pathname === STUDIO_ADMIN_PATH ? "admin" : pathname === STUDIO_NOTIFICATIONS_PATH ? "notifications" : pathname === STUDIO_PROFILE_PATH ? "profile" : pathname === STUDIO_BILLING_PATH || pathname === STUDIO_PAYMENT_RESULT_PATH ? "billing" : pathname === STUDIO_MY_DOMAINS_PATH ? "domain-management" : pathname === STUDIO_DOMAINS_PATH || pathname === STUDIO_DOMAIN_PURCHASE_PATH ? "domains" : pathname.startsWith(STUDIO_PROJECTS_PATH) ? "projects" : "create";
  const matchingCachedAccount = session && cachedSidebarAccount?.id === session.user.id ? cachedSidebarAccount : null;
  const silentGateAccount = account ?? matchingCachedAccount ?? (session ? {
    id: session.user.id,
    email: session.user.email ?? "",
    emailConfirmed: isSessionEmailConfirmed(session),
    role: "user" as const,
    plan: "free",
    subscriptionExpiresAt: null,
    createdAt: session.user.created_at ?? new Date().toISOString(),
    usage: { sites: 0, publicSites: 0, storageBytes: 0, deploymentsToday: 0 }
  } : null);

  useEffect(() => {
    if (!account) return;
    setCachedSidebarAccount(account);
    window.sessionStorage.setItem(SIDEBAR_ACCOUNT_CACHE_KEY, JSON.stringify(account));
  }, [account]);

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
      const boundedNextPage = clampHomePage(nextPage);
      const nextPath = getHomePathForPage(boundedNextPage);

      if (boundedNextPage === page) {
        if (isHomeRoute && typeof window !== "undefined") {
          const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
          if (currentPath !== nextPath) {
            window.history.pushState({}, "", nextPath);
            setLocation(getBrowserLocation());
          }
        }

        return;
      }

      setAnimateBrand(isHomeRoute && ((page === 0 && boundedNextPage === 1) || (page === 1 && boundedNextPage === 0)));
      setDirection(boundedNextPage > page ? 1 : -1);
      setPage(boundedNextPage);

      if (isHomeRoute && typeof window !== "undefined") {
        const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        if (currentPath !== nextPath) {
          window.history.pushState({}, "", nextPath);
          setLocation(getBrowserLocation());
        }
      }
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

    const nextPage = getHomePageFromHash(location.hash);
    if (nextPage === page) return;

    setAnimateBrand((page === 0 && nextPage === 1) || (page === 1 && nextPage === 0));
    setDirection(nextPage > page ? 1 : -1);
    setPage(nextPage);
  }, [isHomeRoute, location.hash, page]);

  useEffect(() => {
    if (!isHomeRoute || isMobileViewport) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();

      if (wheelLockRef.current || Math.abs(event.deltaY) < 16) return;

      const nextPage = event.deltaY > 0 ? Math.min(page + 1, LAST_HOME_PAGE_INDEX) : Math.max(page - 1, 0);
      if (nextPage === page) return;

      wheelLockRef.current = true;
      goToPage(nextPage);
      window.setTimeout(() => {
        wheelLockRef.current = false;
      }, 680);
    };

    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleWheel);
  }, [goToPage, isHomeRoute, isMobileViewport, page]);

  useEffect(() => {
    if (!supabase || !isSupabaseConfigured) {
      setAccessTokenProvider(null);
      setAuthReady(true);
      return;
    }

    const supabaseClient = supabase;
    let currentSession: Session | null = null;

    setAccessTokenProvider(async () => {
      return currentSession?.access_token ?? null;
    });

    let active = true;

    supabaseClient.auth.getSession().then(({ data }) => {
      if (!active) return;
      currentSession = data.session;
      setSession(data.session);
      setAuthReady(true);
    });

    const {
      data: { subscription }
    } = supabaseClient.auth.onAuthStateChange((_event, nextSession) => {
      if (currentSession?.user.id !== nextSession?.user.id) clearAdminReadCaches();
      currentSession = nextSession;
      setSession(nextSession);
      if (!nextSession) {
        setAccount(null);
        setCachedSidebarAccount(null);
        window.sessionStorage.removeItem(SIDEBAR_ACCOUNT_CACHE_KEY);
      }
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
        if (active) {
          setAccount(profile);
          accountRefreshedAtRef.current = Date.now();
        }
      })
      .catch(() => {
        if (!active) return;
        setAccount({
          id: session.user.id,
          email: session.user.email ?? "",
          emailConfirmed: isSessionEmailConfirmed(session),
          role: "user",
          plan: "free",
          subscriptionExpiresAt: null,
          createdAt: session.user.created_at ?? new Date().toISOString(),
          usage: { sites: 0, publicSites: 0, storageBytes: 0, deploymentsToday: 0 }
        });
      });

    return () => {
      active = false;
    };
  }, [session]);

  useEffect(() => {
    if (!session) return;

    let active = true;
    let refreshTimer: number | null = null;
    const refreshAccount = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        getCurrentAccount().then((profile) => {
          if (!active) return;
          setAccount(profile);
          accountRefreshedAtRef.current = Date.now();
        }).catch(() => undefined);
      }, 500);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && Date.now() - accountRefreshedAtRef.current > 5 * 60 * 1000) refreshAccount();
    };
    const unsubscribe = subscribeToAccountChanges(refreshAccount);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      active = false;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      unsubscribe();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [session]);

  useEffect(() => {
    if (authReady && session && pathname === "/auth" && isSessionEmailConfirmed(session)) {
      navigate(STUDIO_PATH, { replace: true });
    }
  }, [authReady, navigate, pathname, session]);

  useEffect(() => {
    if (pathname === "/app") {
      navigate(STUDIO_PATH, { replace: true });
    } else if (pathname === "/profile") {
      navigate(STUDIO_PROFILE_PATH, { replace: true });
    } else if (pathname === "/studio/admin") {
      navigate(STUDIO_ADMIN_PATH, { replace: true });
    }
  }, [navigate, pathname]);

  useEffect(() => {
    if (!authReady || session || !isProtectedRoute) return;

    navigate("/auth?mode=sign_in", { replace: true });
  }, [authReady, isProtectedRoute, navigate, session]);

  useEffect(() => {
    if (pathname !== STUDIO_ADMIN_PATH || !account || account.role === "admin") return;

    navigate(STUDIO_PATH, { replace: true });
  }, [account, navigate, pathname]);

  let routeContent: ReactNode;

  if (isHomeRoute) {
    routeContent = (
      <HomePage
        direction={direction}
        isHomeRoute={isHomeRoute}
        onGoToPage={goToPage}
        onNavigate={navigate}
        page={page}
        session={session}
      />
    );
  } else if (pathname === PRICING_PATH) {
    routeContent = <PricingPage onNavigate={navigate} session={session} />;
  } else if (pathname === "/auth") {
    routeContent = <AuthPage initialMode={authMode} onAuthenticated={setSession} onNavigate={navigate} status={authStatus} />;
  } else if (isProtectedRoute && authReady && !session) {
    routeContent = <StudioLoading account={account} active={studioActive} label="正在跳转登录" onNavigate={navigate} />;
  } else if (pathname === STUDIO_PROJECTS_PATH) {
    routeContent = <ProjectsPage account={account} authReady={authReady} onNavigate={navigate} session={session} />;
  } else if (pathname === STUDIO_DOMAINS_PATH || pathname === STUDIO_DOMAIN_PURCHASE_PATH) {
    routeContent = <DomainPurchasePage account={account} onNavigate={navigate} />;
  } else if (pathname === STUDIO_BILLING_PATH) {
    routeContent = <BillingPage account={account} onNavigate={navigate} />;
  } else if (pathname === STUDIO_PAYMENT_RESULT_PATH) {
    routeContent = <PaymentResultPage account={account} onNavigate={navigate} search={location.search} />;
  } else if (pathname === STUDIO_MY_DOMAINS_PATH) {
    routeContent = <DomainsPage account={account} authReady={authReady} onNavigate={navigate} session={session} />;
  } else if (pathname === STUDIO_NOTIFICATIONS_PATH) {
    routeContent = <NotificationsPage account={account} onNavigate={navigate} />;
  } else if (pathname.startsWith(`${STUDIO_PROJECTS_PATH}/`)) {
    const siteId = decodeURIComponent(pathname.slice(STUDIO_PROJECTS_PATH.length + 1));
    routeContent = <ProjectDetailPage account={account} authReady={authReady} onNavigate={navigate} session={session} siteId={siteId} />;
  } else if (pathname === STUDIO_PROFILE_PATH || pathname === "/profile") {
    routeContent = <ProfilePage account={account} authReady={authReady} onNavigate={navigate} session={session} />;
  } else if (pathname === STUDIO_ADMIN_PATH && account?.role === "admin") {
    routeContent = <AdminPage account={account} authReady={authReady} onNavigate={navigate} session={session} />;
  } else if (pathname === STUDIO_ADMIN_PATH) {
    routeContent = <StudioSilentGate account={silentGateAccount} onNavigate={navigate} />;
  } else {
    routeContent = <DashboardPage account={account} authReady={authReady} onNavigate={navigate} session={session} />;
  }

  // This wrapper only mounts when entering Studio. Its child changes in place,
  // so switching between Studio sections is immediate.
  const displayedRouteContent = isStudioPathname(pathname) ? (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="min-h-dvh"
      initial={shouldReduceMotion ? false : { opacity: 0, y: 6 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
    >
      {routeContent}
    </motion.div>
  ) : routeContent;

  return (
    <ToastProvider>
    <main className={cn("fixed inset-0 h-dvh w-screen bg-black text-white", isHomeRoute ? "overflow-hidden" : "overflow-y-auto")}>
      <LayoutGroup>
        <SiteNavbar
          account={account}
          animateBrand={animateBrand}
          authReady={authReady}
          compact={page !== 0 || !isHomeRoute}
          isAuthenticated={Boolean(session && isSessionEmailConfirmed(session))}
          onNavigate={navigate}
        />
        {displayedRouteContent}
      </LayoutGroup>
    </main>
    </ToastProvider>
  );
}
