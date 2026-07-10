<template>
  <div class="wear-progress" :class="`tier-${tier}`" :style="{ '--glow-color': barColor }" data-testid="wear-progress-bar">
    <div class="bar-row">
      <div class="bar-wrap">
        <div
          class="bar-fill"
          :class="{ 'decay-shadow': mode === 'decay', 'decay-anchor-right': mode === 'decay' }"
          :style="{ width: fillFraction * 100 + '%', background: barColor }"
        ></div>
        <div
          v-if="mode === 'wear' && targetMarkerFraction !== null"
          class="target-marker"
          data-testid="target-marker"
          :style="{ left: targetMarkerFraction * 100 + '%' }"
        ></div>
        <div v-if="mode === 'wear' && tier >= 2" class="sparkle-field">
          <div
            v-for="(s, i) in sparkles"
            :key="i"
            class="sparkle"
            :style="{ left: s.left + '%', top: s.top + '%', animationDelay: s.delay + 's' }"
          ></div>
        </div>
      </div>
      <span v-if="mode === 'wear' && lapCount >= 1" class="lap-badge" data-testid="lap-badge">{{ lapCount }}x</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { lapTier } from '../utils/wearCalculations.js';

const props = withDefaults(
  defineProps<{
    mode?: 'wear' | 'rest' | 'decay';
    fillFraction: number;
    color?: string;
    targetMarkerFraction?: number | null;
    lapCount?: number;
  }>(),
  {
    mode: 'wear',
    color: '#000000',
    targetMarkerFraction: null,
    lapCount: 0,
  },
);

const barColor = computed(() => {
  if (props.mode === 'rest') return '#d1d5db';
  if (props.mode === 'decay') return '#111827';
  return props.color;
});

const tier = computed(() => (props.mode === 'wear' ? lapTier(props.lapCount) : 0));

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
  padding-top: 4px;
}
.bar-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.lap-badge {
  flex: none;
  font-size: 11px;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 999px;
  color: #fff;
  background: var(--glow-color);
}
.bar-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
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
.bar-fill.decay-anchor-right {
  left: auto;
  right: 0;
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
.decay-shadow {
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.6);
}
</style>
