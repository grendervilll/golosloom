// Управление звонком: микрофон, камера, демонстрация экрана, общий звук.
<script setup lang="ts">
import { ref } from 'vue'
import { useCallStore } from '../stores/calls'
import { useSettingsStore } from '../stores/settings'

const calls = useCallStore()
const settings = useSettingsStore()

const showQuality = ref(false)
const qualities = ['1080p60', '1080p30', '720p60', '720p30', '480p30']

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
      <button :class="{ active: calls.screenOn }" title="Демонстрация экрана" @click="showQuality = !showQuality">
        🖥️ Экран {{ calls.screenOn ? 'вкл' : 'выкл' }}
      </button>
      <div v-if="showQuality" class="quality-menu">
        <button v-for="q in qualities" :key="q" :class="{ active: settings.screenQuality === q }" @click="settings.setScreenQuality(q); calls.toggleScreen(q); showQuality = false">
          {{ q }}
        </button>
      </div>
      <button :class="{ active: !settings.mutedOthers }" title="Звук от других пользователей" @click="settings.setMutedOthers(!settings.mutedOthers)">
        🔇 {{ settings.mutedOthers ? 'Звук выкл' : 'Звук вкл' }}
      </button>
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
button.active {
  border: 1px solid var(--accent);
}
.quality-menu {
  position: absolute;
  bottom: 100%;
  left: 14px;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  z-index: 40;
}
</style>
