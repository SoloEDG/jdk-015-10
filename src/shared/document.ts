import { reactive } from "vue";
import type { MotionPath, PathPoint, StageDocument } from "./types";

export const DEFAULT_PATH_POINTS: PathPoint[] = [
  { x: 0.12, y: 0.6 },
  { x: 0.28, y: 0.3 },
  { x: 0.46, y: 0.68 },
  { x: 0.64, y: 0.3 },
  { x: 0.82, y: 0.58 },
];

export function createDefaultPath(): MotionPath {
  return {
    points: DEFAULT_PATH_POINTS.map((p) => ({ ...p })),
    closed: false,
    endMode: "loop",
  };
}

export function createDocument(): StageDocument {
  return reactive({
    scenes: [
      {
        id: "s1",
        name: "Celestial orbit",
        kind: "orbit",
        theme: "violet",
        intensity: 0.8,
        speed: 1,
      },
      {
        id: "s2",
        name: "Frequency field",
        kind: "spectrum",
        theme: "mint",
        intensity: 0.75,
        speed: 1,
      },
      {
        id: "s3",
        name: "Liquid signal",
        kind: "wave",
        theme: "ember",
        intensity: 0.7,
        speed: 0.6,
      },
      {
        id: "s4",
        name: "Into the void",
        kind: "tunnel",
        theme: "ice",
        intensity: 0.9,
        speed: 1.2,
      },
      {
        id: "s5",
        name: "Ink trajectory",
        kind: "path",
        theme: "violet",
        intensity: 0.85,
        speed: 0.8,
        path: createDefaultPath(),
        density: 0.75,
        spread: 1,
      },
    ],
    activeId: "s1",
    gain: 0.65,
    sensitivity: 1.2,
    smoothing: 0.78,
    transition: 1.2,
    blackout: false,
    frozen: false,
    strobe: false,
    master: 1,
    guides: true,
    presentation: false,
  });
}
