import type { Analysis, Scene, StageDocument } from "../../../shared/types";
import { getTheme } from "./themes";
import { drawScene } from "../lib/geometry";
import { createPathField, type PathField } from "./particleField";
import { drawPathGuides, type GuideState } from "../lib/guides";

export interface RendererOptions {
  /**
   * Effective detail multiplier for the preview, 0.25–1. Simulation and
   * emission always run at full fidelity; only painting is thinned.
   */
  quality?: () => number;
  /** While recording, guides are never painted and detail stays at 100%. */
  recording?: () => boolean;
  /** Pointer feedback for the editor overlay, owned by the stage component. */
  guideState?: () => GuideState;
}

/**
 * The bitmap is always authored at 720p and scaled with CSS. Path coordinates
 * are normalised to this frame, so the preview, a resized window, and an
 * exported take all describe the same shape and the same particle density.
 */
export const STAGE_WIDTH = 1280;
export const STAGE_HEIGHT = 720;

export function createRenderer(
  canvas: HTMLCanvasElement,
  doc: StageDocument,
  read: () => Analysis,
  options: RendererOptions = {},
) {
  const c = canvas.getContext("2d")!;
  let raf = 0,
    last = 0,
    lastPaint = 0,
    phase = 0,
    current = "",
    previous: Scene | undefined,
    changed = 0;
  const scratch = document.createElement("canvas");
  scratch.width = STAGE_WIDTH;
  scratch.height = STAGE_HEIGHT;
  const sc = scratch.getContext("2d")!;
  canvas.width = STAGE_WIDTH;
  canvas.height = STAGE_HEIGHT;

  // One persistent swarm per path scene, so switching scenes and coming back
  // does not reset the route or the particles in flight.
  const fields = new Map<string, PathField>();
  function fieldFor(scene: Scene) {
    let field = fields.get(scene.id);
    if (!field) {
      field = createPathField();
      fields.set(scene.id, field);
    }
    field.sync(scene.path);
    return field;
  }

  // A guide overlay is a second canvas layered above the stage. The stage
  // canvas itself — and therefore the recorded stream — never receives guides.
  const overlay = canvas.parentElement?.querySelector<HTMLCanvasElement>(
    "canvas.stage-guides",
  );
  const oc = overlay?.getContext("2d");

  function effectiveQuality(scene: Scene) {
    if (options.recording?.()) return 1;
    const preferred = options.quality?.() ?? 1;
    if (scene.kind !== "path") return preferred;
    const field = fieldFor(scene);
    // Too many particles for the preview: keep every simulation tick and every
    // emission, and only show a representative sample of the swarm.
    const load = field.count() > 380 ? Math.max(0.3, 380 / field.count()) : 1;
    return Math.max(0.25, Math.min(preferred, load));
  }

  function render(ms: number) {
    lastPaint = performance.now();
    const rawDt = (ms - last) / 1000;
    const dt = last ? Math.min(0.1, rawDt) : 0;
    last = ms;
    const scene =
      doc.scenes.find((s) => s.id === doc.activeId) ?? doc.scenes[0];
    let activated = false;
    if (current !== scene.id) {
      previous = doc.scenes.find((s) => s.id === current);
      current = scene.id;
      changed = ms;
      activated = true;
    }
    if (!doc.frozen) phase += dt * scene.speed;
    const a = read(),
      t = getTheme(scene.theme);
    const quality = effectiveQuality(scene);

    if (scene.kind === "path") {
      // Advance the shared swarm once per frame, in normalised stage space.
      const field = fieldFor(scene);
      if (activated) field.bindBeat(a.beatCount);
      field.update(
        dt,
        a,
        scene,
        STAGE_WIDTH / STAGE_HEIGHT,
        doc.sensitivity,
        { advance: !doc.frozen },
      );
    }

    drawScene(c, STAGE_WIDTH, STAGE_HEIGHT, scene, a, t, phase, doc.sensitivity, {
      pathField: scene.kind === "path" ? fieldFor(scene) : undefined,
      quality,
    });
    const mix = Math.min(1, (ms - changed) / (doc.transition * 1000 || 1));
    if (previous && mix < 1) {
      drawScene(
        sc,
        STAGE_WIDTH,
        STAGE_HEIGHT,
        previous,
        a,
        getTheme(previous.theme),
        phase,
        doc.sensitivity,
        {
          pathField: previous.kind === "path" ? fieldFor(previous) : undefined,
          quality,
        },
      );
      c.globalAlpha = 1 - mix;
      c.drawImage(scratch, 0, 0);
      c.globalAlpha = 1;
    }
    if (doc.strobe && a.beat) {
      c.fillStyle = "#ffffff66";
      c.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
    }
    c.fillStyle = `rgba(0,0,0,${doc.blackout ? 1 : 1 - doc.master})`;
    c.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);

    if (oc && overlay) {
      if (overlay.width !== STAGE_WIDTH || overlay.height !== STAGE_HEIGHT) {
        overlay.width = STAGE_WIDTH;
        overlay.height = STAGE_HEIGHT;
      }
      // Guides belong to the editor only: never in recordings, never in the
      // audience/fullscreen presentation, and never on the recorded canvas.
      const showGuides =
        scene.kind === "path" &&
        doc.guides &&
        !doc.presentation &&
        !options.recording?.();
      if (showGuides)
        drawPathGuides(
          oc,
          STAGE_WIDTH,
          STAGE_HEIGHT,
          scene.path,
          getTheme(scene.theme),
          options.guideState?.(),
        );
      else oc.clearRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
    }

    raf = requestAnimationFrame(render);
  }
  render(performance.now());
  // While capturing, keep the canvas fed even if animation frames are throttled
  // (background tab, slow GPU). Onset emission itself is drained from the
  // monotonic beat counter, so no short trigger is lost either way.
  const watchdog = window.setInterval(() => {
    if (options.recording?.() && performance.now() - lastPaint > 40)
      render(performance.now());
  }, 33);
  return {
    dispose() {
      cancelAnimationFrame(raf);
      window.clearInterval(watchdog);
      fields.clear();
    },
    clearField(sceneId: string) {
      fields.get(sceneId)?.clear();
    },
  };
}

export type StageRenderer = ReturnType<typeof createRenderer>;
