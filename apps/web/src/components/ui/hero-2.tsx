import type { ReactNode } from "react";
import { ParticleNetwork } from "@/components/ui/particle-network";
import { cn } from "@/lib/utils";

interface AuroraHeroProps {
  children: ReactNode;
  className?: string;
}

export function AuroraHero({ children, className }: AuroraHeroProps) {
  return (
    <div className="h-full w-full">
      <div
        className={cn(
          "relative flex min-h-dvh w-full flex-col items-center justify-center overflow-hidden bg-black antialiased",
          className
        )}
      >
        <div className="absolute inset-0 z-0 bg-black" />
        <div className="absolute inset-0 z-0 bg-[radial-gradient(circle_at_50%_36%,rgba(14,165,233,0.12),transparent_38%),linear-gradient(180deg,rgba(0,0,0,0.04),rgba(0,0,0,0.34))]" />
        <ParticleNetwork className="z-0 opacity-100" />
        <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_center,transparent_18%,rgba(0,0,0,0.38)_100%)]" />
        <div className="relative z-10 w-full">{children}</div>
      </div>
    </div>
  );
}
