/**
 * The Canvas2D request-dot overlay. Rendered as `DesignCanvas`'s `overlay`, so it reads the viewport and edge
 * geometry through `useCanvasHandle()`. It draws in flow coordinates under a transform that combines the viewport
 * (pan/zoom) with devicePixelRatio, so it stays aligned with the graph at any zoom and stays sharp on HiDPI screens.
 *
 * Everything happens in the controller's per-frame callback; React renders this component once.
 */
import type { Design } from '@five-nines/sim';
import { useEffect, useRef } from 'react';
import { pointOnEdge, useCanvasHandle, type CanvasHandle } from '../canvas/index.ts';
import type { FrameInfo, PlaybackController } from './controller.ts';
import { edgeFlows, FULL_MOTION, nodeFailures, particlePace, REDUCED_MOTION } from './flows.ts';
import { ParticleSystem } from './particles.ts';

export interface ParticleLayerProps {
  controller: PlaybackController;
  design: Design;
  reducedMotion: boolean;
}

/** Fixed so every replay of a run shows the same jitter. */
const PARTICLE_SEED = 0x5eed;

const DOT_RADIUS = 2.6;
const MARK_SIZE = 4.5;

export function ParticleLayer({ controller, design, reducedMotion }: ParticleLayerProps) {
  const handle = useCanvasHandle();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const systemRef = useRef<ParticleSystem | null>(null);
  systemRef.current ??= new ParticleSystem(PARTICLE_SEED, FULL_MOTION);

  useEffect(() => {
    systemRef.current!.tuning = reducedMotion ? REDUCED_MOTION : FULL_MOTION;
  }, [reducedMotion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const system = systemRef.current!;
    const colors = readColors(canvas);
    let dirty = true;
    let lastTime = -1;

    const unsubscribeViewport = handle.subscribeViewport(() => {
      dirty = true;
    });
    const resize = new ResizeObserver(() => {
      dirty = true;
    });
    resize.observe(canvas);

    const onFrame = ({ dtSec, rate, clock, frame }: FrameInfo) => {
      // Scrubbing back to the very start begins a fresh, identical-looking replay.
      if (clock.timeSec === 0 && lastTime !== 0) system.reset();
      lastTime = clock.timeSec;

      const pace = particlePace(rate);
      if (frame && pace > 0 && dtSec > 0) {
        system.update(Math.min(dtSec, 0.1) * pace, edgeFlows(design, frame), nodeFailures(frame), handle.getNodeRects());
        dirty = true;
      }
      if (sizeCanvas(canvas)) dirty = true;
      if (!dirty) return;
      dirty = false;
      draw(ctx, canvas, handle, system, colors);
    };

    const unsubscribeFrame = controller.onFrame(onFrame);
    return () => {
      unsubscribeFrame();
      unsubscribeViewport();
      resize.disconnect();
    };
  }, [controller, design, handle]);

  return <canvas ref={canvasRef} className="particle-layer" aria-hidden />;
}

interface Colors {
  dot: string;
  write: string;
  mark: string;
}

/** The particle colours, from the theme's semantic tokens (every theme defines them). */
function readColors(element: Element): Colors {
  const style = getComputedStyle(element);
  return {
    dot: style.getPropertyValue('--request').trim(),
    write: style.getPropertyValue('--write').trim(),
    mark: style.getPropertyValue('--failing').trim(),
  };
}

/** Matches the backing store to the CSS size × devicePixelRatio. Returns whether it changed. */
function sizeCanvas(canvas: HTMLCanvasElement): boolean {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width === width && canvas.height === height) return false;
  canvas.width = width;
  canvas.height = height;
  return true;
}

function draw(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  handle: CanvasHandle,
  system: ParticleSystem,
  colors: Colors,
): void {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Flow coordinates → container CSS pixels → device pixels.
  const { x, y, zoom } = handle.getViewport();
  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * x, dpr * y);

  // Request dots: fade in leaving the source and out arriving at the target. Writes in their own colour.
  for (const geometry of handle.getEdgeGeometry()) {
    const dots = system.dots.get(geometry.key);
    if (!dots) continue;
    const dx = geometry.target.x - geometry.source.x;
    const dy = geometry.target.y - geometry.source.y;
    const length = Math.hypot(dx, dy) || 1;
    // Lanes are offset perpendicular to the straight chord: close enough to the curve's normal for a few pixels.
    const nx = -dy / length;
    const ny = dx / length;
    for (const dot of dots) {
      const p = pointOnEdge(geometry.source, geometry.target, dot.u);
      ctx.fillStyle = dot.write ? colors.write : colors.dot;
      ctx.globalAlpha = 0.9 * Math.min(1, dot.u * 8, (1 - dot.u) * 8);
      ctx.beginPath();
      ctx.arc(p.x + nx * dot.lane, p.y + ny * dot.lane, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Failure marks: a red ✕ that pops up, tumbles and fades as it falls.
  ctx.strokeStyle = colors.mark;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  const life = system.tuning.markLifeSec;
  for (const mark of system.marks) {
    const remaining = 1 - mark.ageSec / life;
    ctx.globalAlpha = Math.max(0, Math.min(1, remaining * 1.6));
    const scale = 0.6 + 0.4 * Math.min(1, mark.ageSec * 10);
    const s = MARK_SIZE * scale;
    const angle = mark.spin * mark.ageSec * 3;
    const cos = Math.cos(angle) * s;
    const sin = Math.sin(angle) * s;
    ctx.beginPath();
    ctx.moveTo(mark.x - cos + sin, mark.y - sin - cos);
    ctx.lineTo(mark.x + cos - sin, mark.y + sin + cos);
    ctx.moveTo(mark.x - cos - sin, mark.y - sin + cos);
    ctx.lineTo(mark.x + cos + sin, mark.y + sin - cos);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
