import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

interface EncryptedTextProps {
  className?: string;
  encryptedClassName?: string;
  revealedClassName?: string;
  revealDelayMs?: number;
  text: string;
}

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+-<>[]{}";

export function EncryptedText({
  className,
  encryptedClassName,
  revealedClassName,
  revealDelayMs = 45,
  text
}: EncryptedTextProps) {
  const characters = useMemo(() => Array.from(text), [text]);
  const [revealedCount, setRevealedCount] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion) {
      setRevealedCount(characters.length);
      return;
    }

    setRevealedCount(0);
    setTick(0);

    if (characters.length === 0) return;

    let scrambleTimer = 0;
    const revealTimer = window.setInterval(() => {
      setRevealedCount((count) => {
        const nextCount = Math.min(count + 1, characters.length);

        if (nextCount >= characters.length) {
          window.clearInterval(revealTimer);
          window.clearInterval(scrambleTimer);
        }

        return nextCount;
      });
    }, revealDelayMs);

    scrambleTimer = window.setInterval(() => {
      setTick((value) => value + 1);
    }, 48);

    return () => {
      window.clearInterval(revealTimer);
      window.clearInterval(scrambleTimer);
    };
  }, [characters.length, revealDelayMs, text]);

  return (
    <span aria-label={text} className={cn("inline whitespace-pre-wrap break-all [overflow-wrap:anywhere]", className)}>
      {characters.map((character, index) => {
        const isSpace = character === " ";
        const isRevealed = index < revealedCount || isSpace;
        const glyph = GLYPHS[(index * 17 + tick * 7) % GLYPHS.length];

        return (
          <span
            aria-hidden="true"
            className={cn(
              "inline transition-colors duration-200",
              isRevealed ? revealedClassName : encryptedClassName
            )}
            key={`${character}-${index}`}
          >
            {isSpace ? "\u00A0" : isRevealed ? character : glyph}
          </span>
        );
      })}
    </span>
  );
}
