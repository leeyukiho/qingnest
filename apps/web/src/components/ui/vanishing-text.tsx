import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Particle = {
  color: [number, number, number, number];
  r: number;
  x: number;
  y: number;
};

type CanvasPaint =
  | string
  | ((context: CanvasRenderingContext2D, width: number, height: number) => CanvasGradient | CanvasPattern | string);

type DrawOptions = {
  color?: CanvasPaint;
  fillOpacity?: number;
  fontFamily?: string;
  fontSize?: number | ((width: number, height: number) => number);
  fontWeight?: number | string;
  lineHeight?: number | ((fontSize: number) => number);
  strokeColor?: CanvasPaint;
  strokeOpacity?: number;
  strokeWidth?: number | ((fontSize: number) => number);
  textAlign?: CanvasTextAlign;
  verticalAlign?: "center" | "top";
};

type VanishingTextProps = {
  canvasClassName?: string;
  children?: ReactNode;
  className?: string;
  contentClassName?: string;
  drawOptions?: DrawOptions;
  onComplete?: () => void;
  onNearComplete?: () => void;
  nearCompleteRatio?: number;
  text: string;
  vanishing: boolean;
};

const CANVAS_SCALE = 1;
const VANISH_STEP = 8;
const PARTICLE_FADE_RATE = 0.05;

function parseLineHeight(lineHeight: string, fontSize: number) {
  const parsed = Number.parseFloat(lineHeight);

  return Number.isFinite(parsed) ? parsed : fontSize * 1.2;
}

function resolvePaint(
  paint: CanvasPaint | undefined,
  context: CanvasRenderingContext2D,
  width: number,
  height: number
) {
  return typeof paint === "function" ? paint(context, width, height) : paint;
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  let line = "";

  for (const character of Array.from(text)) {
    if (character === "\n") {
      lines.push(line);
      line = "";
      continue;
    }

    const candidate = `${line}${character}`;

    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = character;
    } else {
      line = candidate;
    }
  }

  lines.push(line);

  return lines;
}

