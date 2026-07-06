import { useId } from "react";
import { cn } from "@/lib/utils";

interface TextHoverEffectProps {
  className?: string;
  revealRadius?: number;
  text: string;
}

export function TextHoverEffect({ className, revealRadius = 420, text }: TextHoverEffectProps) {
  const gradientId = useId();

  return (
    <svg
      aria-label={text}
      className={cn("h-full w-full select-none overflow-visible", className)}
      role="img"
      viewBox="0 0 1200 300"
    >
      <defs>
        <radialGradient
          cx={600}
          cy={150}
          gradientUnits="userSpaceOnUse"
          id={gradientId}
          r={revealRadius}
        >
          <stop offset="0%" stopColor="#f8fdff" />
          <stop offset="32%" stopColor="#67e8f9" />
          <stop offset="68%" stopColor="#2563eb" />
          <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
        </radialGradient>
      </defs>

      <text
        className="qingnest-text-fill"
        dominantBaseline="middle"
        fill={`url(#${gradientId})`}
        fontFamily='"Geist Sans", ui-sans-serif, system-ui, sans-serif'
        fontSize="178"
        fontWeight="800"
        textAnchor="middle"
        x="50%"
        y="50%"
      >
        {text}
      </text>
      <text
        className="qingnest-text-stroke"
        dominantBaseline="middle"
        fill="transparent"
        fontFamily='"Geist Sans", ui-sans-serif, system-ui, sans-serif'
        fontSize="178"
        fontWeight="800"
        stroke={`url(#${gradientId})`}
        strokeWidth="0.8"
        textAnchor="middle"
        x="50%"
        y="50%"
      >
        {text}
      </text>
    </svg>
  );
}
