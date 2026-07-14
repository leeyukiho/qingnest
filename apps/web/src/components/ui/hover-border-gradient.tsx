import React from "react";
import { cn } from "@/lib/utils";

interface HoverBorderGradientProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  alwaysOn?: boolean;
  as?: React.ElementType;
  containerClassName?: string;
  duration?: number;
}

export function HoverBorderGradient({
  alwaysOn: _alwaysOn = false,
  as: Component = "button",
  children,
  className,
  containerClassName,
  duration: _duration = 3.2,
  ...props
}: HoverBorderGradientProps) {
  return (
    <span
      className={cn(
        "group relative inline-flex rounded-md border border-white bg-white",
        containerClassName
      )}
    >
      <Component
        className={cn(
          "relative z-10 inline-flex h-12 items-center justify-center gap-2 rounded-md bg-white px-5 text-sm font-semibold text-black",
          "transition-colors duration-200 hover:bg-black hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black",
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
