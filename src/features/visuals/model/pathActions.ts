import type { Scene } from "../../../shared/types";
import { createDefaultPath } from "../../../shared/document";

/** Replace a path scene's route with the default open trajectory. */
export function resetPath(scene: Scene) {
  scene.path = createDefaultPath();
  if (scene.kind !== "path") scene.kind = "path";
}
