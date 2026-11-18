import type { Analysis, MotionPath, Scene, Theme } from "../../../shared/types";
import { clamp } from "../../../shared/math";
import {
  buildPathGeometry,
  pathSignature,
  wrapDistance,
  type PathGeometry,
} from "../lib/path";

const MAX_PARTICLES = 800;
const TWO_PI = Math.PI * 2;

interface Particle {
  /** Normalised position along the path, 0–1. */
  distance: number;
  /** Path lengths travelled per second, before the scene speed multiplier. */
  speed: number;
  /** Sideways placement in the range -1…1, multiplied by the live spread. */
  lateral: number;
  size: number;
  color: number;
  x: number;
  y: number;
  previousX: number;
  previousY: number;
  age: number;
  life: number;
  /** Whether this particle is part of the steady stream or an onset burst. */
  base: boolean;
  stopped: boolean;
  stoppedFor: number;
  alpha: number;
  /** Phase used for a gentle lateral sway; kept per particle for variety. */
  sway: number;
  swaySpeed: number;
  /** Distance at the previous tick, so travel can be measured exactly. */
  previousDistance: number;
}

export interface PathField {
  /** Rebuild the polyline only when the authored geometry actually changes. */
  sync(path?: MotionPath | null): void;
  update(
    dt: number,
    analysis: Analysis,
    scene: Scene,
    aspect: number,
    sensitivity: number,
    options?: { advance?: boolean; emit?: boolean },
  ): void;
  draw(
    c: CanvasRenderingContext2D,
    w: number,
    h: number,
    theme: Theme,
    quality?: number,
  ): void;
  count(options?: { baseOnly?: boolean }): number;
  /**
   * Align the last-seen onset counter without emitting. Called when a scene
   * becomes active so beats that happened while it was off stage are not
   * replayed as a retroactive burst.
   */
  bindBeat(beatCount: number): void;
  readonly geometry: PathGeometry;
  clear(): void;
}

/**
 * A persistent swarm tied to one scene's authored path.
 *
 * Everything is simulated in normalised stage space (0–1 on both axes), so a
 * path has the same shape and the same particle density on a laptop preview
 * and in an exported 1280 × 720 frame. Only painting is scaled.
 */
