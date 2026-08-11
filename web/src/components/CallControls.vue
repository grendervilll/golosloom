// Управление звонком: микрофон (с выбором устройства), шумоподавление,
// камера, демонстрация экрана, общий звук.
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useCallStore } from '../stores/calls'
import { useSettingsStore } from '../stores/settings'

const calls = useCallStore()
const settings = useSettingsStore()

const showQuality = ref(false)
const showAudio = ref(false)
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
      <button :class="{ active: calls.micOn }" title="Микрофон" @click="calls.toggleMic()">
        🎤 {{ calls.micOn ? 'Микрофон вкл' : 'Микрофон выкл' }}
      </button>
      <button :class="{ active: calls.camOn }" title="Веб-камера" @click="calls.toggleCam()">
        📷 {{ calls.camOn ? 'Камера вкл' : 'Камера выкл' }}
      </button>
      <button :class="{ active: calls.screenOn }" title="Демонстрация экрана" @click="onScreenClick">
        🖥️ Экран {{ calls.screenOn ? 'вкл' : 'выкл' }}
      </button>
      <div v-if="showQuality" class="popup">
        <p class="popup-title">Качество демонстрации</p>
        <button v-for="q in qualities" :key="q" :class="{ active: settings.screenQuality === q }" @click="settings.setScreenQuality(q); calls.toggleScreen(q); showQuality = false">
          {{ q }}
        </button>
      </div>
      <button :class="{ active: !settings.mutedOthers }" title="Звук от других пользователей" @click="calls.setSpeakersMuted(!settings.mutedOthers)">
        🔇 {{ settings.mutedOthers ? 'Звук выкл' : 'Звук вкл' }}
      </button>
      <button :class="{ active: showAudio }" title="Микрофон и шумоподавление" @click="showAudio = !showAudio">
        🎛️ Аудио
      </button>
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
          <option value="low">Лёгкое (по умолчанию)</option>
          <option value="medium">Среднее</option>
          <option value="high">Сильное</option>
        </select>
      </div>
    </div>
    <button class="danger leave" @click="leave">Завершить звонок</button>
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
.controls button {
  border-radius: 999px;
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 600;
}
.controls button.active {
  background: var(--accent);
}
.controls button.active:hover:not(:disabled) {
  background: var(--accent-hover);
}
.controls .leave {
  background: var(--red);
  padding: 7px 18px;
  font-weight: 700;
}
.controls .leave:hover:not(:disabled) {
  background: #a12829;
}
.popup {
  position: absolute;
  bottom: 100%;
  left: 14px;
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
    flex-direction: column;
    align-items: stretch;
    padding: 8px 10px;
    gap: 8px;
  }
  .left {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }
  .left button {
    width: 100%;
  }
  .controls .leave {
    width: 100%;
  }
  .popup {
    max-height: 60vh;
    overflow-y: auto;
    left: 8px;
    right: 8px;
  }
}
</style>
