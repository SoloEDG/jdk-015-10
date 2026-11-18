import type { Analysis } from "../../../shared/types";

export interface BeatOptions {
  /** Minimum gap between onsets, in seconds. Keeps one kick from firing twice. */
  refractory?: number;
  /** Absolute low-end floor. */
  threshold?: number;
  /** Required rise over the previous frame's low end. */
  rise?: number;
}

/**
 * Rising-edge low-end detector with a refractory window. The demo kick decays
 * over several frames, and a naive per-frame comparison triggered 2–3 times per
 * hit; the refractory makes each physical beat a single event.
 */
export function createBeatDetector(options: BeatOptions = {}) {
  const refractory = options.refractory ?? 0.14;
  const threshold = options.threshold ?? 0.23;
  const rise = options.rise ?? 1.12;
  let previous = 0;
  let lastAt = -Infinity;
  return {
    detect(bass: number, now: number): boolean {
      const beat =
        Number.isFinite(now) &&
        now - lastAt >= refractory &&
        bass > threshold &&
        bass > previous * rise;
      if (beat) lastAt = now;
      previous = bass;
      return beat;
    },
    reset(bass = 0, now = 0) {
      previous = bass;
      lastAt = now - refractory;
    },
  };
}
export type BeatDetector = ReturnType<typeof createBeatDetector>;

/**
 * @param beat Rising-edge result from the detector.
 * @param beatCount Monotonic counter from the previous frame. Visuals drain the
 *   delta, so a slow render frame can never swallow a short onset.
 */
export function analyse(
  freq: Uint8Array,
  wave: Uint8Array,
  time: number,
  beat: boolean,
  beatCount = 0,
): Analysis {
  const rms = Math.sqrt(
    wave.reduce((s, v) => s + ((v - 128) / 128) ** 2, 0) / wave.length,
  );
  const bass = freq.slice(0, 12).reduce((s, v) => s + v, 0) / 12 / 255;
  return {
    bins: Array.from(freq, (v) => v / 255),
    wave: Array.from(wave, (v) => (v - 128) / 128),
    rms,
    bass,
    beat,
    beatCount: beat ? beatCount + 1 : beatCount,
    time,
  };
}
