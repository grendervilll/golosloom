// Просмотр видео-сообщения: прямоугольный попап по центру экрана,
// занимает ~70% доступной площади. Свои элементы управления (прогресс,
// перемотка), потому что у webm-записей из MediaRecorder длительность
// Infinity и нативные контролы Chrome не показывают прогресс.
// Клик по фону / Esc — закрыть.
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { probeMediaDuration, refreshMediaDuration } from '../utils/mediaDuration'

const props = defineProps<{
  src: string
  filename: string
}>()
const emit = defineEmits<{ (e: 'close'): void }>()

const videoEl = ref<HTMLVideoElement | null>(null)
const playing = ref(false)
const current = ref(0)
const duration = ref(0)

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => {
  window.addEventListener('keydown', onKey)
  void start()
})
onUnmounted(() => window.removeEventListener('keydown', onKey))

async function start() {
  const el = videoEl.value
  if (!el) return
  // Определяем длительность (зондирование для webm-записей) и играем.
  await new Promise<void>((resolve) => {
    if (el.readyState >= 1) {
      resolve()
      return
    }
    const onMeta = () => {
      el.removeEventListener('loadedmetadata', onMeta)
      resolve()
    }
    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('error', onMeta, { once: true })
    window.setTimeout(() => {
      el.removeEventListener('loadedmetadata', onMeta)
      resolve()
    }, 5000)
  })
  await probeMediaDuration(el, duration)
  el.play().then(() => (playing.value = true)).catch(() => {})
}

function onMeta() {
  const el = videoEl.value
  if (el) refreshMediaDuration(el, duration)
}

function onTime() {
  const el = videoEl.value
  if (el) current.value = el.currentTime
}

function toggle() {
  const el = videoEl.value
  if (!el) return
  if (playing.value) {
    el.pause()
  } else {
    el.play().then(() => (playing.value = true)).catch(() => {})
  }
}

function seek() {
  const el = videoEl.value
  if (!el || !duration.value) return
  el.currentTime = current.value
}

function fmt(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
</script>

<template>
  <Teleport to="body">
    <div class="vpop" @pointerdown.stop @click="emit('close')">
      <div class="vpop-box" @click.stop>
        <video
          ref="videoEl"
          :src="src"
          preload="auto"
          @click="toggle"
          @loadedmetadata="onMeta"
          @durationchange="onMeta"
          @timeupdate="onTime"
          @play="playing = true"
          @pause="playing = false"
        ></video>
        <div class="vpop-controls">
          <button class="pp" :title="playing ? 'Пауза' : 'Играть'" @click="toggle">
            <svg v-if="playing" class="ico" viewBox="0 0 320 512"><path d="M48 64C21.5 64 0 85.5 0 112L0 400c0 26.5 21.5 48 48 48s48-21.5 48-48l0-288c0-26.5-21.5-48-48-48zm192 0c-26.5 0-48 21.5-48 48l0 288c0 26.5 21.5 48 48 48s48-21.5 48-48l0-288c0-26.5-21.5-48-48-48z" /></svg>
            <svg v-else class="ico" viewBox="0 0 384 512"><path d="M73 39c-14.8-9.3-33.4-9.1-48 .3C9.4 48.5 0 65.4 0 83.5L0 428.5c0 18.1 9.4 35 25 44.2 14.6 9.4 33.2 9.6 48 .3L361 297.6c14.9-9.4 23.9-25.3 23.9-41.6s-9-32.2-23.9-41.6L73 39z" /></svg>
          </button>
          <input
            type="range"
            class="vpop-range"
            min="0"
            :max="duration || 0"
            step="0.05"
            v-model.number="current"
            @input="seek"
          />
          <span class="vpop-time">{{ fmt(current) }} / {{ fmt(duration) }}</span>
        </div>
      </div>
      <div class="vpop-hint">Клик — закрыть</div>
    </div>
  </Teleport>
</template>

<style scoped>
.vpop {
  position: fixed;
  inset: 0;
  z-index: 300;
  pointer-events: auto;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: default;
  animation: vpop-in 0.18s ease-out;
}
@keyframes vpop-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
.vpop-box {
  width: 70vw;
  height: 70vh;
  max-width: 70vw;
  max-height: 70vh;
  background: #000;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 12px 60px rgba(0, 0, 0, 0.7);
  display: flex;
  flex-direction: column;
}
.vpop-box video {
  flex: 1;
  min-height: 0;
  width: 100%;
  object-fit: contain;
  display: block;
  cursor: pointer;
}
.vpop-controls {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: rgba(0, 0, 0, 0.55);
}
.pp {
  width: 34px;
  height: 34px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  flex-shrink: 0;
}
.pp:hover {
  background: rgba(255, 255, 255, 0.3);
}
.pp .ico {
  width: 13px;
  height: 13px;
  fill: #fff;
}
.vpop-range {
  flex: 1;
  min-width: 0;
  accent-color: var(--accent);
  cursor: pointer;
}
.vpop-time {
  color: rgba(255, 255, 255, 0.85);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.vpop-hint {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 999px;
  padding: 6px 14px;
}
</style>