export function VanishingText({
  canvasClassName,
  children,
  className,
  contentClassName,
  drawOptions,
  onComplete,
  onNearComplete,
  nearCompleteRatio = 0.18,
  text,
  vanishing
}: VanishingTextProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const frameRef = useRef<number | null>(null);
  const initialPositionRef = useRef(0);
  const nearCompletedRef = useRef(false);
  const particlesRef = useRef<Particle[]>([]);
  const completedRef = useRef(false);
  const [animating, setAnimating] = useState(false);

  const complete = useCallback(() => {
    setAnimating(false);

    if (!completedRef.current) {
      completedRef.current = true;
      onComplete?.();
    }
  }, [onComplete]);

  const nearComplete = useCallback(() => {
    if (nearCompletedRef.current) return;

    nearCompletedRef.current = true;
    onNearComplete?.();
  }, [onNearComplete]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const content = contentRef.current;

    if (!canvas || !content) return 0;

    const rect = content.getBoundingClientRect();
    const width = Math.max(1, Math.ceil(rect.width * CANVAS_SCALE));
    const height = Math.max(1, Math.ceil(rect.height * CANVAS_SCALE));
    const context = canvas.getContext("2d");

    if (!context) return 0;

    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const styles = window.getComputedStyle(content);
    const resolvedFontSize =
      typeof drawOptions?.fontSize === "function"
        ? drawOptions.fontSize(rect.width, rect.height)
        : (drawOptions?.fontSize ?? Number.parseFloat(styles.fontSize)) || 16;
    const fontSize = resolvedFontSize * CANVAS_SCALE;
    const lineHeight =
      (typeof drawOptions?.lineHeight === "function"
        ? drawOptions.lineHeight(resolvedFontSize)
        : (drawOptions?.lineHeight ?? parseLineHeight(styles.lineHeight, resolvedFontSize))) * CANVAS_SCALE;
    const fontFamily = drawOptions?.fontFamily ?? styles.fontFamily;
    const fontWeight = drawOptions?.fontWeight ?? styles.fontWeight;
    const fontStyle = styles.fontStyle === "normal" ? "" : `${styles.fontStyle} `;
    const textAlign = drawOptions?.textAlign ?? (styles.textAlign as CanvasTextAlign) ?? "left";
    const verticalAlign = drawOptions?.verticalAlign ?? "center";

    context.clearRect(0, 0, width, height);
    context.font = `${fontStyle}${fontWeight} ${fontSize}px ${fontFamily}`;
    context.textAlign = textAlign;
    context.textBaseline = "middle";
    context.lineJoin = "round";

    const lines = wrapText(context, text, width);
    const totalTextHeight = lines.length * lineHeight;
    const startY = verticalAlign === "center" ? Math.max(0, (height - totalTextHeight) / 2) : 0;
    const x = textAlign === "center" ? width / 2 : textAlign === "right" || textAlign === "end" ? width : 0;
    const fillOpacity = drawOptions?.fillOpacity ?? 1;
    const strokeOpacity = drawOptions?.strokeOpacity ?? 0;
    const strokeWidth =
      typeof drawOptions?.strokeWidth === "function"
        ? drawOptions.strokeWidth(resolvedFontSize)
        : (drawOptions?.strokeWidth ?? 0);
    const fillStyle = resolvePaint(drawOptions?.color, context, width, height) ?? styles.color;
    const strokeStyle = resolvePaint(drawOptions?.strokeColor, context, width, height) ?? fillStyle;

    if (fillOpacity > 0) {
      context.globalAlpha = fillOpacity;
      context.fillStyle = fillStyle;

      lines.forEach((line, index) => {
        context.fillText(line, x, startY + index * lineHeight + lineHeight / 2);
      });
    }

    if (strokeWidth > 0 && strokeOpacity > 0) {
      context.globalAlpha = strokeOpacity;
      context.lineWidth = strokeWidth * CANVAS_SCALE;
      context.strokeStyle = strokeStyle;

      lines.forEach((line, index) => {
        context.strokeText(line, x, startY + index * lineHeight + lineHeight / 2);
      });
    }

    context.globalAlpha = 1;

    const imageData = context.getImageData(0, 0, width, height).data;
    const particles: Particle[] = [];
    let maxX = 0;

    for (let y = 0; y < height; y += 1) {
      for (let xIndex = 0; xIndex < width; xIndex += 1) {
        const pixelIndex = 4 * (y * width + xIndex);
        const alpha = imageData[pixelIndex + 3];

        if (alpha > 0) {
          maxX = Math.max(maxX, xIndex);
          particles.push({
            color: [imageData[pixelIndex], imageData[pixelIndex + 1], imageData[pixelIndex + 2], alpha / 255],
            r: 1,
            x: xIndex,
            y
          });
        }
      }
    }

    particlesRef.current = particles;

    return maxX;
  }, [drawOptions, text]);

  const animate = useCallback(
    (position: number) => {
      frameRef.current = window.requestAnimationFrame(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");

        if (!canvas || !context) {
          complete();
          return;
        }

        const nextParticles: Particle[] = [];

        for (const particle of particlesRef.current) {
          if (particle.x < position) {
            nextParticles.push(particle);
          } else {
            if (particle.r <= 0) continue;

            particle.x += Math.random() > 0.5 ? 1 : -1;
            particle.y += Math.random() > 0.5 ? 1 : -1;
            particle.r -= PARTICLE_FADE_RATE * Math.random();
            nextParticles.push(particle);
          }
        }

        particlesRef.current = nextParticles;
        context.clearRect(position, 0, canvas.width, canvas.height);

        if (initialPositionRef.current > 0 && position <= initialPositionRef.current * nearCompleteRatio) {
          nearComplete();
        }

        for (const particle of particlesRef.current) {
          if (particle.x > position) {
            context.beginPath();
            context.rect(particle.x, particle.y, particle.r, particle.r);
            context.fillStyle = `rgba(${particle.color[0]}, ${particle.color[1]}, ${particle.color[2]}, ${particle.color[3]})`;
            context.fill();
          }
        }

        if (particlesRef.current.length > 0) {
          animate(position - VANISH_STEP);
        } else {
          context.clearRect(0, 0, canvas.width, canvas.height);
          nearComplete();
          complete();
        }
      });
    },
    [complete, nearComplete, nearCompleteRatio]
  );

  useEffect(() => {
    if (!vanishing) {
      completedRef.current = false;
      initialPositionRef.current = 0;
      nearCompletedRef.current = false;
      setAnimating(false);
      particlesRef.current = [];

      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }

      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      nearComplete();
      complete();
      return;
    }

    setAnimating(true);
    frameRef.current = window.requestAnimationFrame(() => {
      const startPosition = draw();

      if (startPosition <= 0) {
        nearComplete();
        complete();
        return;
      }

      initialPositionRef.current = startPosition;
      animate(startPosition);
    });

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [animate, complete, draw, nearComplete, vanishing]);

  return (
    <span className={cn("relative inline-block", className)}>
      <span
        className={cn("relative z-10 inline-block", (animating || vanishing) && "opacity-0", contentClassName)}
        ref={contentRef}
      >
        {children ?? text}
      </span>
      <canvas
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute left-0 top-0 z-20 opacity-0",
          animating && "opacity-100",
          canvasClassName
        )}
        ref={canvasRef}
      />
    </span>
  );
}
