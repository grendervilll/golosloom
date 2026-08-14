// Плеер голосового сообщения: вверху рабочей зоны канала, во всю ширину,
// занимает ~5% высоты. Временная шкала с перемоткой, кнопка скорости
// справа от шкалы (0.5х–2х + своё значение, не больше 3х).
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { usePlayerStore } from '../stores/player'
import { useSettingsStore } from '../stores/settings'
import { probeMediaDuration, refreshMediaDuration } from '../utils/mediaDuration'

const player = usePlayerStore()
const settings = useSettingsStore()

const audioEl = ref<HTMLAudioElement | null>(null)
const playing = ref(false)
const current = ref(0)
const duration = ref(0)
const speed = ref(1)
const speedOpen = ref(false)
const customSpeed = ref('')
const speedError = ref('')

const track = computed(() => player.voice)
// URL строится от fileId и зависит от файлового токена: при его обновлении
// src меняется, и длинное воспроизведение не обрывается по истечении 5 минут.
const src = computed(() => {
  settings.api.fileTokenVersion // реактивность на обновление токена
  const t = track.value
  return t ? settings.api.fileUrl(t.fileId) : ''
})

// Смена голосового сообщения — играем сразу. flush:'post' обязателен:
// обработчик бежит ПОСЛЕ отрисовки, и audioEl существует даже для первого
// трека (иначе автозапуск не срабатывает). Следим за fileId, а не за src:
// обновление файлового токена обрабатывает отдельный watcher ниже.
watch(
  () => player.voice?.fileId,
  () => {
    if (!src.value) return
    current.value = 0
    duration.value = 0
    playing.value = false
    void startTrack()
  },
  { flush: 'post' },
)

// Файловый токен обновился: перепривязываем аудио на свежий URL,
// сохраняя позицию и продолжая воспроизведение (длинные голосовые).
watch(
  () => settings.api.fileTokenVersion,
  async () => {
    const el = audioEl.value
    if (!el || !player.voice || !src.value) return
    const wasPlaying = !el.paused
    const pos = el.currentTime
    await nextTick()
    el.load()
    el.playbackRate = speed.value
    if (pos > 0) el.currentTime = pos
    if (wasPlaying) {
      el.play().then(() => (playing.value = true)).catch(() => {})
    }
  },
)

