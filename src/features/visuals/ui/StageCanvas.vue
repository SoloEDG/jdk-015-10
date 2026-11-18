<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import type { StageDocument, Analysis } from "../../../shared/types";
import { createRenderer, type StageRenderer } from "../model/renderer";
import { distanceToSegment } from "../lib/path";

const props = defineProps<{
  doc: StageDocument;
  read: () => Analysis;
  /**
   * Read at draw time (not through a prop snapshot) so the very first recorded
   * frame already excludes guides, before Vue flushes child updates.
   */
  recording: () => boolean;
}>();
const emit = defineEmits<{ ready: [HTMLCanvasElement] }>();
const canvas = ref<HTMLCanvasElement>();
const overlay = ref<HTMLCanvasElement>();
const state = reactive({ hover: -1, active: -1, dragging: false });
let stage: StageRenderer | undefined;
let dragPointer: number | null = null;

const activeScene = computed(
  () =>
    props.doc.scenes.find((s) => s.id === props.doc.activeId) ??
    props.doc.scenes[0],
);
const guideVisible = computed(
  () =>
    activeScene.value.kind === "path" &&
    props.doc.guides &&
    !props.doc.presentation &&
    !props.recording() &&
    Boolean(activeScene.value.path?.points.length),
);

const HANDLE_GRAB = 12;

function pointerPixel(e: PointerEvent | MouseEvent) {
  const rect = overlay.value?.getBoundingClientRect();
  if (!rect || !rect.width || !rect.height) return null;
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
    width: rect.width,
    height: rect.height,
  };
}

/** Hit testing happens in pixels, so handles stay easy to grab at any size. */
function hitTest(px: number, py: number) {
  const path = activeScene.value.path;
  const rect = overlay.value?.getBoundingClientRect();
  if (!path || !rect) return -1;
  const x = px / rect.width,
    y = py / rect.height;
  let best = -1,
    bestDistance = HANDLE_GRAB;
  path.points.forEach((p, i) => {
    const dx = (p.x - x) * rect.width,
      dy = (p.y - y) * rect.height;
    const d = Math.hypot(dx, dy);
    if (d <= bestDistance) {
      bestDistance = d;
      best = i;
    }
  });
  return best;
}

function hoverAt(e: PointerEvent) {
  if (dragPointer !== null) return;
  const p = pointerPixel(e);
  if (!p) return;
  state.hover = hitTest(p.x, p.y);
  if (overlay.value)
    overlay.value.style.cursor = state.hover >= 0 ? "grab" : "crosshair";
}

function pointerDown(e: PointerEvent) {
  if (!guideVisible.value) return;
  const p = pointerPixel(e);
  if (!p) return;
  const index = hitTest(p.x, p.y);
  if (index < 0) return;
  e.preventDefault();
  state.active = index;
  state.dragging = true;
  dragPointer = e.pointerId;
  overlay.value?.setPointerCapture(e.pointerId);
  if (overlay.value) overlay.value.style.cursor = "grabbing";
}

function pointerMove(e: PointerEvent) {
  if (!guideVisible.value) return;
  const p = pointerPixel(e);
  if (!p) return;
  if (dragPointer === null) {
    hoverAt(e);
    return;
  }
  if (e.pointerId !== dragPointer) return;
  const path = activeScene.value.path;
  if (!path) return;
  const point = path.points[state.active];
  if (!point) return;
  // Clamp inside the stage; zero-length segments are allowed while dragging
  // and handled safely by the geometry / simulation.
  point.x = Math.min(1, Math.max(0, p.x / p.width));
  point.y = Math.min(1, Math.max(0, p.y / p.height));
}

function endDrag(e: PointerEvent) {
  if (dragPointer === null || e.pointerId !== dragPointer) return;
  dragPointer = null;
  state.dragging = false;
  if (overlay.value?.hasPointerCapture(e.pointerId))
    overlay.value.releasePointerCapture(e.pointerId);
  if (overlay.value) overlay.value.style.cursor = "crosshair";
}

