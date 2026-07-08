import { Loader2, LogIn } from "lucide-react";
import { AuroraHero } from "@/components/ui/hero-2";
import { HoverBorderGradient } from "@/components/ui/hover-border-gradient";
import { CONTENT_TRACK_CLASS, PRIMARY_CTA_BUTTON_CLASS } from "@/app/ui";
import { cn } from "@/lib/utils";

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
            className={cn("mt-6 h-11", PRIMARY_CTA_BUTTON_CLASS)}
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

export function LoadingScreen({ label }: { label: string }) {
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