async function startTrack() {
  const el = audioEl.value
  if (!el || !src.value) return
  el.load()
  // После load() скорость сбрасывается — возвращаем выбранную (0.5х–3х).
  el.playbackRate = speed.value
  // Ждём метаданные, чтобы определить длительность (см. probeMediaDuration):
  // у webm из MediaRecorder в Chrome она Infinity, без зондирования шкала
  // и перемотка не работают.
  if (el.readyState < 1) {
    await new Promise<void>((resolve) => {
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
  }
  if (!src.value) return
  await probeMediaDuration(el, duration)
  if (!src.value) return
  el.play().then(() => (playing.value = true)).catch(() => (playing.value = false))
}

function toggle() {
  const el = audioEl.value
  if (!el) return
  if (playing.value) {
    el.pause()
    playing.value = false
  } else {
    el.play().then(() => (playing.value = true)).catch(() => {})
  }
}

function onMeta() {
  const el = audioEl.value
  if (el) refreshMediaDuration(el, duration)
}

function onTime() {
  const el = audioEl.value
  if (el) current.value = el.currentTime
}

function onEnded() {
  // Если длительность так и не определилась (зондирование не удалось) —
  // запоминаем реальный конец файла.
  if (!duration.value && current.value > 0) duration.value = current.value
  playing.value = false
  current.value = 0
}

function seek() {
  const el = audioEl.value
  if (!el || !duration.value) return
  el.currentTime = current.value
}

// Текущее время и длительность в формате м:сс.
function fmt(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

const timeText = computed(() => `${fmt(current.value)} / ${fmt(duration.value)}`)

const PRESETS = [0.5, 1, 1.5, 2]

function setSpeed(v: number) {
  speed.value = v
  const el = audioEl.value
  if (el) el.playbackRate = v
  speedOpen.value = false
  customSpeed.value = ''
  speedError.value = ''
}

function applyCustom() {
  // v-model на input type=number приводит значение к числу — приводим к строке.
  const v = parseFloat(String(customSpeed.value).replace(',', '.'))
  if (isNaN(v)) return
  if (v > 3) {
    speedError.value = 'Нельзя ускорить больше чем в 3 раза'
    return
  }
  if (v <= 0) {
    speedError.value = 'Скорость должна быть больше нуля'
    return
  }
  setSpeed(v)
}
</script>

<template>
  <div v-if="track" class="audio-player" @click.stop>
    <button class="ap-btn play" :title="playing ? 'Пауза' : 'Играть'" @click="toggle">
      <svg v-if="playing" class="ico" viewBox="0 0 320 512"><path d="M48 64C21.5 64 0 85.5 0 112L0 400c0 26.5 21.5 48 48 48s48-21.5 48-48l0-288c0-26.5-21.5-48-48-48zm192 0c-26.5 0-48 21.5-48 48l0 288c0 26.5 21.5 48 48 48s48-21.5 48-48l0-288c0-26.5-21.5-48-48-48z" /></svg>
      <svg v-else class="ico" viewBox="0 0 384 512"><path d="M73 39c-14.8-9.3-33.4-9.1-48 .3C9.4 48.5 0 65.4 0 83.5L0 428.5c0 18.1 9.4 35 25 44.2 14.6 9.4 33.2 9.6 48 .3L361 297.6c14.9-9.4 23.9-25.3 23.9-41.6s-9-32.2-23.9-41.6L73 39z" /></svg>
    </button>
    <span class="ap-title" :title="track.filename">{{ track.filename }}</span>
    <div class="ap-timeline">
      <input
        type="range"
        class="ap-range"
        min="0"
        :max="duration || 0"
        step="0.05"
        v-model.number="current"
        @input="seek"
      />
    </div>
    <span class="ap-time">{{ timeText }}</span>
    <div class="speed-wrap">
      <button class="ap-btn speed-btn" :title="'Скорость воспроизведения: ' + speed + 'х'" @click.stop="speedOpen = !speedOpen">
        {{ speed }}х
      </button>
      <div v-if="speedOpen" class="speed-drop">
        <button v-for="p in PRESETS" :key="p" :class="{ active: speed === p }" @click.stop="setSpeed(p)">
          {{ p }}х
        </button>
        <div class="speed-custom">
          <input
            v-model="customSpeed"
            type="number"
            min="0.1"
            max="3"
            step="0.1"
            placeholder="Своя скорость…"
            @keydown.enter.stop="applyCustom"
          />
          <button class="speed-ok" @click.stop="applyCustom">OK</button>
        </div>
        <p v-if="speedError" class="speed-error">{{ speedError }}</p>
      </div>
    </div>
    <button class="ap-btn close" title="Закрыть плеер" @click.stop="player.stop()">
      <svg class="ico" viewBox="0 0 384 512"><path d="M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z" /></svg>
    </button>
    <audio
      ref="audioEl"
      :src="src"
      preload="auto"
      @loadedmetadata="onMeta"
      @durationchange="onMeta"
      @timeupdate="onTime"
      @ended="onEnded"
      @play="playing = true"
      @pause="playing = false"
    ></audio>
  </div>
</template>

<style scoped>
.audio-player {
  height: 5%;
  min-height: 44px;
  max-height: 64px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.ap-btn {
  width: 34px;
  height: 34px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--bg3);
  flex-shrink: 0;
  color: var(--text);
}
.ap-btn:hover {
  background: var(--bg4);
}
.ap-btn .ico {
  width: 14px;
  height: 14px;
  fill: var(--text);
}
.ap-btn.play {
  background: var(--accent);
}
.ap-btn.play .ico {
  fill: #fff;
}
.ap-title {
  font-size: 13px;
  font-weight: 600;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
}
.ap-timeline {
  flex: 1;
  min-width: 0;
}
.ap-range {
  width: 100%;
  accent-color: var(--accent);
  cursor: pointer;
}
.ap-time {
  font-size: 12px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.speed-wrap {
  position: relative;
  flex-shrink: 0;
}
.speed-btn {
  width: auto;
  min-width: 42px;
  border-radius: 999px;
  padding: 0 10px;
  font-size: 13px;
  font-weight: 700;
}
/* Бутерброд скорости: раскрывается вниз от кнопки. */
.speed-drop {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 170px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  z-index: 130;
  animation: speed-in 0.12s ease-out;
}
@keyframes speed-in {
  from {
    opacity: 0;
    transform: translateY(-4px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.speed-drop button {
  text-align: left;
  background: transparent;
  border-radius: 6px;
  font-size: 13px;
  padding: 7px 10px;
}
.speed-drop button:hover {
  background: var(--bg3);
}
.speed-drop button.active {
  background: var(--accent);
  color: #fff;
}
.speed-custom {
  display: flex;
  gap: 6px;
  padding: 6px 2px 2px;
  border-top: 1px solid var(--border);
  margin-top: 4px;
}
.speed-custom input {
  flex: 1;
  min-width: 0;
  background: var(--bg3);
  border: none;
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 13px;
}
.speed-ok {
  background: var(--accent) !important;
  color: #fff !important;
  font-weight: 700;
  text-align: center !important;
  padding: 6px 12px !important;
}
.speed-error {
  color: var(--red);
  font-size: 12px;
  padding: 4px 10px;
}
.ap-btn.close {
  background: transparent;
}
.ap-btn.close:hover {
  background: var(--bg4);
}

@media (max-width: 900px) {
  .ap-title {
    display: none;
  }
}
</style>
