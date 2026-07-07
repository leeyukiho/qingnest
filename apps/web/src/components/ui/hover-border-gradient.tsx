import React from "react";
import { cn } from "@/lib/utils";

interface HoverBorderGradientProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  alwaysOn?: boolean;
  as?: React.ElementType;
  containerClassName?: string;
  duration?: number;
}

export function HoverBorderGradient({
  alwaysOn = false,
  as: Component = "button",
  children,
  className,
  containerClassName,
  duration = 3.2,
  ...props
}: HoverBorderGradientProps) {
  return (
    <span
      className={cn(
        "group relative inline-flex overflow-hidden rounded-full p-px",
        "bg-white/10 shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_18px_52px_rgba(0,0,0,0.42),0_0_42px_rgba(14,165,233,0.14)]",
        containerClassName
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute -inset-[1000%] transition-opacity duration-500",
          alwaysOn ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
        )}
        style={{
          animation: `hover-border-spin ${duration}s linear infinite`,
          background:
            "conic-gradient(from 90deg at 50% 50%, transparent 0deg, #38bdf8 72deg, #22d3ee 150deg, #2563eb 228deg, #e0f2fe 300deg, transparent 360deg)"
        }}
      />
      <Component
        className={cn(
          "relative z-10 inline-flex h-12 items-center justify-center gap-2 rounded-full border border-white/10 bg-white px-5 text-sm font-semibold text-black",
          "transition-colors duration-200 hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-black",
          "disabled:pointer-events-none disabled:opacity-55",
          className
        )}
        {...props}
      >
        {children}
      </Component>
    </span>
  );
}
