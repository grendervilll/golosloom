// Управление звонком: микрофон, камера, демонстрация экрана, звук собеседников,
// настройки, завершение + приглашение. Кнопки — круглые иконки с анимацией переключения.
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useCallStore } from '../stores/calls'
import { useSettingsStore } from '../stores/settings'
import InviteToCallModal from './InviteToCallModal.vue'

const calls = useCallStore()
const settings = useSettingsStore()

const showQuality = ref(false)
const showAudio = ref(false)
const showInvite = ref(false)
const micDevices = ref<MediaDeviceInfo[]>([])
const qualities = ['1080p60', '1080p30', '720p60', '720p30', '480p30']

async function loadMics() {
  try {
    const devs = await navigator.mediaDevices.enumerateDevices()
    micDevices.value = devs.filter((d) => d.kind === 'audioinput')
  } catch {
    micDevices.value = []
  }
}

onMounted(loadMics)

async function onMicChange(e: Event) {
  const id = (e.target as HTMLSelectElement).value
  await calls.setMicDevice(id)
}

async function onNoiseChange(e: Event) {
  settings.setNoiseSuppression((e.target as HTMLSelectElement).value as any)
}

// Кнопка «Экран»: при активной демонстрации выключает её сразу,
// иначе открывает выбор качества.
function onScreenClick() {
  if (calls.screenOn) {
    void calls.stopScreen()
    showQuality.value = false
  } else {
    showQuality.value = !showQuality.value
  }
}

async function leave() {
  await calls.leave()
}
</script>