export function createPathField(): PathField {
  let geometry = buildPathGeometry(null);
  let signature = "";
  let particles: Particle[] = [];
  let lastBeat: number | null = null;
  let topUpCarry = 0;
  let seeded = false;
  let time = 0;

  function sync(path?: MotionPath | null) {
    const next = pathSignature(path);
    if (next === signature) return;
    signature = next;
    geometry = buildPathGeometry(path);
  }

  const loops = (scene: Scene) =>
    Boolean(scene.path?.closed) || scene.path?.endMode !== "stop";
  const sceneSpeed = (scene: Scene) =>
    Math.max(0.05, Number.isFinite(scene.speed) ? scene.speed : 1);
  const densityOf = (scene: Scene) => clamp(scene.density ?? 1, 0.2, 3);
  const baseTarget = (scene: Scene) =>
    Math.round(46 + 64 * densityOf(scene));

  function lifeFor(scene: Scene, speed: number) {
    const traversal = 1 / Math.max(0.02, speed * sceneSpeed(scene));
    return loops(scene)
      ? Math.min(18, traversal * 1.25 + 1.2 + Math.random() * 1.4)
      : // An open, stopping path does not expire particles in flight (see
        // update); the life only bounds how long they linger after stopping.
        Math.max(1.4, Math.min(2.2, traversal * 0.2));
  }

  function makeParticle(
    scene: Scene,
    distance: number,
    base: boolean,
  ): Particle {
    const speed = 0.2 + Math.random() * 0.17;
    // New emissions are born on the route as it is right now; only particles
    // already in flight ease towards a route that the user drags.
    const sample = geometry.at(clamp(distance) * geometry.length);
    return {
      distance: clamp(distance),
      speed,
      lateral: Math.random() * 2 - 1,
      size: 0.55 + Math.random() * 1.55,
      color: Math.floor(Math.random() * 3),
      x: sample.x,
      y: sample.y,
      previousX: sample.x,
      previousY: sample.y,
      age: 0,
      life: lifeFor(scene, speed),
      base,
      stopped: false,
      stoppedFor: 0,
      alpha: 0,
      sway: Math.random() * TWO_PI,
      swaySpeed: 0.5 + Math.random() * 1.8,
      previousDistance: clamp(distance),
    };
  }

  function push(particlesToAdd: Particle[]) {
    for (const p of particlesToAdd) {
      // Keep emitting under pressure: the oldest particle makes room instead
      // of the newest onset being dropped.
      while (particles.length >= MAX_PARTICLES) {
        const index = particles.findIndex((q) => !q.base);
        particles.splice(index >= 0 ? index : 0, 1);
      }
      particles.push(p);
    }
  }

  function burst(count: number, scene: Scene) {
    const additions: Particle[] = [];
    for (let i = 0; i < count; i++)
      additions.push(makeParticle(scene, Math.random() * 0.03, false));
    push(additions);
  }

  function seed(scene: Scene) {
    const count = baseTarget(scene);
    const additions: Particle[] = [];
    for (let i = 0; i < count; i++) {
      // Distribute the opening swarm along the whole route so the path reads
      // immediately instead of filling up from one end.
      const p = makeParticle(scene, (i + Math.random() * 0.5) / count, true);
      p.age = Math.min(p.life - 0.6, 0.6 + Math.random() * 1.2);
      additions.push(p);
    }
    push(additions);
  }

  function liveSpread(
    analysis: Analysis,
    scene: Scene,
    sensitivity: number,
  ) {
    // Overall loudness opens the fan; bass adds a little extra punch.
    const energy = clamp(
      (analysis.rms * 1.9 + analysis.bass * 0.7) * sensitivity,
      0,
      1.7,
    );
    return (
      (0.006 + energy * 0.1) *
      clamp(scene.spread ?? 1, 0.2, 3) *
      (0.8 + clamp(scene.intensity, 0.1, 1.5) * 0.35)
    );
  }

  function targetFor(
    p: Particle,
    distance: number,
    spread: number,
    aspect: number,
    seconds: number,
  ) {
    const sample = geometry.at(clamp(distance) * geometry.length);
    // Offsets are expressed in stage-height units and converted back into the
    // normalised x axis so the fan keeps its proportions on a wide stage.
    const nx = sample.nx * aspect,
      ny = sample.ny,
      normalLength = Math.hypot(nx, ny) || 1;
    const sway = Math.sin(seconds * p.swaySpeed + p.sway);
    const amount = p.lateral * spread * (0.72 + 0.28 * sway);
    return {
      x: sample.x + (nx / normalLength) * amount / aspect,
      y: sample.y + (ny / normalLength) * amount,
    };
  }

  function update(
    dt: number,
    analysis: Analysis,
    scene: Scene,
    aspect: number,
    sensitivity: number,
    options: { advance?: boolean; emit?: boolean } = {},
  ) {
    sync(scene.path);
    dt = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
    const advance = options.advance ?? true;
    const emit = options.emit ?? true;
    // Only advance the clock when the stage is running; freeze must hold the
    // whole swarm still, including its idle sway.
    if (dt > 0 && advance) time += dt;

    if (!seeded) {
      lastBeat = analysis.beatCount;
      seed(scene);
      seeded = true;
    }

    // Drain every onset since the previous tick. Scene activation is handled
    // separately by bindBeat(), so a long stalled frame still delivers all of
    // its beats rather than being mistaken for a stale scene.
    const beatDelta =
      lastBeat === null ? 0 : Math.max(0, analysis.beatCount - lastBeat);
    lastBeat = analysis.beatCount;

    const density = densityOf(scene);
    const loop = loops(scene);
    if (emit && advance) {
      if (beatDelta > 0) {
        // A monotonic counter means even several very short beats between two
        // frames each get their own burst instead of merging into one.
        for (let b = 0; b < beatDelta; b++)
          burst(
            Math.max(
              2,
              Math.round(
                (3 + analysis.bass * 12 + analysis.rms * 8) *
                  density *
                  (0.65 + clamp(scene.intensity, 0.1, 1.5) * 0.45),
              ),
            ),
            scene,
          );
      }

      // Keep a steady stream alive as particles age out. The refill rate is
      // capped so a drag never gets flooded with new particles, and it only
      // tops up to the base population (bursts stay transient).
      const target = baseTarget(scene);
      const base = particles.reduce((n, p) => n + (p.base ? 1 : 0), 0);
      if (base < target) {
        const rate = (target * 0.55 + analysis.bass * 18 + analysis.rms * 8) *
          density;
        topUpCarry += Math.min(rate, target * 2) * dt;
        const additions: Particle[] = [];
        while (topUpCarry >= 1 && base + additions.length < target) {
          topUpCarry -= 1;
          additions.push(makeParticle(scene, Math.random() * 0.01, true));
        }
        if (base + additions.length >= target) topUpCarry = 0;
        push(additions);
      } else {
        topUpCarry = 0;
      }
    }

    const spread = liveSpread(analysis, scene, sensitivity);
    const speed = sceneSpeed(scene);
    // Residual decay for route edits. Travel itself is never eased, so fast
    // particles cannot lag behind their own arc position or cut corners.
    const residualDecay = Math.exp(-dt * 4);

    for (const p of particles) {
      if (advance) {
        p.age += dt;
        // On an open, stop-at-end route particles must live until they reach
        // the terminus; only their stay there is timed. Looping particles
        // expire so the stream keeps refreshing.
        if (loop || p.stopped) p.life -= dt;
      }

      p.previousDistance = p.distance;
      let wrapped = false;
      if (p.stopped) {
        if (advance) {
          p.stoppedFor += dt;
          if (loop) {
            p.stopped = false;
            p.stoppedFor = 0;
          }
        }
      } else if (advance) {
        // Arc-length travel is constant-speed in path-length units, so a cusp
        // or a zero-length segment can never make a particle accelerate.
        p.distance += p.speed * speed * dt;
        if (p.distance >= 1) {
          if (loop) {
            // Wrapping is intentional, so respawn at the route start instead
            // of gliding back across the stage. Drags never take this branch.
            p.distance = wrapDistance(p.distance, 1);
            wrapped = true;
          } else {
            p.distance = 1;
            p.stopped = true;
            p.stoppedFor = 0;
            p.previousDistance = 1;
          }
        }
      }

      const target = targetFor(p, p.distance, spread, aspect, time);
      if (wrapped) {
        // A loop teleports the particle to the start on purpose.
        p.x = p.previousX = target.x;
        p.y = p.previousY = target.y;
        p.previousDistance = p.distance;
      } else {
        // Split the target into "motion along the route" (applied exactly) and
        // "the route itself moved between ticks" (absorbed as a residual and
        // eased out). The result: sound-driven speed never causes lag or
        // corner cutting, while a live drag makes particles flow to the new
        // route instead of teleporting.
        const along = targetFor(
          p,
          p.previousDistance,
          spread,
          aspect,
          time,
        );
        const rawX = p.x + (target.x - along.x),
          rawY = p.y + (target.y - along.y);
        p.previousX = p.x;
        p.previousY = p.y;
        const residualX = rawX - target.x,
          residualY = rawY - target.y;
        p.x = target.x + residualX * residualDecay;
        p.y = target.y + residualY * residualDecay;
      }

      const fadeIn = Math.min(1, p.age / 0.16);
      const fadeOut = Math.min(1, p.life / 1.1);
      let alpha = Math.max(0, Math.min(fadeIn, fadeOut));
      if (p.stopped)
        alpha = Math.min(
          alpha,
          Math.max(0, 1 - Math.max(0, p.stoppedFor - 0.35) / 0.9),
        );
      p.alpha = Number.isFinite(alpha) ? alpha : 0;
    }

    particles = particles.filter(
      (p) =>
        (!advance || p.life > 0) &&
        !(p.stopped && p.stoppedFor > 1.35) &&
        Number.isFinite(p.x) &&
        Number.isFinite(p.y),
    );
  }

  function draw(
    c: CanvasRenderingContext2D,
    w: number,
    h: number,
    theme: Theme,
    quality = 1,
  ) {
    const scale = Math.min(w, h) / 720;
    const step = quality >= 0.999 ? 1 : Math.max(1, Math.ceil(1 / quality));
    c.save();
    c.globalCompositeOperation = "lighter";
    c.lineCap = "round";
    c.lineJoin = "round";
    for (let i = 0; i < particles.length; i += step) {
      const p = particles[i];
      const alpha = p.alpha;
      if (alpha <= 0.01) continue;
      const color = theme.colors[p.color] ?? theme.colors[0];
      const px = p.x * w,
        py = p.y * h,
        vx = (p.x - p.previousX) * w,
        vy = (p.y - p.previousY) * h;
      const travel = Math.hypot(vx, vy),
        maxTravel = 24 * scale;
      const streakScale = travel > maxTravel ? maxTravel / travel : 1;
      const bx = px - vx * streakScale,
        by = py - vy * streakScale;
      const width = (0.6 + p.size * 0.7) * scale;
      c.globalAlpha = alpha * 0.32;
      c.strokeStyle = color;
      c.lineWidth = width * 3.4;
      c.beginPath();
      c.moveTo(bx, by);
      c.lineTo(px, py);
      c.stroke();
      c.globalAlpha = alpha * 0.9;
      c.lineWidth = width;
      c.beginPath();
      c.moveTo(bx, by);
      c.lineTo(px, py);
      c.stroke();
      c.globalAlpha = alpha;
      c.fillStyle = color;
      c.beginPath();
      c.arc(px, py, width * 1.15, 0, TWO_PI);
      c.fill();
    }
    c.restore();
  }

  return {
    sync,
    update,
    draw,
    count(options: { baseOnly?: boolean } = {}) {
      return options.baseOnly
        ? particles.reduce((n, p) => n + (p.base ? 1 : 0), 0)
        : particles.length;
    },
    bindBeat(beatCount: number) {
      lastBeat = Number.isFinite(beatCount) ? beatCount : 0;
    },
    get geometry() {
      return geometry;
    },
    clear() {
      particles = [];
      seeded = false;
      lastBeat = null;
      topUpCarry = 0;
    },
  };
}
