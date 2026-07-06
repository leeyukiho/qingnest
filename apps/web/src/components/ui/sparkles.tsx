import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface SparklesCoreProps {
  background?: string;
  minSize?: number;
  maxSize?: number;
  particleColor?: string;
  particleDensity?: number;
  className?: string;
}

interface Particle {
  alpha: number;
  radius: number;
  speed: number;
  twinkle: number;
  x: number;
  y: number;
}

const MAX_PARTICLES = 320;
const MIN_PARTICLES = 48;
const TARGET_FRAME_INTERVAL = 1000 / 36;
const getCanvasPixelRatio = () => Math.min(window.devicePixelRatio || 1, 1.35);

export function SparklesCore({
  background = "transparent",
  minSize = 0.4,
  maxSize = 1,
  particleColor = "#ffffff",
  particleDensity = 900,
  className
}: SparklesCoreProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d")!;
    if (!context) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const colorFormatter = createColorFormatter(particleColor);
    let animationFrame = 0;
    let isDocumentVisible = document.visibilityState !== "hidden";
    let lastFrameAt = 0;
    let particles: Particle[] = [];
    let width = 0;
    let height = 0;

    const createParticle = (): Particle => ({
      alpha: 0.35 + Math.random() * 0.65,
      radius: minSize + Math.random() * Math.max(maxSize - minSize, 0.1),
      speed: 0.08 + Math.random() * 0.22,
      twinkle: Math.random() * Math.PI * 2,
      x: Math.random() * width,
      y: Math.random() * height
    });

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = getCanvasPixelRatio();

      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(Math.floor(width * ratio), 1);
      canvas.height = Math.max(Math.floor(height * ratio), 1);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      const particleCount = Math.min(
        MAX_PARTICLES,
        Math.max(MIN_PARTICLES, Math.floor((width * height * particleDensity) / 170000))
      );

      particles = Array.from({ length: particleCount }, createParticle);
      queueFrame();
    };

    function queueFrame() {
      if (animationFrame || !isDocumentVisible) return;

      animationFrame = window.requestAnimationFrame(draw);
    }

    const handleVisibilityChange = () => {
      isDocumentVisible = document.visibilityState !== "hidden";

      if (!isDocumentVisible) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = 0;
        return;
      }

      lastFrameAt = 0;
      queueFrame();
    };

    function draw(timestamp: number) {
      animationFrame = 0;

      if (!isDocumentVisible || width <= 0 || height <= 0) return;

      if (!prefersReducedMotion && lastFrameAt && timestamp - lastFrameAt < TARGET_FRAME_INTERVAL) {
        queueFrame();
        return;
      }

      const frameScale = lastFrameAt ? Math.min(2, (timestamp - lastFrameAt) / (1000 / 60)) : 1;
      lastFrameAt = timestamp;

      context.clearRect(0, 0, width, height);

      if (background !== "transparent") {
        context.fillStyle = background;
        context.fillRect(0, 0, width, height);
      }

      for (const particle of particles) {
        if (!prefersReducedMotion) {
          particle.y -= particle.speed * frameScale;
          particle.twinkle += 0.018 * frameScale;
        }

        if (particle.y < -8) {
          particle.x = Math.random() * width;
          particle.y = height + 8;
        }

        const opacity = particle.alpha * (0.55 + Math.sin(particle.twinkle) * 0.35);
        context.beginPath();
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        context.fillStyle = colorFormatter(Math.max(opacity, 0.08));
        context.fill();
      }

      if (!prefersReducedMotion) {
        queueFrame();
      }
    }

    resize();
    queueFrame();

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [background, maxSize, minSize, particleColor, particleDensity]);

  return <canvas aria-hidden="true" className={cn("block h-full w-full", className)} ref={canvasRef} />;
}

function createColorFormatter(hex: string) {
  if (!hex.startsWith("#")) {
    return () => hex;
  }

  const value = hex.replace("#", "");
  const normalized =
    value.length === 3
      ? value
          .split("")
          .map((char) => char + char)
          .join("")
      : value;

  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);

  return (alpha: number) => `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
