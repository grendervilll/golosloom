// Пикер смайликов и GIF: поиск сверху, вкладки «Смайлики»/«GIF» внизу.
// Короткое нажатие на GIF — отправка в чат; длинное нажатие — предпросмотр
// по центру экрана (40% окна); после отпускания предпросмотр исчезает,
// гифка НЕ отправляется.
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { searchEmojis } from '../utils/emojis'
import { useSettingsStore } from '../stores/settings'

const emit = defineEmits<{
  (e: 'insert', text: string): void
  (e: 'send-gif', url: string): void
  (e: 'close'): void
}>()

const settings = useSettingsStore()

const tab = ref<'emoji' | 'gif'>('emoji')
const query = ref('')
const emojis = computed(() => searchEmojis(query.value))

const gifs = ref<{ url: string; preview: string; title: string }[]>([])
const gifLoading = ref(false)
const gifError = ref('')

// --- Длинное нажатие на GIF ---
const LONG_PRESS_MS = 400
let pressTimer: number | null = null
let pressed = false
const previewUrl = ref('')

function onGifPointerDown(g: { preview: string }) {
  pressed = true
  pressTimer = window.setTimeout(() => {
    previewUrl.value = g.preview
  }, LONG_PRESS_MS)
}

function onGifPointerUp(g: { url: string }) {
  const wasPreview = previewUrl.value !== ''
  const wasPressed = pressed
  pressed = false
  if (pressTimer !== null) clearTimeout(pressTimer)
  pressTimer = null
  if (wasPreview) {
    // Длительное нажатие: предпросмотр исчезает, гифка не отправляется.
    previewUrl.value = ''
    return
  }
  if (wasPressed) emit('send-gif', g.url)
}

function onGifPointerLeave() {
  pressed = false
  if (pressTimer !== null) clearTimeout(pressTimer)
  pressTimer = null
  previewUrl.value = ''
}

onBeforeUnmount(() => {
  if (pressTimer !== null) clearTimeout(pressTimer)
})

// --- Поиск GIF (дебаунс) ---
let gifTimer: number | null = null

watch(query, () => {
  if (gifTimer !== null) clearTimeout(gifTimer)
  gifTimer = window.setTimeout(fetchGifs, 300)
})

async function fetchGifs() {
  if (!query.value.trim()) {
    gifs.value = []
    return
  }
  gifLoading.value = true
  gifError.value = ''
  try {
    const res = await settings.api.gifSearch(query.value.trim())
    gifs.value = (res?.gifs || []).map((g: any) => ({ url: g.url, preview: g.preview, title: g.title }))
  } catch {
    gifError.value = 'Поиск GIF недоступен на этом сервере'
    gifs.value = []
  } finally {
    gifLoading.value = false
  }
}
</script>

<template>
  <div class="picker" @click.stop>
    <input v-model="query" class="search" placeholder="Поиск смайликов и GIF… (например, run)" />
    <div class="content">
      <div v-if="tab === 'emoji'" class="emoji-grid">
        <button v-for="it in emojis" :key="it.e" class="emoji" :title="it.k" @click="emit('insert', it.e)">
          {{ it.e }}
        </button>
      </div>
      <div v-else class="gif-list">
        <p v-if="gifLoading" class="muted">Поиск…</p>
        <p v-else-if="gifError" class="muted">{{ gifError }}</p>
        <p v-else-if="!query.trim()" class="muted">Введите запрос, например «run»</p>
        <p v-else-if="gifs.length === 0" class="muted">Ничего не найдено</p>
        <div
          v-for="(g, i) in gifs"
          :key="g.url + i"
          class="gif-item"
          :title="g.title"
          @pointerdown="onGifPointerDown(g)"
          @pointerup="onGifPointerUp(g)"
          @pointerleave="onGifPointerLeave"
        >
          <img :src="g.preview" :alt="g.title" loading="lazy" draggable="false" />
        </div>
      </div>
    </div>
    <div class="tabs">
      <button :class="{ active: tab === 'emoji' }" @click="tab = 'emoji'">😊 Смайлики</button>
      <button :class="{ active: tab === 'gif' }" @click="tab = 'gif'">GIF</button>
    </div>
  </div>

  <Teleport to="body">
    <div v-if="previewUrl" class="gif-preview">
      <img :src="previewUrl" alt="предпросмотр GIF" />
    </div>
  </Teleport>
</template>

<style scoped>
.picker {
  position: absolute;
  bottom: 100%;
  right: 0;
  left: auto;
  width: 360px;
  max-width: 92vw;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 12px;
  margin-bottom: 8px;
  display: flex;
  flex-direction: column;
  z-index: 90;
  overflow: hidden;
  /* Плавное появление над кнопкой (правый нижний угол — начало роста). */
  animation: picker-in 0.16s ease-out;
  transform-origin: bottom right;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);
}
@keyframes picker-in {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.search {
  margin: 10px 10px 4px;
  width: calc(100% - 20px);
}
.content {
  height: 280px;
  overflow-y: auto;
  padding: 6px;
}
.emoji-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(38px, 1fr));
  gap: 2px;
}
.emoji {
  background: transparent;
  border: none;
  font-size: 24px;
  padding: 6px;
  border-radius: 8px;
  cursor: pointer;
}
.emoji:hover {
  background: var(--bg3);
}
.gif-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.gif-item {
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  background: var(--bg);
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
.gif-item img {
  display: block;
  width: 100%;
  max-height: 180px;
  object-fit: cover;
}
.gif-item:hover {
  outline: 2px solid var(--accent);
}
.tabs {
  display: flex;
  border-top: 1px solid var(--border);
}
.tabs button {
  flex: 1;
  background: transparent;
  border: none;
  padding: 10px;
  cursor: pointer;
  color: var(--text);
  font-weight: 600;
}
.tabs button.active {
  background: var(--bg3);
}

/* Предпросмотр длинного нажатия: по центру экрана, 40% окна. */
.gif-preview {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.gif-preview img {
  width: 40vw;
  max-width: 40vh;
  border-radius: 14px;
  box-shadow: 0 12px 60px rgba(0, 0, 0, 0.6);
}

/* Мобильные: пикер — нижний лист во всю ширину. */
@media (max-width: 900px) {
  .picker {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    width: 100%;
    max-width: none;
    max-height: 60vh;
    border-radius: 14px 14px 0 0;
    margin-bottom: 0;
  }
  .content {
    height: 46vh;
  }
  .emoji-grid {
    grid-template-columns: repeat(auto-fill, minmax(44px, 1fr));
  }
}
</style>
