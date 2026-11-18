export type SceneKind = "orbit" | "spectrum" | "wave" | "tunnel" | "path";
export type PathEndMode = "stop" | "loop";
export interface PathPoint {
  /** Horizontal position in stage space, 0–1. */
  x: number;
  /** Vertical position in stage space, 0–1. */
  y: number;
}
export interface MotionPath {
  points: PathPoint[];
  closed: boolean;
  /** Only used by open paths. Closed paths always loop. */
  endMode: PathEndMode;
}
export interface Scene {
  id: string;
  name: string;
  kind: SceneKind;
  theme: string;
  intensity: number;
  speed: number;
  /** Path data, used by ``kind === "path"`` scenes. */
  path?: MotionPath;
  /** Particle density multiplier (0.2–2). */
  density?: number;
  /** Multiplier for the sound-driven spread of the particle swarm. */
  spread?: number;
}
export interface Analysis {
  bins: number[];
  wave: number[];
  rms: number;
  bass: number;
  beat: boolean;
  /**
   * Monotonic beat counter. Visuals consume this instead of the boolean so a
   * dropped animation frame can never swallow a short, one-frame beat.
   */
  beatCount: number;
  time: number;
}
export interface StageDocument {
  scenes: Scene[];
  activeId: string;
  gain: number;
  sensitivity: number;
  smoothing: number;
  transition: number;
  blackout: boolean;
  frozen: boolean;
  strobe: boolean;
  master: number;
  /** Editor-only path guides and handles. Never drawn into the stage canvas. */
  guides: boolean;
  /** Audience/fullscreen presentation: no editor chrome, no guides. */
  presentation: boolean;
}
export interface Take {
  id: string;
  url: string;
  size: number;
  duration: number;
  name: string;
  mime: string;
}
export interface Theme {
  id: string;
  name: string;
  colors: [string, string, string];
  background: string;
}
