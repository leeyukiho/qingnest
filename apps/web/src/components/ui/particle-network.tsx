import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type RgbColor = [number, number, number];

interface ParticleNetworkProps {
  className?: string;
  clearZoneSelector?: string;
  emphasisSelector?: string;
}

interface NetworkParticle {
  alpha: number;
  color: RgbColor;
  phase: number;
  phaseSpeed: number;
  radius: number;
  vx: number;
  vy: number;
  x: number;
  y: number;
}

interface Bounds {
  bottom: number;
  centerX: number;
  centerY: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
}

interface TextLayout extends Bounds {
  fontSize: number;
  text: string;
}

type PointerConnectionCandidate = {
  distanceSquared: number;
  index: number;
  particle: NetworkParticle;
  radius: number;
  source: "background" | "glyph";
};

const particleColors: RgbColor[] = [
  [125, 211, 252],
  [103, 232, 249],
  [191, 219, 254],
  [216, 180, 254]
];

const lineColor: RgbColor = [125, 211, 252];
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const TEXT_VIEW_BOX_HEIGHT = 300;
const TEXT_VIEW_BOX_WIDTH = 1200;
const TEXT_VIEW_BOX_FONT_SIZE = 178;
const TEXT_VIEW_BOX_CENTER_X = 600;
const TEXT_VIEW_BOX_CENTER_Y = 150;
const MAX_POINTER_CONNECTIONS = 5;
const MAX_GLYPH_POINTER_CONNECTIONS = 4;
const BACKGROUND_PARTICLE_MAX = 300;
const BACKGROUND_PARTICLE_MIN = 118;
const GLYPH_PARTICLE_MAX = 118;
const GLYPH_PARTICLE_MIN = 60;
const LAYOUT_REFRESH_INTERVAL = 180;
const TARGET_FRAME_INTERVAL = 1000 / 45;
const getPointerConnectionRadius = (canvasWidth: number) => (canvasWidth < 640 ? 96 : 128);
const getPointerFocusRadius = (canvasWidth: number) => (canvasWidth < 640 ? 118 : 152);
const getGlyphPointerConnectionRadius = (canvasWidth: number) => (canvasWidth < 640 ? 52 : 64);
const getTextPriorityPadding = (layout: TextLayout) => Math.max(28, Math.min(72, layout.fontSize * 0.28));
const getTextClearPadding = (layout: TextLayout) => Math.max(14, Math.min(36, layout.fontSize * 0.16));
const getTextClearBottomPadding = (layout: TextLayout) => Math.max(28, Math.min(78, layout.fontSize * 0.44));
const getCanvasPixelRatio = () => Math.min(window.devicePixelRatio || 1, 1.5);

const isInsideBounds = (x: number, y: number, bounds: Bounds, padding = 0) =>
  x >= bounds.left - padding &&
  x <= bounds.right + padding &&
  y >= bounds.top - padding &&
  y <= bounds.bottom + padding;

const distanceToBoundsCenter = (x: number, y: number, bounds: Bounds) =>
  Math.hypot(x - bounds.centerX, y - bounds.centerY);

const getGridKey = (x: number, y: number) => `${x}:${y}`;

const getGlyphMaskSignature = (layout: TextLayout, width: number, height: number, pixelRatio: number) =>
  [
    Math.round(width * pixelRatio),
    Math.round(height * pixelRatio),
    Math.round(layout.left * 10),
    Math.round(layout.top * 10),
    Math.round(layout.width * 10),
    Math.round(layout.height * 10),
    Math.round(layout.fontSize * 10),
    layout.text
  ].join(":");

const isInsideTextClearZone = (x: number, y: number, layout: TextLayout) => {
  const horizontalPadding = getTextClearPadding(layout);
  const topPadding = Math.max(12, layout.fontSize * 0.1);
  const bottomPadding = getTextClearBottomPadding(layout);

  return (
    x >= layout.left - horizontalPadding &&
    x <= layout.right + horizontalPadding &&
    y >= layout.top - topPadding &&
    y <= layout.bottom + bottomPadding
  );
};

