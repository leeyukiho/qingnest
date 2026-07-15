import { Crown, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import type { AccountProfile } from "@/lib/api";
import { Navbar, NavbarButton, NavbarLogo, NavBody } from "@/components/ui/resizable-navbar";
import { STUDIO_PATH, STUDIO_PROFILE_PATH } from "@/app/navigation";
import { BRAND_LAYOUT_ID } from "@/app/ui";

export function SiteNavbar({
  account,
  animateBrand,
  authReady,
  compact,
  isAuthenticated,
  notificationCenter,
  onNavigate
}: {
  account: AccountProfile | null;
  animateBrand: boolean;
  authReady: boolean;
  compact: boolean;
  isAuthenticated: boolean;
  notificationCenter?: ReactNode;
  onNavigate: (path: string) => void;
}) {
  return (
    <Navbar forceScrolled={compact}>
      <NavBody>
        <NavbarLogo
          animateSubtitle={animateBrand}
          layoutId={animateBrand ? BRAND_LAYOUT_ID : undefined}
          onClick={(event) => {
            event.preventDefault();
            onNavigate("/");
          }}
        />
        <div className="flex items-center gap-4 sm:gap-5">
          <NavbarButton aria-label="\u5B9A\u4EF7" onClick={() => onNavigate("/#pricing")} variant="secondary">
            {"\u5B9A\u4EF7"}
          </NavbarButton>
          {isAuthenticated ? (
            <NavbarButton aria-label="\u521B\u5EFA\u7AD9\u70B9" onClick={() => onNavigate(STUDIO_PATH)} variant="secondary">
              {"\u521B\u5EFA\u7AD9\u70B9"}
            </NavbarButton>
          ) : null}
          {isAuthenticated ? (
            notificationCenter
          ) : null}
          {isAuthenticated ? (
            <button
              aria-label="\u4E2A\u4EBA\u4E2D\u5FC3"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/20 bg-black text-zinc-100 transition-colors hover:border-white/50 hover:bg-white hover:text-black focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
              onClick={() => onNavigate(STUDIO_PROFILE_PATH)}
              title={account?.email ?? "\u4E2A\u4EBA\u4E2D\u5FC3"}
              type="button"
            >
              {account?.role === "admin" ? (
                <Crown aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
              ) : (
                <UserRound aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
              )}
            </button>
          ) : (
            <button
              aria-label="\u767B\u5F55"
              className="inline-flex h-9 items-center justify-center rounded-md border border-white bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-black hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:opacity-50"
              disabled={!authReady}
              onClick={() => onNavigate("/auth")}
              type="button"
            >
              {"\u767B\u5F55"}
            </button>
          )}
        </div>
      </NavBody>
    </Navbar>
  );
}