function pointerLeave() {
  if (dragPointer !== null) return;
  state.hover = -1;
  if (overlay.value) overlay.value.style.cursor = "crosshair";
}

/** Double-click a handle to remove it, or the route to insert a handle. */
function doubleClick(e: MouseEvent) {
  if (!guideVisible.value) return;
  const path = activeScene.value.path;
  const p = pointerPixel(e);
  if (!path || !p) return;
  const index = hitTest(p.x, p.y);
  if (index >= 0) {
    if (path.points.length <= 2) return;
    path.points.splice(index, 1);
    state.active = -1;
    state.hover = -1;
    return;
  }
  // Insert on the closest segment, preserving path order. Distances are
  // measured in pixels so a wide stage does not favour horizontal segments.
  const rx = p.x / p.width,
    ry = p.y / p.height;
  const at = (index: number) => {
    const q = path.points[index];
    return { x: q.x * p.width, y: q.y * p.height };
  };
  let best = path.points.length - 1,
    bestDistance = Infinity;
  for (let i = 0; i < path.points.length - 1; i++) {
    const a = at(i),
      b = at(i + 1);
    const d = distanceToSegment(p.x, p.y, a.x, a.y, b.x, b.y);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  if (path.closed && path.points.length > 1) {
    const a = at(path.points.length - 1),
      b = at(0);
    const d = distanceToSegment(p.x, p.y, a.x, a.y, b.x, b.y);
    if (d < bestDistance) {
      path.points.push({ x: rx, y: ry });
      state.active = path.points.length - 1;
      return;
    }
  }
  path.points.splice(best + 1, 0, { x: rx, y: ry });
  state.active = best + 1;
}

/**
 * Keyboard fallback for the same edits: tab to the overlay, arrows nudge the
 * selected handle, Delete removes it. Shift accelerates the nudge.
 */
function keyDown(e: KeyboardEvent) {
  if (!guideVisible.value) return;
  const path = activeScene.value.path;
  if (!path?.points.length) return;
  const index = Math.min(
    path.points.length - 1,
    Math.max(0, state.active >= 0 ? state.active : 0),
  );
  const point = path.points[index];
  const step = e.shiftKey ? 0.02 : 0.005;
  let handled = true;
  if (e.key === "ArrowLeft") point.x = Math.max(0, point.x - step);
  else if (e.key === "ArrowRight") point.x = Math.min(1, point.x + step);
  else if (e.key === "ArrowUp") point.y = Math.max(0, point.y - step);
  else if (e.key === "ArrowDown") point.y = Math.min(1, point.y + step);
  else if ((e.key === "Delete" || e.key === "Backspace") && path.points.length > 2) {
    path.points.splice(index, 1);
    state.active = Math.min(index, path.points.length - 1);
  } else handled = false;
  if (handled) {
    e.preventDefault();
    e.stopPropagation();
    state.active = Math.min(index, path.points.length - 1);
  }
}

onMounted(() => {
  if (!canvas.value) return;
  stage = createRenderer(canvas.value, props.doc, props.read, {
    recording: () => props.recording(),
    guideState: () => ({
      hover: state.hover,
      active: state.active,
      dragging: state.dragging,
    }),
    quality: () => 1,
  });
  emit("ready", canvas.value);
});
onUnmounted(() => stage?.dispose());

defineExpose({
  clearParticles(id: string) {
    stage?.clearField(id);
  },
});
</script>
<template>
  <div class="canvas-stack" :class="{ editing: guideVisible }">
    <canvas ref="canvas" class="stage-canvas" aria-label="音乐可视化舞台" />
    <canvas
      ref="overlay"
      class="stage-guides"
      aria-label="运动路径编辑辅助线：拖动把手调整路线，方向键微调，Delete 删除"
      :aria-hidden="!guideVisible"
      :tabindex="guideVisible ? 0 : -1"
      @keydown="keyDown"
      @pointerdown="pointerDown"
      @pointermove="pointerMove"
      @pointerup="endDrag"
      @pointercancel="endDrag"
      @pointerleave="pointerLeave"
      @dblclick="doubleClick"
    />
  </div>
</template>