const forEachNearbyParticlePair = (
  items: NetworkParticle[],
  connectionDistance: number,
  visitPair: (
    index: number,
    nextIndex: number,
    particle: NetworkParticle,
    nextParticle: NetworkParticle,
    distance: number
  ) => void
) => {
  const cellSize = Math.max(connectionDistance, 1);
  const maxDistanceSquared = connectionDistance * connectionDistance;
  const grid = new Map<string, number[]>();

  for (let index = 0; index < items.length; index += 1) {
    const particle = items[index];
    const cellX = Math.floor(particle.x / cellSize);
    const cellY = Math.floor(particle.y / cellSize);
    const key = getGridKey(cellX, cellY);
    const bucket = grid.get(key);

    if (bucket) {
      bucket.push(index);
    } else {
      grid.set(key, [index]);
    }
  }

  for (let index = 0; index < items.length; index += 1) {
    const particle = items[index];
    const cellX = Math.floor(particle.x / cellSize);
    const cellY = Math.floor(particle.y / cellSize);

    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const bucket = grid.get(getGridKey(cellX + offsetX, cellY + offsetY));
        if (!bucket) continue;

        for (const nextIndex of bucket) {
          if (nextIndex <= index) continue;

          const nextParticle = items[nextIndex];
          const dx = particle.x - nextParticle.x;
          const dy = particle.y - nextParticle.y;
          const distanceSquared = dx * dx + dy * dy;

          if (distanceSquared > maxDistanceSquared) continue;

          visitPair(index, nextIndex, particle, nextParticle, Math.sqrt(distanceSquared));
        }
      }
    }
  }
};

const pushClosestCandidate = (
  candidates: PointerConnectionCandidate[],
  candidate: PointerConnectionCandidate,
  maxCandidates: number
) => {
  let insertAt = candidates.length;

  while (insertAt > 0 && candidates[insertAt - 1].distanceSquared > candidate.distanceSquared) {
    insertAt -= 1;
  }

  candidates.splice(insertAt, 0, candidate);

  if (candidates.length > maxCandidates) {
    candidates.length = maxCandidates;
  }
};

