// Главное рабочее поле звонка: видео участников и демонстрация экрана.
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useCallStore } from '../stores/calls'
import { useChannelsStore } from '../stores/channels'
import { useAuthStore } from '../stores/auth'
import { RoomEvent, Track } from 'livekit-client'
import { roleIcon } from '../utils/roles'

const calls = useCallStore()
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
const focusedCam = ref<VideoTile | null>(null)
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
      // muted — участник выключил камеру/демонстрацию: пустое окно не показываем.
      if (!pub.isSubscribed || !pub.track || pub.track.isMuted) continue
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
  // Своя демонстрация экрана и своя камера — видно, что видит зритель.
  for (const pub of room.localParticipant.videoTrackPublications.values()) {
    if (!pub.track || pub.track.isMuted) continue
    if (isScreen(pub.track)) {
      const t: VideoTile = {
        identity: room.localParticipant.identity,
        nick: 'Вы',
        kind: 'screen',
        track: pub.track,
      }
      next.push(t)
      scr.push(t)
    } else {
      const t: VideoTile = {
        identity: room.localParticipant.identity + ':cam',
        nick: 'Вы',
        kind: 'camera',
        track: pub.track,
      }
      next.push(t)
    }
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
  room.on(RoomEvent.TrackPublished, () => updateTiles())
  room.on(RoomEvent.TrackMuted, () => updateTiles())
  room.on(RoomEvent.TrackUnmuted, () => updateTiles())
  room.on(RoomEvent.ParticipantDisconnected, () => updateTiles())
  updateTiles()
  // Периодический повторный скан: подхватываем треки, если события были пропущены.
  rescanTimer = window.setInterval(updateTiles, 2500)
}

function chooseScreen(id: string) {
  selectedScreenIdentity.value = id
  focusedScreen.value = screens.value.find((s) => s.identity === id) || null
}

// Полноэкранный режим демонстрации экрана.
// В Tauri браузерный Fullscreen API не работает (WKWebView/WebView2) —
// разворачиваем само окно приложения через Tauri API и включаем режим
// "только сцена" (остальной интерфейс скрывается).
let fsUnlisten: (() => void) | null = null

function setFsMode(fs: boolean) {
  document.documentElement.classList.toggle('golosloom-fs', fs)
}

function tauriWindow(): any {
  return (window as any).__TAURI__?.window?.getCurrentWindow?.() || null
}

function toggleFullscreen() {
  const win = tauriWindow()
  if (win) {
    void win
      .isFullscreen()
      .then((fs: boolean) => win.setFullscreen(!fs))
      .catch(() => {})
    return
  }
  const el = document.querySelector('.screen-main')
  if (document.fullscreenElement) {
    void document.exitFullscreen()
  } else if (el) {
    void el.requestFullscreen?.()
  }
}

let rescanTimer: number | null = null

watch(() => calls.connectedCallId, startWatching, { immediate: true })
watch(() => calls.screenOn, () => setTimeout(updateTiles, 300))

onMounted(() => {
  // Следим за состоянием окна Tauri (выход из полноэкранного режима
  // системными кнопками) и выключаем режим "только сцена".
  const win = tauriWindow()
  if (win) {
    void win
      .isFullscreen()
      .then(setFsMode)
      .catch(() => {})
    win.onResized?.(() => {
      void win
        .isFullscreen()
        .then(setFsMode)
        .catch(() => {})
    }).then((un: () => void) => {
      fsUnlisten = un
    })
  }
})

onBeforeUnmount(() => {
  watching = false
  if (rescanTimer !== null) {
    clearInterval(rescanTimer)
    rescanTimer = null
  }
  fsUnlisten?.()
  setFsMode(false)
})

const cameras = computed(() => tiles.value.filter((t) => t.kind === 'camera'))
const callParticipants = computed(() => calls.currentCall?.participants ?? [])
const stageMembers = computed(() => channels.members.filter((m) => callParticipants.value.includes(m.user_id)))
</script>

<template>
  <div class="stage">
    <div v-if="focusedScreen" class="screen-main">
      <video v-track="focusedScreen" class="screen-video" autoplay playsinline />
      <span class="screen-nick">🖥️ Демонстрация: {{ focusedScreen.nick }}</span>
      <button class="fullscreen-btn" title="На весь экран" @click="toggleFullscreen">⛶</button>
    </div>
    <div v-else-if="focusedCam" class="screen-main">
      <video v-track="focusedCam" class="screen-video cam-full" autoplay playsinline />
      <span class="screen-nick">📷 {{ focusedCam.nick }}</span>
      <button class="fullscreen-btn" title="На весь экран" @click="toggleFullscreen">⛶</button>
      <button class="close-cam-btn" title="Свернуть" @click="focusedCam = null">✕</button>
    </div>
    <div v-else class="screen-empty">
      <p class="muted">Демонстраций экрана нет</p>
    </div>

    <div class="cam-grid">
      <div v-for="t in cameras" :key="t.identity + '-cam'" class="cam-tile frame" @click="focusedCam = t">
        <video v-track="t" class="cam-video" autoplay playsinline />
        <span class="cam-nick">{{ roleIcon(auth.user) }}{{ t.nick }}</span>
      </div>
      <div v-if="cameras.length === 0 && stageMembers.length === 0" class="muted">В звонке пока только вы</div>
      <div v-if="cameras.length === 0 && stageMembers.length > 0" class="muted">Камеры участников выключены</div>
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
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  overflow: auto;
  background: var(--bg);
}
.screen-main {
  flex: 1;
  min-height: 100px;
  position: relative;
  background: #000;
  border-radius: 10px;
  overflow: hidden;
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
.fullscreen-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  background: rgba(0, 0, 0, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.3);
  padding: 4px 10px;
  font-size: 14px;
}
.fullscreen-btn:hover {
  background: rgba(0, 0, 0, 0.9);
}
.screen-empty {
  flex: 1;
  min-height: 100px;
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
  width: 200px;
  height: 130px;
  background: #000;
  overflow: hidden;
  cursor: pointer;
}
.cam-full {
  object-fit: cover;
}
.close-cam-btn {
  position: absolute;
  top: 8px;
  left: 8px;
  background: rgba(0, 0, 0, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.3);
  padding: 4px 10px;
  font-size: 13px;
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
  width: 140px;
  height: 80px;
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

/* Мобильные: камеры и миниатюры — горизонтальные ленты. */
@media (max-width: 900px) {
  .stage {
    padding: 6px;
    gap: 6px;
  }
  .cam-grid {
    flex-wrap: nowrap;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .cam-tile {
    width: 130px;
    height: 86px;
    flex: none;
  }
  .screen-thumbs {
    flex-wrap: nowrap;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .thumb {
    flex: none;
    width: 120px;
    height: 70px;
  }
}
</style>