<template>
  <div class="controls">
    <div class="left">
      <button class="cbtn" :class="{ on: calls.micOn }" title="Микрофон" @click="calls.toggleMic()">
        <svg v-if="calls.micOn" key="mic" class="ico" viewBox="0 0 384 512"><path d="M192 0C139 0 96 43 96 96V256c0 53 43 96 96 96s96-43 96-96V96c0-53-43-96-96-96zM64 216c0-13.3-10.7-24-24-24s-24 10.7-24 24v40c0 89.1 66.2 162.7 152 174.4V464H120c-13.3 0-24 10.7-24 24s10.7 24 24 24h72 72c13.3 0 24-10.7 24-24s-10.7-24-24-24H216V430.4c85.8-11.7 152-85.3 152-174.4V216c0-13.3-10.7-24-24-24s-24 10.7-24 24v40c0 70.7-57.3 128-128 128s-128-57.3-128-128V216z" /></svg>
        <svg v-else key="micoff" class="ico" viewBox="0 0 640 512"><path d="M38.8 5.1C28.4-3.1 13.3-1.2 5.1 9.2S-1.2 34.7 9.2 42.9l592 464c10.4 8.2 25.5 6.3 33.7-4.1s6.3-25.5-4.1-33.7L472.1 344.7c15.2-26 23.9-56.3 23.9-88.7V216c0-13.3-10.7-24-24-24s-24 10.7-24 24v40c0 21.2-5.1 41.1-14.2 58.7L416 300.8V96c0-53-43-96-96-96s-96 43-96 96v54.3L38.8 5.1zM344 430.4c20.4-2.8 39.7-9.1 57.3-18.2l-43.1-33.9C346.1 382 333.3 384 320 384c-70.7 0-128-57.3-128-128v-8.7L144.7 210c-.5 1.9-.7 3.9-.7 6v40c0 89.1 66.2 162.7 152 174.4V464H248c-13.3 0-24 10.7-24 24s10.7 24 24 24h72 72c13.3 0 24-10.7 24-24s-10.7-24-24-24H344V430.4z" /></svg>
      </button>

      <button class="cbtn" :class="{ on: calls.camOn }" title="Веб-камера" @click="calls.toggleCam()">
        <svg v-if="calls.camOn" key="cam" class="ico" viewBox="0 0 512 512"><path d="M149.1 64.8L138.7 96 64 96C28.7 96 0 124.7 0 160L0 416c0 35.3 28.7 64 64 64l384 0c35.3 0 64-28.7 64-64l0-256c0-35.3-28.7-64-64-64l-74.7 0L362.9 64.8C356.4 45.2 338.1 32 317.4 32L194.6 32c-20.7 0-39 13.2-45.5 32.8zM256 192a96 96 0 1 1 0 192 96 96 0 1 1 0-192z" /></svg>
        <svg v-else key="camoff" class="ico" viewBox="0 0 640 512"><path d="M38.8 5.1C28.4-3.1 13.3-1.2 5.1 9.2S-1.2 34.7 9.2 42.9l592 464c10.4 8.2 25.5 6.3 33.7-4.1s6.3-25.5-4.1-33.7l-86.4-67.7 13.8 9.2c9.8 6.5 22.4 7.2 32.9 1.6s16.9-16.4 16.9-28.2l0-256c0-11.8-6.5-22.6-16.9-28.2s-23-5-32.9 1.6l-96 64L448 174.9l0 17.1 0 128 0 5.8-32-25.1L416 128c0-35.3-28.7-64-64-64L113.9 64 38.8 5.1zM407 416.7L32.3 121.5c-.2 2.1-.3 4.3-.3 6.5l0 256c0 35.3 28.7 64 64 64l256 0c23.4 0 43.9-12.6 55-31.3z" /></svg>
      </button>

      <button class="cbtn" :class="{ on: calls.screenOn }" title="Демонстрация экрана" @click="onScreenClick">
        <svg key="screen" class="ico" viewBox="0 0 576 512"><path d="M64 0C28.7 0 0 28.7 0 64L0 352c0 35.3 28.7 64 64 64l176 0-10.7 32L160 448c-17.7 0-32 14.3-32 32s14.3 32 32 32l256 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-69.3 0L336 416l176 0c35.3 0 64-28.7 64-64l0-288c0-35.3-28.7-64-64-64L64 0zM512 64l0 288L64 352 64 64l448 0z" /></svg>
        <div v-if="showQuality" class="popup">
          <p class="popup-title">Качество демонстрации</p>
          <button v-for="q in qualities" :key="q" :class="{ active: settings.screenQuality === q }" @click="settings.setScreenQuality(q); calls.toggleScreen(q); showQuality = false">
            {{ q }}
          </button>
        </div>
      </button>

      <button class="cbtn" :class="{ on: !settings.mutedOthers }" title="Звук собеседников" @click="calls.setSpeakersMuted(!settings.mutedOthers)">
        <svg v-if="!settings.mutedOthers" key="vol" class="ico" viewBox="0 0 448 512"><path d="M301.1 34.8C312.6 40 320 51.4 320 64V448c0 12.6-7.4 24-18.9 29.2s-25 3.1-34.4-5.3L131.8 352H64c-35.3 0-64-28.7-64-64V224c0-35.3 28.7-64 64-64h67.8L266.7 40.1c9.4-8.4 22.9-10.4 34.4-5.3zM412.6 181.5C434.1 199.1 448 225.9 448 256s-13.9 56.9-35.4 74.5c-10.3 8.4-25.4 6.8-33.8-3.5s-6.8-25.4 3.5-33.8C393.1 284.4 400 271 400 256s-6.9-28.4-17.7-37.3c-10.3-8.4-11.8-23.5-3.5-33.8s23.5-11.8 33.8-3.5z" /></svg>
        <svg v-else key="voloff" class="ico" viewBox="0 0 576 512"><path d="M301.1 34.8C312.6 40 320 51.4 320 64V448c0 12.6-7.4 24-18.9 29.2s-25 3.1-34.4-5.3L131.8 352H64c-35.3 0-64-28.7-64-64V224c0-35.3 28.7-64 64-64h67.8L266.7 40.1c9.4-8.4 22.9-10.4 34.4-5.3zM425 167l55 55 55-55c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9l-55 55 55 55c9.4 9.4 9.4 24.6 0 33.9s-24.6 9.4-33.9 0l-55-55-55 55c-9.4 9.4-24.6 9.4-33.9 0s-9.4-24.6 0-33.9l55-55-55-55c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0z" /></svg>
      </button>

      <button class="cbtn" :class="{ on: showAudio }" title="Микрофон и шумоподавление" @click="showAudio = !showAudio">
        <svg key="sliders" class="ico" viewBox="0 0 512 512"><path d="M0 416c0 17.7 14.3 32 32 32l54.7 0c12.3 28.3 40.5 48 73.3 48s61-19.7 73.3-48L480 448c17.7 0 32-14.3 32-32s-14.3-32-32-32l-246.7 0c-12.3-28.3-40.5-48-73.3-48s-61 19.7-73.3 48L32 384c-17.7 0-32 14.3-32 32zm128 0a32 32 0 1 1 64 0 32 32 0 1 1 -64 0zM320 256a32 32 0 1 1 64 0 32 32 0 1 1 -64 0zm32-80c-32.8 0-61 19.7-73.3 48L32 224c-17.7 0-32 14.3-32 32s14.3 32 32 32l246.7 0c12.3 28.3 40.5 48 73.3 48s61-19.7 73.3-48l54.7 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-54.7 0c-12.3-28.3-40.5-48-73.3-48zM192 128a32 32 0 1 1 0-64 32 32 0 1 1 0 64zm73.3-64C253 35.7 224.8 16 192 16s-61 19.7-73.3 48L32 64C14.3 64 0 78.3 0 96s14.3 32 32 32l86.7 0c12.3 28.3 40.5 48 73.3 48s61-19.7 73.3-48L480 128c17.7 0 32-14.3 32-32s-14.3-32-32-32L265.3 64z" /></svg>
        <div v-if="showAudio" class="popup">
          <p class="popup-title">Микрофон</p>
          <select v-if="micDevices.length > 1" @change="onMicChange">
            <option v-for="d in micDevices" :key="d.deviceId" :value="d.deviceId">
              {{ d.label || 'Микрофон ' + d.deviceId.slice(0, 4) }}
            </option>
          </select>
          <p v-else class="muted small">Устройства появятся после выдачи разрешения</p>
          <p class="popup-title">Шумоподавление</p>
          <select :value="settings.noiseSuppression" @change="onNoiseChange">
            <option value="off">Выключено</option>
            <option value="low">Включено</option>
            <option value="high">Сильное (voice isolation)</option>
          </select>
        </div>
      </button>

      <button class="cbtn" title="Пригласить в звонок" @click="showInvite = true">
        <svg class="ico" viewBox="0 0 448 512"><path d="M256 80c0-17.7-14.3-32-32-32s-32 14.3-32 32V224H32c-17.7 0-32 14.3-32 32s14.3 32 32 32H192V448c0 17.7 14.3 32 32 32s32-14.3 32-32V288H416c17.7 0 32-14.3 32-32s-14.3-32-32-32H256V80z" /></svg>
      </button>
    </div>
    <InviteToCallModal v-if="showInvite" @close="showInvite = false" />
    <button class="leave" title="Завершить звонок" @click="leave">
      <svg key="hang" class="ico" viewBox="0 0 640 512"><path d="M228.9 24.6c-7.7-18.6-28-28.5-47.4-23.2l-88 24C76.1 30.2 64 46 64 64c0 107.4 37.8 206 100.8 283.1L9.2 469.1c-10.4 8.2-12.3 23.3-4.1 33.7s23.3 12.3 33.7 4.1l592-464c10.4-8.2 12.3-23.3 4.1-33.7s-23.3-12.3-33.7-4.1L253 278c-17.8-21.5-32.9-45.2-45-70.7L257.3 167c13.7-11.2 18.4-30 11.6-46.3l-40-96zm96.8 319l-91.3 72C310.7 476 407.1 512 512 512c18 0 33.8-12.1 38.6-29.5l24-88c5.3-19.4-4.6-39.7-23.2-47.4l-96-40c-16.3-6.8-35.2-2.1-46.3 11.6L368.7 368c-15-7.1-29.3-15.2-43-24.3z" /></svg>
    </button>
  </div>