export function ParticleNetwork({
  clearZoneSelector = '[data-particle-clear-zone="qingnest"]',
  className,
  emphasisSelector = '[data-particle-emphasis="qingnest"]'
}: ParticleNetworkProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d")!;
    if (!context) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pointer = {
      active: false,
      inEmphasisTarget: false,
      nearEmphasisTarget: false,
      x: 0,
      y: 0
    };

    let animationFrame = 0;
    let backgroundClearZones: Bounds[] = [];
    let brandEmphasis = 0;
    let glyphParticles: NetworkParticle[] = [];
    let glyphMaskData: Uint8ClampedArray | null = null;
    let glyphMaskSignature = "";
    let glyphParticleSignature = "";
    let height = 0;
    let hoverPresence = 0;
    let isDocumentVisible = document.visibilityState !== "hidden";
    let lastFrameAt = 0;
    let lastLayoutRefreshAt = 0;
    let layoutBounds: Bounds | null = null;
    let layoutText: TextLayout | null = null;
    let particles: NetworkParticle[] = [];
    let pixelRatio = 1;
    let width = 0;

    const glyphCanvas = document.createElement("canvas");
    const glyphContext = glyphCanvas.getContext("2d");
    const glyphMaskCanvas = document.createElement("canvas");
    const glyphMaskContext = glyphMaskCanvas.getContext("2d", { willReadFrequently: true });

    const pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];

    const createParticle = (bounds?: Bounds): NetworkParticle => ({
      alpha: 0.17 + Math.random() * 0.28,
      color: pick(particleColors),
      phase: Math.random() * Math.PI * 2,
      phaseSpeed: 0.007 + Math.random() * 0.013,
      radius: 0.7 + Math.random() * 0.92,
      vx: (Math.random() - 0.5) * 0.13,
      vy: (Math.random() - 0.5) * 0.13,
      x: bounds ? bounds.left + Math.random() * bounds.width : Math.random() * width,
      y: bounds ? bounds.top + Math.random() * bounds.height : Math.random() * height
    });

    const measureEmphasisBounds = (target: HTMLElement): Bounds => {
      const canvasRect = canvas.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const left = targetRect.left - canvasRect.left;
      const top = targetRect.top - canvasRect.top;
      const targetWidth = targetRect.width;
      const targetHeight = targetRect.height;

      return {
        bottom: top + targetHeight,
        centerX: left + targetWidth / 2,
        centerY: top + targetHeight / 2,
        height: targetHeight,
        left,
        right: left + targetWidth,
        top,
        width: targetWidth
      };
    };

    const measureEmphasisTextLayout = (target: HTMLElement, bounds: Bounds): TextLayout => {
      const text = target.dataset.particleText ?? "QingNest";
      const scale = Math.min(bounds.width / TEXT_VIEW_BOX_WIDTH, bounds.height / TEXT_VIEW_BOX_HEIGHT);
      const renderWidth = TEXT_VIEW_BOX_WIDTH * scale;
      const renderHeight = TEXT_VIEW_BOX_HEIGHT * scale;
      const renderLeft = bounds.left + (bounds.width - renderWidth) / 2;
      const renderTop = bounds.top + (bounds.height - renderHeight) / 2;
      const fontSize = TEXT_VIEW_BOX_FONT_SIZE * scale;
      const centerX = renderLeft + TEXT_VIEW_BOX_CENTER_X * scale;
      const centerY = renderTop + TEXT_VIEW_BOX_CENTER_Y * scale;

      context.save();
      context.font = `800 ${fontSize}px "Geist Sans", ui-sans-serif, system-ui, sans-serif`;
      const metrics = context.measureText(text);
      context.restore();

      const textWidth = metrics.width || renderWidth * 0.74;
      const textHeight = Math.max(
        metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
        fontSize * 0.88
      );
      const layoutPaddingX = Math.max(8, fontSize * 0.05);
      const layoutPaddingY = Math.max(8, fontSize * 0.08);
      const left = centerX - textWidth / 2 - layoutPaddingX;
      const right = centerX + textWidth / 2 + layoutPaddingX;
      const top = centerY - textHeight / 2 - layoutPaddingY;
      const bottom = centerY + textHeight / 2 + layoutPaddingY;

      return {
        bottom,
        centerX,
        centerY,
        fontSize,
        height: bottom - top,
        left,
        right,
        text,
        top,
        width: right - left
      };
    };

    const refreshLayout = (timestamp: number, force = false) => {
      if (!force && timestamp - lastLayoutRefreshAt < LAYOUT_REFRESH_INTERVAL) return;

      lastLayoutRefreshAt = timestamp;
      backgroundClearZones = clearZoneSelector
        ? Array.from(document.querySelectorAll<HTMLElement>(clearZoneSelector), measureEmphasisBounds)
        : [];

      const target = document.querySelector<HTMLElement>(emphasisSelector);
      if (!target) {
        layoutBounds = null;
        layoutText = null;
        return;
      }

      layoutBounds = measureEmphasisBounds(target);
      layoutText = measureEmphasisTextLayout(target, layoutBounds);
    };

    const syncGlyphCanvasSize = () => {
      const canvasWidth = Math.max(Math.floor(width * pixelRatio), 1);
      const canvasHeight = Math.max(Math.floor(height * pixelRatio), 1);

      if (glyphContext) {
        if (glyphCanvas.width !== canvasWidth || glyphCanvas.height !== canvasHeight) {
          glyphCanvas.width = canvasWidth;
          glyphCanvas.height = canvasHeight;
        }

        glyphContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      }

      if (glyphMaskContext) {
        if (glyphMaskCanvas.width !== canvasWidth || glyphMaskCanvas.height !== canvasHeight) {
          glyphMaskCanvas.width = canvasWidth;
          glyphMaskCanvas.height = canvasHeight;
          glyphMaskSignature = "";
          glyphParticleSignature = "";
          glyphMaskData = null;
        }

        glyphMaskContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      }
    };

    const applyTextFont = (targetContext: CanvasRenderingContext2D, layout: TextLayout) => {
      targetContext.font = `800 ${layout.fontSize}px "Geist Sans", ui-sans-serif, system-ui, sans-serif`;
      targetContext.textAlign = "center";
      targetContext.textBaseline = "middle";
    };

    const syncGlyphMask = (layout: TextLayout) => {
      if (!glyphMaskContext) return;

      syncGlyphCanvasSize();

      const signature = getGlyphMaskSignature(layout, width, height, pixelRatio);
      if (glyphMaskSignature === signature && glyphMaskData) return;

      glyphMaskContext.clearRect(0, 0, width, height);
      glyphMaskContext.save();
      applyTextFont(glyphMaskContext, layout);
      glyphMaskContext.fillStyle = "rgba(255, 255, 255, 1)";
      glyphMaskContext.fillText(layout.text, layout.centerX, layout.centerY);
      glyphMaskContext.restore();

      glyphMaskData = glyphMaskContext.getImageData(0, 0, glyphMaskCanvas.width, glyphMaskCanvas.height).data;
      glyphMaskSignature = signature;
    };

    const isPointOnGlyph = (x: number, y: number) => {
      if (!glyphMaskData || glyphMaskCanvas.width <= 0 || glyphMaskCanvas.height <= 0) return true;

      const pixelX = Math.floor(x * pixelRatio);
      const pixelY = Math.floor(y * pixelRatio);

      if (pixelX < 0 || pixelY < 0 || pixelX >= glyphMaskCanvas.width || pixelY >= glyphMaskCanvas.height) {
        return false;
      }

      return glyphMaskData[(pixelY * glyphMaskCanvas.width + pixelX) * 4 + 3] > 32;
    };

    const createGlyphParticle = (layout: TextLayout): NetworkParticle => {
      const particle: NetworkParticle = {
        ...createParticle(layout),
        alpha: 0.18 + Math.random() * 0.24,
        phaseSpeed: 0.006 + Math.random() * 0.01,
        radius: 0.42 + Math.random() * 0.56,
        vx: (Math.random() - 0.5) * 0.08,
        vy: (Math.random() - 0.5) * 0.08
      };

      for (let attempt = 0; attempt < 140; attempt += 1) {
        const x = layout.left + Math.random() * layout.width;
        const y = layout.top + Math.random() * layout.height;

        if (isPointOnGlyph(x, y)) {
          particle.x = x;
          particle.y = y;
          return particle;
        }
      }

      return particle;
    };

    const resetGlyphParticle = (particle: NetworkParticle, layout: TextLayout) => {
      Object.assign(particle, createGlyphParticle(layout));
    };

    const syncGlyphParticles = (layout: TextLayout) => {
      syncGlyphMask(layout);

      const targetCount = Math.min(
        GLYPH_PARTICLE_MAX,
        Math.max(GLYPH_PARTICLE_MIN, Math.floor((layout.width * layout.height) / 1320))
      );

      if (glyphParticles.length === targetCount && glyphParticleSignature === glyphMaskSignature) return;

      glyphParticles = Array.from({ length: targetCount }, () => createGlyphParticle(layout));
      glyphParticleSignature = glyphMaskSignature;
    };

    const isInBackgroundClearZone = (x: number, y: number) => {
      if (layoutText && isInsideTextClearZone(x, y, layoutText)) return true;

      return backgroundClearZones.some((zone) => isInsideBounds(x, y, zone));
    };

    const drawGlyphNetwork = (layout: TextLayout, linkedGlyphParticleIndexes: Uint8Array, frameScale: number) => {
      if (!glyphContext || (brandEmphasis < 0.015 && !linkedGlyphParticleIndexes.some(Boolean))) return;

      syncGlyphCanvasSize();
      syncGlyphParticles(layout);

      glyphContext.clearRect(0, 0, width, height);

      if (!prefersReducedMotion) {
        const speedMultiplier = 0.7 + brandEmphasis * 0.32;

        for (const particle of glyphParticles) {
          particle.phase += particle.phaseSpeed * frameScale * (0.82 + brandEmphasis * 0.24);
          particle.x += particle.vx * speedMultiplier * frameScale;
          particle.y += particle.vy * speedMultiplier * frameScale;

          if (!isInsideBounds(particle.x, particle.y, layout) || !isPointOnGlyph(particle.x, particle.y)) {
            resetGlyphParticle(particle, layout);
          }
        }
      }

      const glyphConnectionDistance = Math.min(46, Math.max(30, layout.width / 17)) + brandEmphasis * 5;
      const glyphLineAlpha = 0.032 + brandEmphasis * 0.11;
      const glyphDotAlpha = 0.18 + brandEmphasis * 0.16;

      forEachNearbyParticlePair(glyphParticles, glyphConnectionDistance, (index, nextIndex, particle, nextParticle, distance) => {
          const proximity = 1 - distance / glyphConnectionDistance;
          const midpointX = (particle.x + nextParticle.x) / 2;
          const midpointY = (particle.y + nextParticle.y) / 2;
          const centerFocus = clamp01(1 - distanceToBoundsCenter(midpointX, midpointY, layout) / (layout.width * 0.64));
          const alpha = glyphLineAlpha * Math.pow(proximity, 0.62) * (0.56 + centerFocus * 0.44);

          glyphContext.beginPath();
          glyphContext.moveTo(particle.x, particle.y);
          glyphContext.lineTo(nextParticle.x, nextParticle.y);
          glyphContext.strokeStyle = `rgba(${lineColor[0]}, ${lineColor[1]}, ${lineColor[2]}, ${alpha})`;
          glyphContext.lineWidth = 0.24 + proximity * 0.22 + brandEmphasis * 0.08;
          glyphContext.shadowBlur = brandEmphasis > 0.18 ? 0.4 + brandEmphasis * 1.4 : 0;
          glyphContext.shadowColor = `rgba(${lineColor[0]}, ${lineColor[1]}, ${lineColor[2]}, ${0.04 + brandEmphasis * 0.08})`;
          glyphContext.stroke();
      });

      glyphContext.shadowBlur = 0;

      for (let index = 0; index < glyphParticles.length; index += 1) {
        const particle = glyphParticles[index];
        const twinkle = 0.72 + Math.sin(particle.phase) * 0.2;
        const pointerLinkBoost = linkedGlyphParticleIndexes[index] ? hoverPresence : 0;
        const alpha = Math.min(0.68, particle.alpha * glyphDotAlpha * twinkle + pointerLinkBoost * 0.12);
        const radius = particle.radius + brandEmphasis * 0.32 + pointerLinkBoost * 0.18;

        glyphContext.beginPath();
        glyphContext.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
        glyphContext.fillStyle = `rgba(${particle.color[0]}, ${particle.color[1]}, ${particle.color[2]}, ${alpha})`;
        glyphContext.fill();
      }

      glyphContext.globalCompositeOperation = "destination-in";
      applyTextFont(glyphContext, layout);
      glyphContext.fillStyle = "rgba(255, 255, 255, 1)";
      glyphContext.fillText(layout.text, layout.centerX, layout.centerY);
      glyphContext.globalCompositeOperation = "source-over";

      context.save();
      context.globalAlpha = Math.min(0.56, 0.14 + brandEmphasis * 0.32);
      context.drawImage(glyphCanvas, 0, 0, width, height);
      context.restore();
    };

    const updatePointerTarget = () => {
      const textLayout = layoutText;
      pointer.inEmphasisTarget =
        pointer.active && textLayout ? isInsideBounds(pointer.x, pointer.y, textLayout, 2) : false;
      pointer.nearEmphasisTarget =
        pointer.active && textLayout
          ? isInsideBounds(pointer.x, pointer.y, textLayout, getTextPriorityPadding(textLayout))
          : false;
    };

    const handlePointerMove = (event: PointerEvent) => {
      refreshLayout(performance.now());

      const rect = canvas.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
      pointer.active = isInsideBounds(pointer.x, pointer.y, {
        bottom: height,
        centerX: width / 2,
        centerY: height / 2,
        height,
        left: 0,
        right: width,
        top: 0,
        width
      });
      updatePointerTarget();

      if (prefersReducedMotion) {
        queueFrame();
      }
    };

    const handlePointerLeave = () => {
      pointer.active = false;
      pointer.inEmphasisTarget = false;
      pointer.nearEmphasisTarget = false;

      if (prefersReducedMotion) {
        queueFrame();
      }
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
      refreshLayout(performance.now(), true);
      queueFrame();
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = getCanvasPixelRatio();

      width = rect.width;
      height = rect.height;
      pixelRatio = ratio;
      canvas.width = Math.max(Math.floor(width * ratio), 1);
      canvas.height = Math.max(Math.floor(height * ratio), 1);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      const automaticCount = Math.min(
        BACKGROUND_PARTICLE_MAX,
        Math.max(BACKGROUND_PARTICLE_MIN, Math.floor((width * height) / 6900))
      );
      particles = Array.from({ length: automaticCount }, createParticle);
      glyphParticles = [];
      syncGlyphCanvasSize();
      refreshLayout(performance.now(), true);
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
      refreshLayout(timestamp);

      const textLayout = layoutText;
      pointer.inEmphasisTarget =
        pointer.active && textLayout ? isInsideBounds(pointer.x, pointer.y, textLayout, 2) : false;
      pointer.nearEmphasisTarget =
        pointer.active && textLayout
          ? isInsideBounds(pointer.x, pointer.y, textLayout, getTextPriorityPadding(textLayout))
          : false;

      hoverPresence += ((pointer.active ? 1 : 0) - hoverPresence) * Math.min(1, 0.1 * frameScale);
      brandEmphasis += ((pointer.nearEmphasisTarget ? 1 : 0) - brandEmphasis) * Math.min(1, 0.08 * frameScale);
      const pointerInBackgroundClearZone = pointer.active && isInBackgroundClearZone(pointer.x, pointer.y);

      context.clearRect(0, 0, width, height);

      for (const particle of particles) {
        if (!prefersReducedMotion) {
          const speedMultiplier = 1.03;

          particle.phase += particle.phaseSpeed * frameScale * 1.02;
          particle.x += particle.vx * speedMultiplier * frameScale;
          particle.y += particle.vy * speedMultiplier * frameScale;

          if (particle.x < -12) particle.x = width + 12;
          if (particle.x > width + 12) particle.x = -12;
          if (particle.y < -12) particle.y = height + 12;
          if (particle.y > height + 12) particle.y = -12;
        }
      }

      const baseConnectionDistance = width < 640 ? 82 : 108;
      const pointerConnectionRadius = getPointerConnectionRadius(width);
      const pointerFocusRadius = getPointerFocusRadius(width);
      const connectionDistance = baseConnectionDistance;
      const connectedParticleIndexes = new Uint8Array(particles.length);
      const pointerLinkedParticleIndexes = new Uint8Array(particles.length);

      if (textLayout && pointer.nearEmphasisTarget) {
        syncGlyphParticles(textLayout);
      }

      const pointerLinkedGlyphParticleIndexes = new Uint8Array(glyphParticles.length);

      forEachNearbyParticlePair(particles, connectionDistance, (index, nextIndex, particle, nextParticle, distance) => {
          const proximity = 1 - distance / connectionDistance;
          const midpointX = (particle.x + nextParticle.x) / 2;
          const midpointY = (particle.y + nextParticle.y) / 2;
          if (
            isInBackgroundClearZone(midpointX, midpointY) ||
            isInBackgroundClearZone(particle.x, particle.y) ||
            isInBackgroundClearZone(nextParticle.x, nextParticle.y)
          ) {
            return;
          }

          const pointerDistance = Math.hypot(midpointX - pointer.x, midpointY - pointer.y);
          const pointerFocus = pointer.active && !pointerInBackgroundClearZone
            ? clamp01(1 - pointerDistance / pointerFocusRadius) * hoverPresence
            : 0;
          const focusBoost = pointerFocus * 0.2;
          const alpha = 0.02 * Math.pow(proximity, 1.56);

          if (alpha < 0.008) return;

          connectedParticleIndexes[index] = 1;
          connectedParticleIndexes[nextIndex] = 1;

          context.beginPath();
          context.moveTo(particle.x, particle.y);
          context.lineTo(nextParticle.x, nextParticle.y);
          context.strokeStyle = `rgba(${lineColor[0]}, ${lineColor[1]}, ${lineColor[2]}, ${alpha})`;
          context.lineWidth =
            0.36 + proximity * 0.22 + focusBoost * 0.42 + pointerFocus * 0.08;
          context.shadowBlur = focusBoost > 0.03 || pointerFocus > 0.08
            ? 0.4 + focusBoost * 2.8 + pointerFocus * 0.55
            : 0;
          context.shadowColor = `rgba(${lineColor[0]}, ${lineColor[1]}, ${lineColor[2]}, ${
            0.03 + focusBoost * 0.14 + pointerFocus * 0.04
          })`;
          context.stroke();
      });

      if (pointer.active && hoverPresence > 0.02) {
        const glyphConnectionRadius = getGlyphPointerConnectionRadius(width);
        const pointerConnectionCandidates: PointerConnectionCandidate[] = [];

        if (textLayout && pointer.nearEmphasisTarget) {
          const glyphConnectionRadiusSquared = glyphConnectionRadius * glyphConnectionRadius;

          for (let index = 0; index < glyphParticles.length; index += 1) {
            const particle = glyphParticles[index];
            const dx = particle.x - pointer.x;
            const dy = particle.y - pointer.y;
            const distanceSquared = dx * dx + dy * dy;

            if (distanceSquared > glyphConnectionRadiusSquared) continue;
            if (!isPointOnGlyph(particle.x, particle.y)) continue;

            pushClosestCandidate(
              pointerConnectionCandidates,
              {
                distanceSquared,
                index,
                particle,
                radius: glyphConnectionRadius,
                source: "glyph"
              },
              MAX_POINTER_CONNECTIONS * 2
            );
          }
        }

        const pointerConnectionRadiusSquared = pointerConnectionRadius * pointerConnectionRadius;

        if (!pointerInBackgroundClearZone) {
          for (let index = 0; index < particles.length; index += 1) {
            const particle = particles[index];
            const dx = particle.x - pointer.x;
            const dy = particle.y - pointer.y;
            const distanceSquared = dx * dx + dy * dy;

            if (distanceSquared > pointerConnectionRadiusSquared) continue;
            if (isInBackgroundClearZone(particle.x, particle.y)) continue;

            pushClosestCandidate(
              pointerConnectionCandidates,
              {
                distanceSquared,
                index,
                particle,
                radius: pointerConnectionRadius,
                source: "background"
              },
              MAX_POINTER_CONNECTIONS * 2
            );
          }
        }

        pointerConnectionCandidates
          .sort((first, second) => {
            if (pointer.nearEmphasisTarget && first.source !== second.source) {
              return first.source === "glyph" ? -1 : 1;
            }

            return first.distanceSquared - second.distanceSquared;
          })
          .splice(pointer.nearEmphasisTarget ? MAX_GLYPH_POINTER_CONNECTIONS : MAX_POINTER_CONNECTIONS);

        pointerConnectionCandidates.sort((first, second) => {
          if (first.source !== second.source) {
            return first.source === "background" ? -1 : 1;
          }

          return first.distanceSquared - second.distanceSquared;
        });

        for (const { distanceSquared, index, particle, radius: candidateRadius, source } of pointerConnectionCandidates) {
          if (source === "glyph") {
            pointerLinkedGlyphParticleIndexes[index] = 1;
          } else {
            pointerLinkedParticleIndexes[index] = 1;
            connectedParticleIndexes[index] = 1;
          }

          const distance = Math.sqrt(distanceSquared);
          const proximity = 1 - distance / candidateRadius;
          const alpha =
            source === "glyph"
              ? hoverPresence * (0.05 + 0.34 * Math.pow(proximity, 0.72))
              : hoverPresence * (0.1 + 0.52 * Math.pow(proximity, 0.64));

          context.beginPath();
          context.moveTo(pointer.x, pointer.y);
          context.lineTo(particle.x, particle.y);
          context.strokeStyle = `rgba(${lineColor[0]}, ${lineColor[1]}, ${lineColor[2]}, ${alpha})`;
          context.lineWidth = source === "glyph" ? 0.28 + proximity * 0.34 : 0.42 + proximity * 0.62;
          context.shadowBlur = source === "glyph" ? 0.8 + proximity * 2.2 : 1.4 + proximity * 4;
          context.shadowColor = `rgba(${lineColor[0]}, ${lineColor[1]}, ${lineColor[2]}, ${
            source === "glyph" ? 0.08 + proximity * 0.14 : 0.12 + proximity * 0.22
          })`;
          context.stroke();
        }

        context.shadowBlur = 0;
        if (!pointerInBackgroundClearZone) {
          context.beginPath();
          context.arc(pointer.x, pointer.y, 1.25 + hoverPresence * 1.25, 0, Math.PI * 2);
          context.fillStyle = `rgba(${lineColor[0]}, ${lineColor[1]}, ${lineColor[2]}, ${0.32 + hoverPresence * 0.28})`;
          context.fill();
        }
      }

      context.shadowBlur = 0;

      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index];
        if (isInBackgroundClearZone(particle.x, particle.y)) continue;

        const twinkle = 0.72 + Math.sin(particle.phase) * 0.2;
        let focusBoost = 0;

        if (pointer.active && !pointerInBackgroundClearZone) {
          const pointerDistance = Math.hypot(particle.x - pointer.x, particle.y - pointer.y);
          focusBoost = clamp01(1 - pointerDistance / pointerFocusRadius) * hoverPresence * 0.88;
        }

        const baseAlpha = particle.alpha * twinkle * 0.88;
        const connectedBoost = connectedParticleIndexes[index] ? 0.08 : 0;
        const pointerLinkBoost = pointerLinkedParticleIndexes[index] ? 1 : 0;
        const alpha = Math.min(
          0.78,
          baseAlpha + connectedBoost * focusBoost + focusBoost * 0.12 + pointerLinkBoost * hoverPresence * 0.24
        );
        const radius =
          particle.radius + focusBoost * 0.34 + pointerLinkBoost * hoverPresence * 0.32;

        context.beginPath();
        context.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
        context.fillStyle = `rgba(${particle.color[0]}, ${particle.color[1]}, ${particle.color[2]}, ${alpha})`;
        context.fill();
      }

      if (textLayout) {
        drawGlyphNetwork(textLayout, pointerLinkedGlyphParticleIndexes, frameScale);
      }

      if (!prefersReducedMotion) {
        queueFrame();
      }
    }

    resize();
    queueFrame();

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerleave", handlePointerLeave);
    window.addEventListener("blur", handlePointerLeave);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerleave", handlePointerLeave);
      window.removeEventListener("blur", handlePointerLeave);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [clearZoneSelector, emphasisSelector]);

  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <canvas aria-hidden="true" className="block h-full w-full" ref={canvasRef} />
    </div>
  );
}
