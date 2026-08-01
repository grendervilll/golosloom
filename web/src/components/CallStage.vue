// Главное рабочее поле звонка: видео участников и демонстрация экрана.
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useCallStore } from '../stores/calls'
import { useSettingsStore } from '../stores/settings'
import { useChannelsStore } from '../stores/channels'
import { useAuthStore } from '../stores/auth'
import { RoomEvent, Track } from 'livekit-client'
import { roleIcon } from '../utils/roles'

const calls = useCallStore()
const settings = useSettingsStore()
const channels = useChannelsStore()
const auth = useAuthStore()

interface VideoTile {
  identity: string
  nick: string
  kind: 'camera' | 'screen'
  track: any
}

const tiles = ref<VideoTile[]>([])
const screens = ref<VideoTile[]>([])
const focusedScreen = ref<VideoTile | null>(null)
const selectedScreenIdentity = ref('')
let watching = false

// Директива: привязывает LiveKit-трек к элементу <video>.
const vTrack = {
  mounted(el: HTMLElement, binding: { value: VideoTile | null }) {
    if (binding.value?.track) binding.value.track.attach(el)
  },
  updated(el: HTMLElement, binding: { value: VideoTile | null }) {
    if (binding.value?.track) {
      el.innerHTML = ''
      binding.value.track.attach(el)
    }
  },
  unmounted(el: HTMLElement, binding: { value: VideoTile | null }) {
    binding.value?.track?.detach(el)
  },
}

function isScreen(track: any): boolean {
  return track.source === Track.Source.ScreenShare
}

function updateTiles() {
  const room = calls.room
  if (!room) return
  const next: VideoTile[] = []
  const scr: VideoTile[] = []
  for (const p of room.remoteParticipants.values()) {
    for (const pub of p.videoTrackPublications.values()) {
      if (!pub.isSubscribed || !pub.track) continue
      const t: VideoTile = {
        identity: p.identity,
        nick: p.name || p.identity,
        kind: isScreen(pub.track) ? 'screen' : 'camera',
        track: pub.track,
      }
      next.push(t)
      if (t.kind === 'screen') scr.push(t)
    }
  }
  // Своя демонстрация экрана.
  for (const pub of room.localParticipant.videoTrackPublications.values()) {
    if (!pub.track || !isScreen(pub.track)) continue
    const t: VideoTile = {
      identity: room.localParticipant.identity,
      nick: 'Вы',
      kind: 'screen',
      track: pub.track,
    }
    next.push(t)
    scr.push(t)
  }
  tiles.value = next
  screens.value = scr
  if (scr.length === 0) {
    focusedScreen.value = null
    selectedScreenIdentity.value = ''
  } else if (!focusedScreen.value || !scr.some((s) => s.identity === focusedScreen.value!.identity)) {
    focusedScreen.value = scr[0]
    selectedScreenIdentity.value = scr[0].identity
  }
}

function startWatching() {
  const room = calls.room
  if (!room || watching) return
  watching = true
  room.on(RoomEvent.TrackSubscribed, () => updateTiles())
  room.on(RoomEvent.TrackUnsubscribed, () => updateTiles())
  room.on(RoomEvent.ParticipantDisconnected, () => updateTiles())
  updateTiles()
}

function chooseScreen(id: string) {
  selectedScreenIdentity.value = id
  focusedScreen.value = screens.value.find((s) => s.identity === id) || null
}

watch(() => calls.connectedCallId, startWatching, { immediate: true })
watch(() => calls.screenOn, () => setTimeout(updateTiles, 300))
onBeforeUnmount(() => {
  watching = false
})

const cameras = computed(() => tiles.value.filter((t) => t.kind === 'camera'))
</script>

<template>
  <div class="stage">
    <div v-if="focusedScreen" class="screen-main">
      <video v-track="focusedScreen" class="screen-video" autoplay playsinline />
      <span class="screen-nick">🖥️ Демонстрация: {{ focusedScreen.nick }}</span>
    </div>
    <div v-else class="screen-empty">
      <p class="muted">Демонстраций экрана нет</p>
    </div>

    <div class="cam-grid">
      <div v-for="t in cameras" :key="t.identity + '-cam'" class="cam-tile frame">
        <video v-track="t" class="cam-video" autoplay playsinline />
        <span class="cam-nick">{{ roleIcon(auth.user) }}{{ t.nick }}</span>
      </div>
      <p v-if="cameras.length === 0" class="muted">Камеры участников выключены</p>
    </div>

    <div v-if="screens.length > 1" class="screen-thumbs">
      <div
        v-for="s in screens"
        :key="s.identity"
        class="thumb frame"
        :class="{ active: s.identity === selectedScreenIdentity }"
        @click="chooseScreen(s.identity)"
      >
        <video v-track="s" class="thumb-video" autoplay playsinline />
        <span class="muted small">{{ s.nick }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stage {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  overflow: auto;
  background: var(--bg);
}
.screen-main {
  position: relative;
  background: #000;
  border-radius: 10px;
  overflow: hidden;
  min-height: 200px;
  height: 60%;
}
.screen-video {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.screen-nick {
  position: absolute;
  left: 10px;
  bottom: 8px;
  background: rgba(0, 0, 0, 0.7);
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 13px;
}
.screen-empty {
  height: 60%;
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--border);
  border-radius: 10px;
}
.cam-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.cam-tile {
  position: relative;
  width: 240px;
  height: 150px;
  background: #000;
  overflow: hidden;
}
.cam-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cam-nick {
  position: absolute;
  left: 6px;
  bottom: 4px;
  background: rgba(0, 0, 0, 0.7);
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 12px;
}
.screen-thumbs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.thumb {
  width: 160px;
  height: 90px;
  background: #000;
  cursor: pointer;
  overflow: hidden;
  position: relative;
}
.thumb.active {
  border-color: var(--accent);
}
.thumb-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.thumb span {
  position: absolute;
  bottom: 2px;
  left: 4px;
  background: rgba(0, 0, 0, 0.7);
  padding: 1px 6px;
  border-radius: 4px;
}
</style>