</template>

<style scoped>
.controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px;
  background: var(--bg2);
  border-top: 1px solid var(--border);
  flex-wrap: wrap;
  position: relative;
}
.left {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
/* Круглые кнопки-иконки (стиль: микрофон/динамик из примера). */
.cbtn {
  width: 46px;
  height: 46px;
  padding: 0;
  border-radius: 50%;
  background: var(--bg4);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
.cbtn:hover:not(:disabled) {
  background: #43454d;
}
.cbtn .ico {
  width: 20px;
  height: 20px;
  fill: var(--text-dim);
  animation: keyframes-fill 0.5s;
}
.cbtn.on .ico {
  fill: var(--accent);
}
.leave {
  width: 46px;
  height: 46px;
  padding: 0;
  border-radius: 50%;
  background: var(--red);
  display: flex;
  align-items: center;
  justify-content: center;
}
.leave:hover:not(:disabled) {
  background: #a12829;
}
.leave .ico {
  width: 20px;
  height: 20px;
  fill: #fff;
  animation: keyframes-fill 0.5s;
}
/* Анимация «поп» при переключении иконки. */
@keyframes keyframes-fill {
  0% {
    transform: rotate(0deg) scale(0);
    opacity: 0;
  }
  50% {
    transform: rotate(-10deg) scale(1.2);
  }
  100% {
    transform: rotate(0deg) scale(1);
    opacity: 1;
  }
}
.popup {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 40;
  min-width: 220px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}
.popup button {
  text-align: left;
}
.popup button.active {
  border-color: var(--accent);
}
.popup-title {
  font-size: 12px;
  text-transform: uppercase;
  color: var(--text-dim);
  font-weight: 700;
  margin-top: 6px;
}
.popup-title:first-child {
  margin-top: 0;
}

@media (max-width: 900px) {
  .controls {
    padding: 8px 10px;
  }
  .popup {
    max-height: 60vh;
    overflow-y: auto;
    left: 8px;
    right: 8px;
  }
}
</style>
