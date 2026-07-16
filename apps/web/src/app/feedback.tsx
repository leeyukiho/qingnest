import { Loader2, LogIn } from "lucide-react";
import { HoverBorderGradient } from "@/components/ui/hover-border-gradient";
import { CONTENT_TRACK_CLASS, PRIMARY_CTA_BUTTON_CLASS } from "@/app/ui";
import { cn } from "@/lib/utils";
import { StudioSidebar } from "@/app/StudioSidebar";
import { STUDIO_CONTENT_SHELL_CLASS, STUDIO_MAIN_CLASS, STUDIO_SECTION_CLASS } from "@/app/ui";
import type { AccountProfile } from "@/lib/api";

export function RouteMessage({
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
    <div className="min-h-dvh bg-black">
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
            className={cn("mt-6 h-11", PRIMARY_CTA_BUTTON_CLASS)}
            onClick={onAction}
            type="button"
          >
            {actionLabel}
          </HoverBorderGradient>
        </div>
      </section>
    </div>
  );
}

export function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="min-h-dvh bg-black">
      <section className={cn(CONTENT_TRACK_CLASS, "flex min-h-dvh items-center justify-center pt-20")}>
        <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-zinc-200">
          <Loader2 className="h-4 w-4 animate-spin" />
          {label}
        </div>
      </section>
    </div>
  );
}

export function StudioLoading({
  account,
  active,
  label,
  onNavigate
}: {
  account: AccountProfile | null;
  active: "create" | "projects" | "domains" | "billing" | "profile" | "notifications" | "admin";
  label: string;
  onNavigate: (path: string) => void;
}) {
  return (
    <div className="min-h-dvh bg-black">
      <section className={STUDIO_SECTION_CLASS}>
        <div className={STUDIO_CONTENT_SHELL_CLASS}>
          <StudioSidebar account={account} active={active} onNavigate={onNavigate} />
          <div className={`${STUDIO_MAIN_CLASS} flex min-h-[55vh] items-center justify-center`}>
            <div className="inline-flex items-center gap-3 rounded-md border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-medium text-zinc-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              {label}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export function StudioSilentGate({
  account,
  onNavigate
}: {
  account: AccountProfile | null;
  onNavigate: (path: string) => void;
}) {
  return (
    <div className="min-h-dvh bg-black">
      <section className={STUDIO_SECTION_CLASS}>
        <div className={STUDIO_CONTENT_SHELL_CLASS}>
          <StudioSidebar account={account} active="create" onNavigate={onNavigate} />
          <div className={`${STUDIO_MAIN_CLASS} min-h-[55vh]`} aria-hidden="true" />
        </div>
      </section>
    </div>
  );
}
