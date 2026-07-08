import { Crown, UserRound } from "lucide-react";
import type { AccountProfile } from "@/lib/api";
import { HoverBorderGradient } from "@/components/ui/hover-border-gradient";
import { Navbar, NavbarButton, NavbarLogo, NavBody } from "@/components/ui/resizable-navbar";
import { STUDIO_PATH, STUDIO_PROFILE_PATH } from "@/app/navigation";
import { BRAND_LAYOUT_ID, PRIMARY_CTA_BUTTON_CLASS } from "@/app/ui";
import { cn } from "@/lib/utils";

export function SiteNavbar({
  account,
  animateBrand,
  authReady,
  compact,
  firstScreen,
  isAuthenticated,
  onNavigate
}: {
  account: AccountProfile | null;
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
          <NavbarButton aria-label="定价" onClick={() => onNavigate("/#pricing")} showUnderline={!firstScreen} variant="secondary">
            定价
          </NavbarButton>
          {isAuthenticated ? (
            <NavbarButton aria-label="创建站点" onClick={() => onNavigate(STUDIO_PATH)} showUnderline={!firstScreen} variant="secondary">
              创建站点
            </NavbarButton>
          ) : null}
          {isAuthenticated ? (
            <button
              aria-label="个人中心"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.08] text-zinc-100 shadow-[0_10px_28px_rgba(0,0,0,0.28)] transition-colors hover:border-cyan-200/45 hover:bg-white/[0.14] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
              onClick={() => onNavigate(STUDIO_PROFILE_PATH)}
              title={account?.email ?? "个人中心"}
              type="button"
            >
              {account?.role === "admin" ? (
                <Crown aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
              ) : (
                <UserRound aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
              )}
            </button>
          ) : (
            <HoverBorderGradient
              alwaysOn
              aria-label="登录"
              as="button"
              className={cn("h-10 px-4", PRIMARY_CTA_BUTTON_CLASS)}
              containerClassName="rounded-full"
              disabled={!authReady}
              onClick={() => onNavigate("/auth")}
              type="button"
            >
              登录
            </HoverBorderGradient>
          )}
        </div>
      </NavBody>
    </Navbar>
  );
}
