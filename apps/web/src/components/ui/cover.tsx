import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Cover({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("cover-warp relative inline-flex items-center px-1.5 py-0.5", className)}>
      <span className="relative z-10">{children}</span>
      <span aria-hidden="true" className="cover-warp-line cover-warp-line-a" />
      <span aria-hidden="true" className="cover-warp-line cover-warp-line-b" />
      <span aria-hidden="true" className="cover-warp-flash" />
    </span>
  );
}
