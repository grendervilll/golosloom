// Управление звонком: микрофон, камера, демонстрация экрана, громкость, пинок.
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useCallStore } from '../stores/calls'
import { useSettingsStore } from '../stores/settings'
import { useChannelsStore } from '../stores/channels'

const calls = useCallStore()
const settings = useSettingsStore()
const channels = useChannelsStore()

const showVolumes = ref(false)
const showQuality = ref(false)
const inCall = computed(() => calls.connectedCallId > 0)

const participants = computed(() => {
  const call = calls.currentCall
  if (!call) return []
  return channels.members.filter((m) => call.participants.includes(m.user_id))
})

const qualities = ['1080p60', '1080p30', '720p60', '720p30', '480p30']

async function leave() {
  await calls.leave()
}

function punch(userId: number) {
  void calls.punch(userId)
}
</script>

<template>
  <div v-if="inCall" class="controls">
    <div class="left">
      <button :class="{ active: calls.micOn }" :title="calls.micOn ? 'Выключить микрофон' : 'Включить микрофон'" @click="calls.toggleMic()">
        🎤 {{ calls.micOn ? 'Микрофон вкл' : 'Микрофон выкл' }}
      </button>
      <button :class="{ active: calls.camOn }" :title="'Веб-камера'" @click="calls.toggleCam()">
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
      <button @click="showVolumes = !showVolumes">🔊 Громкость</button>
    </div>
    <button class="danger" @click="leave">Завершить звонок</button>

    <div v-if="showVolumes" class="volumes">
      <div v-for="p in participants" :key="p.user_id" class="volume-row">
        <span>{{ p.nick }}</span>
        <input
          type="range"
          min="0"
          max="200"
          :value="settings.volumes[p.user_id] ?? 100"
          @input="settings.setVolume(p.user_id, Number(($event.target as HTMLInputElement).value))"
        />
        <button title="Пнуть" @click="punch(p.user_id)">👊 Пнуть</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.controls {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--bg2);
  border-top: 1px solid var(--border);
  padding: 10px 14px;
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  z-index: 30;
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
  bottom: 60px;
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
.volumes {
  position: absolute;
  bottom: 64px;
  right: 14px;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 40;
  min-width: 280px;
}
.volume-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.volume-row span {
  width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.volume-row input {
  flex: 1;
  padding: 0;
}
</style>
