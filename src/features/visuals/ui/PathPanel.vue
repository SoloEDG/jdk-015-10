<script setup lang="ts">
import { computed } from "vue";
import type { Scene, StageDocument } from "../../../shared/types";
import { buildPathGeometry } from "../lib/path";

const props = defineProps<{ scene: Scene; doc: StageDocument }>();
const emit = defineEmits<{ reset: []; clear: [] }>();

const path = computed(() => props.scene.path);
const geometry = computed(() => buildPathGeometry(path.value));
const overBudget = computed(() => (props.scene.density ?? 1) > 1.4);
</script>
<template>
  <section class="panel path-panel" v-if="path">
    <div class="panel-heading">
      <span>06 / TRAJECTORY</span
      ><span>{{ geometry.closed ? "CLOSED" : "OPEN" }} ·
        {{ geometry.segments.length }} SEG</span
      >
    </div>
    <p class="muted path-hint">
      在预览画面中拖动圆形把手调整路线；双击把手删除、双击线段插入。
    </p>
    <div class="live-buttons">
      <button
        :class="{ selected: path.closed }"
        @click="path.closed = !path.closed"
      >
        {{ path.closed ? "闭合路线" : "开放路线" }}
      </button>
      <button
        :class="{ selected: doc.guides }"
        @click="doc.guides = !doc.guides"
      >
        {{ doc.guides ? "隐藏辅助线" : "显示辅助线" }} <kbd>G</kbd>
      </button>
    </div>
    <div v-if="!path.closed" class="segmented">
      <span>末端处理</span>
      <button
        :class="{ selected: path.endMode === 'stop' }"
        @click="path.endMode = 'stop'"
      >
        停留并淡出
      </button>
      <button
        :class="{ selected: path.endMode === 'loop' }"
        @click="path.endMode = 'loop'"
      >
        回到起点
      </button>
    </div>
    <small class="muted path-meta">
      录制与观众画面始终不包含路径和把手，辅助线只出现在本机预览。
    </small>
    <label class="control"
      >粒子密度 <b>{{ Math.round((scene.density ?? 1) * 100) }}%</b
      ><input
        type="range"
        min="0.2"
        max="2"
        step="0.05"
        v-model.number="scene.density"
    /></label>
    <label class="control"
      >扩散范围 <b>{{ (scene.spread ?? 1).toFixed(2) }}×</b
      ><input
        type="range"
        min="0.2"
        max="2.5"
        step="0.05"
        v-model.number="scene.spread"
    /></label>
    <small class="muted path-meta">
      音量越大，粒子沿法线扩散越宽；节拍触发整次发射。
      <em>{{ geometry.length.toFixed(2) }} 舞台长度</em>
    </small>
    <small v-if="overBudget" class="muted path-meta">
      粒子较多时预览会自动降低绘制细节，发射与路径计算保持完整。
    </small>
    <div class="live-buttons path-actions">
      <button @click="emit('reset')">重置路线</button>
      <button @click="emit('clear')">清空粒子</button>
    </div>
  </section>
</template>
