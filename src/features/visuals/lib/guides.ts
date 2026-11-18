import type { MotionPath, Theme } from "../../../shared/types";
import { buildPathGeometry } from "./path";

export interface GuideState {
  hover: number;
  active: number;
  dragging: boolean;
}

export function drawPathGuides(
  c: CanvasRenderingContext2D,
  w: number,
  h: number,
  path: MotionPath | undefined,
  theme: Theme,
  state: GuideState = { hover: -1, active: -1, dragging: false },
) {
  const geometry = buildPathGeometry(path);
  const routePoints = geometry.points;
  // Handles use the authored points so a handle dragged onto its neighbour
  // (a zero-length segment) is still visible and can be pulled back out.
  const points = path?.points ?? routePoints;
  if (!points.length) return;
  const scale = Math.min(w, h) / 720;
  const px = (p: { x: number; y: number }) => ({ x: p.x * w, y: p.y * h });

  c.clearRect(0, 0, w, h);
  c.save();
  c.lineCap = "round";
  c.lineJoin = "round";

  // Soft under-stroke keeps the route readable over bright particles.
  const route = () => {
    c.beginPath();
    routePoints.forEach((p, i) => {
      const q = px(p);
      i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y);
    });
    if (geometry.closed && routePoints.length > 2) c.closePath();
  };
  route();
  c.strokeStyle = "rgba(6,7,14,.52)";
  c.lineWidth = 6 * scale;
  c.setLineDash([]);
  c.stroke();

  route();
  c.strokeStyle = "rgba(226,220,255,.62)";
  c.lineWidth = 1.25 * scale;
  c.setLineDash([7 * scale, 6 * scale]);
  c.lineDashOffset = 0;
  c.stroke();
  c.setLineDash([]);

  // Direction chevrons repeat along the route so long paths read clearly even
  // between handles, and so the terminus arrow never hides under a handle.
  if (geometry.length > 0) {
    const size = 11 * scale;
    const chevron = (distance: number, alpha: number) => {
      const sample = geometry.at(distance);
      const cx = sample.x * w,
        cy = sample.y * h,
        dx = sample.tx,
        dy = sample.ty;
      // Filled arrowhead pointing along travel, backed by a dark halo so it
      // stays legible over bright particles.
      const tipX = cx + dx * size,
        tipY = cy + dy * size;
      const backX = cx - dx * size * 0.55,
        backY = cy - dy * size * 0.55;
      const wing = size * 0.62;
      c.globalAlpha = alpha;
      c.lineJoin = "round";
      for (const [color, width] of [
        ["rgba(7,8,16,.72)", 3.4],
        ["rgba(247,243,255,.98)", 1],
      ] as const) {
        c.strokeStyle = color;
        c.fillStyle = color;
        c.lineWidth = width * scale;
        c.beginPath();
        c.moveTo(tipX, tipY);
        c.lineTo(backX - dy * wing, backY + dx * wing);
        c.lineTo(backX + dy * wing, backY - dx * wing);
        c.closePath();
        c.stroke();
        c.fill();
      }
    };
    const count = Math.max(
      2,
      Math.round(geometry.length * 9),
    );
    for (let i = 0; i < count; i++)
      chevron(
        (geometry.length * (i + 0.5)) / count,
        geometry.closed ? 0.75 : 0.88,
      );
    c.globalAlpha = 1;
  }

  // Open routes get explicit start/end labels; closed ones only need a loop.
  if (!geometry.closed && points.length > 1) {
    const label = (p: { x: number; y: number }, text: string) => {
      const q = px(p);
      c.beginPath();
      c.arc(q.x, q.y, 2.6 * scale, 0, 7);
      c.fillStyle = "rgba(248,244,255,.95)";
      c.fill();
      c.font = `${Math.round(9 * scale)}px "Space Grotesk", sans-serif`;
      c.fillStyle = "rgba(9,9,18,.68)";
      const width = c.measureText(text).width + 9 * scale;
      c.beginPath();
      c.roundRect(q.x - width / 2, q.y - 22 * scale, width, 13 * scale, 3 * scale);
      c.fill();
      c.fillStyle = "rgba(240,236,255,.9)";
      c.fillText(text, q.x - width / 2 + 4.5 * scale, q.y - 12.5 * scale);
    };
    label(points[0], "START");
    label(points[points.length - 1], "END");
  }

  const radius = 6.5 * scale;
  // Handles are never sampled down by preview quality: editing must stay
  // precise even when the particle painting is thinned.
  points.forEach((p, i) => {
    const q = px(p);
    const isActive = i === state.active;
    const isHover = i === state.hover && !state.dragging;
    c.beginPath();
    c.arc(q.x, q.y, radius + (isActive || isHover ? 3.5 : 0) * scale, 0, 7);
    c.fillStyle = isActive
      ? "rgba(255,255,255,.96)"
      : isHover
        ? "rgba(255,255,255,.82)"
        : "rgba(14,14,25,.72)";
    c.fill();
    c.lineWidth = (isActive ? 2.4 : 1.6) * scale;
    c.strokeStyle = isActive ? theme.colors[0] : "rgba(235,229,255,.92)";
    c.stroke();
    c.beginPath();
    c.arc(q.x, q.y, 1.7 * scale, 0, 7);
    c.fillStyle = isActive ? theme.colors[0] : "rgba(235,229,255,.9)";
    c.fill();
    if (isActive || isHover) {
      c.font = `${Math.round(10 * scale)}px "Space Grotesk", sans-serif`;
      c.fillStyle = "rgba(9,9,18,.72)";
      const label = `${i + 1}`;
      const widths = c.measureText(label).width + 10 * scale;
      c.beginPath();
      c.roundRect(
        q.x + radius * 1.4,
        q.y - radius * 2.5,
        widths,
        15 * scale,
        4 * scale,
      );
      c.fill();
      c.fillStyle = "rgba(240,236,255,.92)";
      c.fillText(label, q.x + radius * 1.4 + 5 * scale, q.y - radius * 2.5 + 11 * scale);
    }
  });

  c.restore();
}
