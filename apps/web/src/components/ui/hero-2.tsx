import type { ReactNode } from "react";
import { ParticleNetwork } from "@/components/ui/particle-network";
import { cn } from "@/lib/utils";

interface AuroraHeroProps {
  children: ReactNode;
  className?: string;
  particles?: boolean;
}

export function AuroraHero({ children, className, particles = false }: AuroraHeroProps) {
  return (
    <div className="h-full w-full">
      <div
        className={cn(
          "relative flex min-h-dvh w-full flex-col items-center justify-center overflow-hidden bg-black antialiased",
          className
        )}
      >
        <div className="absolute inset-0 z-0 bg-black" />
        {particles ? (
          <>
            <div className="absolute inset-0 z-0 bg-[radial-gradient(circle_at_50%_36%,rgba(255,255,255,0.08),transparent_38%)]" />
            <ParticleNetwork className="z-0 opacity-100" />
            <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_center,transparent_18%,rgba(0,0,0,0.38)_100%)]" />
          </>
        ) : null}
        <div className="relative z-10 w-full">{children}</div>
      </div>
    </div>
  );
}
