<template>
  <div class="wear-progress" :class="`tier-${tier}`" :style="{ '--glow-color': color }" data-testid="wear-progress-bar">
    <span v-if="lapCount >= 1" class="lap-badge" data-testid="lap-badge">{{ lapCount }}x</span>
    <div class="bar-wrap">
      <div class="bar-fill" :style="{ width: fillFraction * 100 + '%', background: color }"></div>
      <div
        v-if="targetMarkerFraction !== null"
        class="target-marker"
        data-testid="target-marker"
        :style="{ left: targetMarkerFraction * 100 + '%' }"
      ></div>
      <div v-if="tier >= 2" class="sparkle-field">
        <div
          v-for="(s, i) in sparkles"
          :key="i"
          class="sparkle"
          :style="{ left: s.left + '%', top: s.top + '%', animationDelay: s.delay + 's' }"
        ></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { lapTier } from '../utils/wearCalculations.js';

const props = withDefaults(
  defineProps<{
    fillFraction: number;
    color: string;
    targetMarkerFraction?: number | null;
    lapCount?: number;
  }>(),
  {
    targetMarkerFraction: null,
    lapCount: 0,
  },
);

const tier = computed(() => lapTier(props.lapCount));

/** Sparkle count per tier: 0 (plain), 1 (glow only), 2, 3, 4 (max, capped). */
const SPARKLE_COUNTS = [0, 0, 6, 20, 28];

function generateSparkles(n: number): { left: number; top: number; delay: number }[] {
  if (n === 0) return [];
  const tops = [0, 15, 30, 45, 60];
  return Array.from({ length: n }, (_, i) => ({
    left: Math.round(i * (96 / (n - 1)) * 10) / 10,
    top: tops[i % tops.length],
    delay: Math.round(i * (1.4 / n) * 100) / 100,
  }));
}

const sparkles = computed(() => generateSparkles(SPARKLE_COUNTS[tier.value]));
</script>

<style scoped>
.wear-progress {
  position: relative;
}
.lap-badge {
  position: absolute;
  top: -18px;
  right: 0;
  font-size: 11px;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 999px;
  color: #fff;
  background: var(--glow-color);
}
.bar-wrap {
  position: relative;
  height: 6px;
  border-radius: 999px;
  background: #e5e7eb;
  overflow: visible;
}
.bar-fill {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  transition: width 1s;
}
.target-marker {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #4b5563;
}
.sparkle-field {
  position: absolute;
  inset: -6px -2px;
  pointer-events: none;
}
.sparkle {
  position: absolute;
  width: 6px;
  height: 6px;
  background: var(--glow-color);
  clip-path: polygon(50% 0%, 63% 37%, 100% 50%, 63% 63%, 50% 100%, 37% 63%, 0% 50%, 37% 37%);
  opacity: 0;
  animation: sparkle-pop 1.6s ease-in-out infinite;
}
@keyframes sparkle-pop {
  0% { opacity: 0; transform: scale(0.3) rotate(0deg); }
  40% { opacity: 1; transform: scale(1.15) rotate(25deg); }
  100% { opacity: 0; transform: scale(0.3) rotate(45deg); }
}
@keyframes glow-pulse {
  0%, 100% { box-shadow: 0 0 2px 0 var(--glow-color); }
  50% { box-shadow: 0 0 10px 2px var(--glow-color); }
}
.tier-1 .bar-fill { animation: glow-pulse 1.8s ease-in-out infinite; }
.tier-2 .bar-fill { animation: glow-pulse 1.6s ease-in-out infinite; }
.tier-3 .bar-fill { animation: glow-pulse 1.1s ease-in-out infinite; }
.tier-4 .bar-fill { animation: glow-pulse 0.7s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .bar-fill, .sparkle { animation: none !important; }
}
</style>
