import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
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

const VANISH_STEP = 8;
const PARTICLE_FADE_RATE = 0.05;
const getCanvasScale = () => Math.min(window.devicePixelRatio || 1, 2);

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
  const canvasScaleRef = useRef(1);
  const onCompleteRef = useRef(onComplete);
  const onNearCompleteRef = useRef(onNearComplete);

  useLayoutEffect(() => {
    onCompleteRef.current = onComplete;
    onNearCompleteRef.current = onNearComplete;
  }, [onComplete, onNearComplete]);

  const complete = useCallback(() => {
    if (!completedRef.current) {
      completedRef.current = true;
      onCompleteRef.current?.();
    }
  }, []);

  const nearComplete = useCallback(() => {
    if (nearCompletedRef.current) return;

    nearCompletedRef.current = true;
    onNearCompleteRef.current?.();
  }, []);

  const draw = useCallback((captureParticles = false) => {
    const canvas = canvasRef.current;
    const content = contentRef.current;

    if (!canvas || !content) return 0;

    const rect = content.getBoundingClientRect();
    const canvasScale = getCanvasScale();
    const width = Math.max(1, Math.ceil(rect.width * canvasScale));
    const height = Math.max(1, Math.ceil(rect.height * canvasScale));
    const context = canvas.getContext("2d");

    if (!context) return 0;

    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    canvasScaleRef.current = canvasScale;

    const styles = window.getComputedStyle(content);
    const resolvedFontSize =
      typeof drawOptions?.fontSize === "function"
        ? drawOptions.fontSize(rect.width, rect.height)
        : (drawOptions?.fontSize ?? Number.parseFloat(styles.fontSize)) || 16;
    const fontSize = resolvedFontSize * canvasScale;
    const lineHeight =
      (typeof drawOptions?.lineHeight === "function"
        ? drawOptions.lineHeight(resolvedFontSize)
        : (drawOptions?.lineHeight ?? parseLineHeight(styles.lineHeight, resolvedFontSize))) * canvasScale;
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
      context.lineWidth = strokeWidth * canvasScale;
      context.strokeStyle = strokeStyle;

      lines.forEach((line, index) => {
        context.strokeText(line, x, startY + index * lineHeight + lineHeight / 2);
      });
    }

    context.globalAlpha = 1;

    if (!captureParticles) {
      particlesRef.current = [];
      return 0;
    }

    const imageData = context.getImageData(0, 0, width, height).data;
    const particles: Particle[] = [];
    let maxX = 0;

    const sampleStep = canvasScale >= 1.5 ? 2 : 1;

    for (let y = 0; y < height; y += sampleStep) {
      for (let xIndex = 0; xIndex < width; xIndex += sampleStep) {
        const pixelIndex = 4 * (y * width + xIndex);
        const alpha = imageData[pixelIndex + 3];

        if (alpha > 0) {
          maxX = Math.max(maxX, xIndex);
          particles.push({
            color: [imageData[pixelIndex], imageData[pixelIndex + 1], imageData[pixelIndex + 2], alpha / 255],
            r: sampleStep,
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

            const canvasScale = canvasScaleRef.current;
            particle.x += (Math.random() > 0.5 ? 1 : -1) * canvasScale;
            particle.y += (Math.random() > 0.5 ? 1 : -1) * canvasScale;
            particle.r -= PARTICLE_FADE_RATE * canvasScale * Math.random();
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
          animate(position - VANISH_STEP * canvasScaleRef.current);
        } else {
          context.clearRect(0, 0, canvas.width, canvas.height);
          nearComplete();
          complete();
        }
      });
    },
    [complete, nearComplete, nearCompleteRatio]
  );

  useLayoutEffect(() => {
    if (!vanishing) {
      completedRef.current = false;
      initialPositionRef.current = 0;
      nearCompletedRef.current = false;
      particlesRef.current = [];

      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }

      draw();
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (canvas && context) {
        context.clearRect(0, 0, canvas.width, canvas.height);
      }
      nearComplete();
      complete();
      return;
    }

    const startPosition = draw(true);

    if (startPosition <= 0) {
      nearComplete();
      complete();
      return;
    }

    initialPositionRef.current = startPosition;
    animate(startPosition);

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [animate, complete, draw, nearComplete, vanishing]);

  useEffect(() => {
    if (vanishing) return;

    const content = contentRef.current;
    if (!content) return;

    let active = true;
    let redrawFrame: number | null = null;

    const scheduleRedraw = () => {
      if (redrawFrame !== null) {
        window.cancelAnimationFrame(redrawFrame);
      }

      redrawFrame = window.requestAnimationFrame(() => {
        redrawFrame = null;
        if (active) draw();
      });
    };

    const observer = new ResizeObserver(scheduleRedraw);
    observer.observe(content);

    window.addEventListener("resize", scheduleRedraw);
    document.fonts?.ready.then(scheduleRedraw).catch(() => undefined);

    scheduleRedraw();

    return () => {
      active = false;
      observer.disconnect();
      window.removeEventListener("resize", scheduleRedraw);

      if (redrawFrame !== null) {
        window.cancelAnimationFrame(redrawFrame);
      }
    };
  }, [draw, vanishing]);

  return (
    <span className={cn("relative inline-block", className)}>
      <span
        className={cn("relative z-10 inline-block opacity-0", contentClassName)}
        ref={contentRef}
      >
        {children ?? text}
      </span>
      <canvas
        aria-hidden="true"
        className={cn("pointer-events-none absolute left-0 top-0 z-20", canvasClassName)}
        ref={canvasRef}
      />
    </span>
  );
}
