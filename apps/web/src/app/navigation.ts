import { LAST_HOME_PAGE_INDEX } from "@/app/ui";

export const STUDIO_PATH = "/studio";
export const STUDIO_PROJECTS_PATH = `${STUDIO_PATH}/projects`;
export const STUDIO_DOMAINS_PATH = `${STUDIO_PATH}/domains`;
export const STUDIO_DOMAIN_PURCHASE_PATH = `${STUDIO_DOMAINS_PATH}/purchase`;
export const STUDIO_MY_DOMAINS_PATH = `${STUDIO_DOMAINS_PATH}/manage`;
export const STUDIO_WALLET_PATH = `${STUDIO_PATH}/wallet`;
export const STUDIO_BILLING_PATH = `${STUDIO_PATH}/billing`;
export const STUDIO_ORDERS_PATH = `${STUDIO_PATH}/orders`;
export const getStudioOrderPath = (orderId: string) => `${STUDIO_ORDERS_PATH}/${encodeURIComponent(orderId)}`;
export const STUDIO_PAYMENT_RESULT_PATH = `${STUDIO_BILLING_PATH}/payment-result`;
export const STUDIO_PROFILE_PATH = `${STUDIO_PATH}/profile`;
export const STUDIO_NOTIFICATIONS_PATH = `${STUDIO_PATH}/notifications`;
export const STUDIO_ADMIN_PATH = "/admin";
export const PRICING_PATH = "/pricing";

export type AppLocation = {
  pathname: string;
  search: string;
  hash: string;
};

export function getBrowserLocation(): AppLocation {
  if (typeof window === "undefined") {
    return { pathname: "/", search: "", hash: "" };
  }

  return {
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash
  };
}

export function isHomePathname(pathname: string) {
  return pathname === "/" || pathname === "/index.html";
}

export function isStudioPathname(pathname: string) {
  return pathname === STUDIO_PATH || pathname === STUDIO_PROFILE_PATH || pathname === STUDIO_NOTIFICATIONS_PATH || pathname === STUDIO_ADMIN_PATH || pathname === STUDIO_DOMAINS_PATH || pathname === STUDIO_DOMAIN_PURCHASE_PATH || pathname === STUDIO_MY_DOMAINS_PATH || pathname === STUDIO_WALLET_PATH || pathname === STUDIO_BILLING_PATH || pathname === STUDIO_ORDERS_PATH || pathname.startsWith(`${STUDIO_ORDERS_PATH}/`) || pathname === STUDIO_PAYMENT_RESULT_PATH || pathname === STUDIO_PROJECTS_PATH || pathname.startsWith(`${STUDIO_PROJECTS_PATH}/`);
}

export function clampHomePage(page: number) {
  return Math.max(0, Math.min(LAST_HOME_PAGE_INDEX, page));
}

export function getHomePageFromHash(hash: string) {
  if (hash === "#steps") return 1;
  return 0;
}

export function getHomePathForPage(page: number) {
  if (page === 1) return "/#steps";
  return "/";
}

export function getInitialPage() {
  if (typeof window === "undefined") return 0;

  return isHomePathname(window.location.pathname) ? getHomePageFromHash(window.location.hash) : 0;
}
