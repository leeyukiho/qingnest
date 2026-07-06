"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type RgbColor = [number, number, number];

interface CanvasRevealEffectProps {
  animationSpeed?: number;
  className?: string;
  colors?: RgbColor[];
  containerClassName?: string;
  dotSize?: number;
  opacities?: number[];
  particleCount?: number;
}

interface Particle {
  alpha: number;
  color: RgbColor;
  delay: number;
  phase: number;
  phaseSpeed: number;
  radius: number;
  vx: number;
  vy: number;
  x: number;
  y: number;
}

const DEFAULT_COLORS: RgbColor[] = [
  [59, 130, 246],
  [34, 211, 238]
];

const DEFAULT_OPACITIES = [0.12, 0.16, 0.2, 0.24, 0.32, 0.42, 0.56];
const TARGET_FRAME_INTERVAL = 1000 / 36;
const getCanvasPixelRatio = () => Math.min(window.devicePixelRatio || 1, 1.35);

export function CanvasRevealEffect({
  animationSpeed = 5,
  className,
  colors = DEFAULT_COLORS,
  containerClassName,
  dotSize = 2,
  opacities = DEFAULT_OPACITIES,
  particleCount
}: CanvasRevealEffectProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d")!;
    if (!context) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let animationFrame = 0;
    let height = 0;
    let isDocumentVisible = document.visibilityState !== "hidden";
    let lastFrameAt = 0;
    let particles: Particle[] = [];
    let startedAt = 0;
    let width = 0;

    const pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];

    const createParticle = (): Particle => ({
      alpha: pick(opacities) * (0.45 + Math.random() * 0.55),
      color: pick(colors),
      delay: Math.random() * 0.24,
      phase: Math.random() * Math.PI * 2,
      phaseSpeed: 0.012 + Math.random() * 0.018,
      radius: dotSize * (0.55 + Math.random() * 0.75),
      vx: (Math.random() - 0.5) * 0.09,
      vy: -0.025 - Math.random() * 0.08,
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

      const automaticCount = Math.min(170, Math.max(58, Math.floor((width * height) / 19000)));
      particles = Array.from({ length: particleCount ?? automaticCount }, createParticle);
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

      if (!startedAt) startedAt = timestamp;
      const frameScale = lastFrameAt ? Math.min(2, (timestamp - lastFrameAt) / (1000 / 60)) : 1;
      lastFrameAt = timestamp;

      const elapsedSeconds = (timestamp - startedAt) / 1000;
      const revealDuration = Math.max(0.9, 6 / Math.max(animationSpeed, 0.1));
      const reveal = prefersReducedMotion ? 1 : Math.min(1, elapsedSeconds / revealDuration);
      const centerX = width / 2;
      const centerY = height / 2;
      const maxDistance = Math.hypot(centerX, centerY) || 1;

      context.clearRect(0, 0, width, height);

      for (const particle of particles) {
        if (!prefersReducedMotion) {
          particle.phase += particle.phaseSpeed * frameScale;
        }

        const distance = Math.hypot(particle.x - centerX, particle.y - centerY) / maxDistance;
        const visible = Math.max(0, Math.min(1, (reveal - particle.delay - distance * 0.38) * 3.2));
        const twinkle = 0.56 + Math.sin(particle.phase) * 0.32;
        const alpha = Math.max(0, particle.alpha * visible * twinkle);

        if (alpha > 0.01) {
          context.beginPath();
          context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
          context.fillStyle = `rgba(${particle.color[0]}, ${particle.color[1]}, ${particle.color[2]}, ${alpha})`;
          context.fill();
        }

        if (!prefersReducedMotion) {
          particle.x += particle.vx * frameScale;
          particle.y += particle.vy * frameScale;

          if (particle.y < -8) particle.y = height + 8;
          if (particle.x < -8) particle.x = width + 8;
          if (particle.x > width + 8) particle.x = -8;
        }
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
  }, [animationSpeed, colors, dotSize, opacities, particleCount]);

  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden", containerClassName)}>
      <canvas aria-hidden="true" className={cn("block h-full w-full", className)} ref={canvasRef} />
    </div>
  );
}
