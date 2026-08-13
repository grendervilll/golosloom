// Полукруговой индикатор нагрузки: заливка привязана к реальному проценту
// (низкая нагрузка — почти пусто, высокая — заполнен до конца).
<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  label: string
  percent: number | string
  value?: string
}>()

// Длина полуокружности при r=40: π·40 ≈ 125.66.
const ARC_LEN = 125.66

const pct = computed(() => {
  const v = Number(props.percent) || 0
  return Math.max(0, Math.min(100, v))
})
const dash = computed(() => (pct.value / 100) * ARC_LEN)
const color = computed(() => {
  if (pct.value >= 80) return '#da373c'
  if (pct.value >= 60) return '#f0b232'
  return '#23a55a'
})
</script>

<template>
  <div class="gauge">
    <svg viewBox="0 0 100 60" class="gauge-svg">
      <path d="M10,55 A40,40 0 0 1 90,55" fill="none" stroke="#e9e9e9" stroke-width="9" stroke-linecap="round" />
      <path
        d="M10,55 A40,40 0 0 1 90,55"
        fill="none"
        :stroke="color"
        stroke-width="9"
        stroke-linecap="round"
        :stroke-dasharray="`${dash} 200`"
        class="gauge-fill"
      />
      <text x="50" y="46" text-anchor="middle" class="gauge-pct">{{ Math.round(pct) }}%</text>
    </svg>
    <p class="gauge-label">{{ label }}</p>
    <p v-if="value" class="gauge-value">{{ value }}</p>
  </div>
</template>

<style scoped>
.gauge {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 6px 8px;
}
.gauge-svg {
  width: 104px;
  height: 62px;
}
/* Плавная анимация при обновлении значений каждые 2 секунды. */
.gauge-fill {
  transition:
    stroke-dasharray 0.6s ease,
    stroke 0.6s ease;
}
.gauge-pct {
  fill: var(--text);
  font-size: 15px;
  font-weight: 700;
}
.gauge-label {
  margin-top: 2px;
  font-size: 11px;
  text-transform: uppercase;
  color: var(--text-dim);
  font-weight: 700;
}
.gauge-value {
  font-size: 11px;
  color: var(--text-dim);
}
</style>
