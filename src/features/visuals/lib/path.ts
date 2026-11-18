import type { MotionPath, PathPoint } from "../../../shared/types";

/** Consecutive points closer than this are treated as the same point. */
export const MIN_SEGMENT = 1e-5;

export interface PathSample {
  x: number;
  y: number;
  /** Unit tangent, pointing from the start towards the end of the path. */
  tx: number;
  ty: number;
  /** Unit normal (left side of the direction of travel). */
  nx: number;
  ny: number;
}

interface Segment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  dx: number;
  dy: number;
  len: number;
  ux: number;
  uy: number;
  start: number;
}

export interface PathGeometry {
  points: PathPoint[];
  segments: Segment[];
  length: number;
  closed: boolean;
  /** Sample by arc length. Distance is clamped to [0, length]. */
  at(distance: number): PathSample;
}

const IDENTITY_SAMPLE: PathSample = {
  x: 0.5,
  y: 0.5,
  tx: 1,
  ty: 0,
  nx: 0,
  ny: 1,
};

export function sanitizePoints(
  points: PathPoint[] | undefined,
  closed: boolean,
): PathPoint[] {
  const out: PathPoint[] = [];
  for (const point of points ?? []) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const x = Math.max(0, Math.min(1, point.x));
    const y = Math.max(0, Math.min(1, point.y));
    const last = out[out.length - 1];
    if (last && Math.hypot(x - last.x, y - last.y) <= MIN_SEGMENT) continue;
    out.push({ x, y });
  }
  if (closed && out.length > 1) {
    const first = out[0],
      last = out[out.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) <= MIN_SEGMENT)
      out.pop();
  }
  return out;
}

/**
 * Build an arc-length parameterised polyline. Zero-length segments are
 * discarded and every fallback (degenerate path, missing points) returns a
 * finite sample, so callers can never divide by zero or normalise a zero
 * vector — the source of runaway acceleration at duplicate points/cusps.
 */
export function buildPathGeometry(path?: MotionPath | null): PathGeometry {
  const closed = Boolean(path?.closed);
  const points = sanitizePoints(path?.points, closed);
  if (!points.length) points.push({ x: 0.5, y: 0.5 });

  const segments: Segment[] = [];
  const sequence = [...points];
  if (closed && points.length > 1) sequence.push(points[0]);
  let length = 0;
  for (let i = 1; i < sequence.length; i++) {
    const a = sequence[i - 1],
      b = sequence[i];
    const dx = b.x - a.x,
      dy = b.y - a.y,
      len = Math.hypot(dx, dy);
    if (len <= MIN_SEGMENT) continue;
    segments.push({
      ax: a.x,
      ay: a.y,
      bx: b.x,
      by: b.y,
      dx,
      dy,
      len,
      ux: dx / len,
      uy: dy / len,
      start: length,
    });
    length += len;
  }

  function at(distance: number): PathSample {
    if (!segments.length) {
      const p = points[0];
      return { ...IDENTITY_SAMPLE, x: p.x, y: p.y };
    }
    const d = Number.isFinite(distance)
      ? Math.max(0, Math.min(length, distance))
      : 0;
    let lo = 0,
      hi = segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const segment = segments[mid];
      if (segment.start + segment.len < d) lo = mid + 1;
      else hi = mid;
    }
    const segment = segments[lo];
    const t =
      segment.len > 0
        ? Math.max(0, Math.min(1, (d - segment.start) / segment.len))
        : 0;
    return {
      x: segment.ax + segment.dx * t,
      y: segment.ay + segment.dy * t,
      tx: segment.ux,
      ty: segment.uy,
      nx: -segment.uy,
      ny: segment.ux,
    };
  }

  return { points, segments, length, closed, at };
}

export function pathSignature(path?: MotionPath | null): string {
  if (!path) return "";
  return (
    `${path.closed ? 1 : 0}|${path.endMode}|` +
    path.points
      .map((p) => `${p.x.toFixed(5)},${p.y.toFixed(5)}`)
      .join(";")
  );
}

export function wrapDistance(distance: number, length: number): number {
  if (!(length > MIN_SEGMENT)) return 0;
  const wrapped = distance % length;
  return wrapped < 0 ? wrapped + length : wrapped;
}

/** Squared pixel distance from a point to a segment, for hit testing. */
export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax,
    dy = by - ay,
    len2 = dx * dx + dy * dy;
  if (len2 <= MIN_SEGMENT * MIN_SEGMENT)
    return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}
