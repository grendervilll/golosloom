// Боковая панель — список чатов в стиле мессенджера:
// поиск, аватар + название + время + последнее сообщение + счётчик.
// Меню (админка, настройки, выход) — за кнопкой-бургером.
<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useChannelsStore } from '../stores/channels'
import { useChatStore } from '../stores/chat'
import { useSettingsStore } from '../stores/settings'
import { toast } from 'vue-sonner'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import Avatar from './Avatar.vue'

const emit = defineEmits<{
  (e: 'open-invite'): void
  (e: 'open-call'): void
  (e: 'toggle-chat'): void
  (e: 'logout'): void
  (e: 'open-admin'): void
  (e: 'open-search'): void
  (e: 'open-community'): void
  (e: 'close'): void
}>()

const auth = useAuthStore()
const channels = useChannelsStore()
const chat = useChatStore()
const settings = useSettingsStore()

const menuOpen = ref(false)
const search = ref('')
const avatarInput = ref<HTMLInputElement | null>(null)
// Подменю «Настройки» внутри меню бургера.
const settingsOpen = ref(false)
const serverUrl = ref(settings.serverUrl)
// Какая горячая клавиша сейчас переназначается (null — никакая).
const capturingHotkey = ref<null | 'mic' | 'speakers' | 'cam'>(null)

// Понятное отображение клавиши на кнопке.
function keyLabel(key: string): string {
  if (key === ' ') return 'Пробел'
  if (key.length === 1) return key.toUpperCase()
  const map: Record<string, string> = {
    Escape: 'Esc',
    Enter: 'Enter',
    Tab: 'Tab',
    Backspace: 'Backspace',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
  }
  return map[key] || key
}

function startCapture(action: 'mic' | 'speakers' | 'cam') {
  capturingHotkey.value = action
}

function cancelCapture() {
  capturingHotkey.value = null
}

function onCaptureKey(e: KeyboardEvent) {
  if (!capturingHotkey.value) return
  e.preventDefault()
  e.stopPropagation()
  if (e.key === 'Escape') {
    cancelCapture()
    return
  }
  // Чистые модификаторы игнорируем — ждём основную клавишу.
  if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta') return
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
  settings.setHotkey(capturingHotkey.value, key)
  cancelCapture()
}

function openSettings() {
  settingsOpen.value = true
  serverUrl.value = settings.serverUrl
}
function backToMenu() {
  settingsOpen.value = false
}

async function saveServerUrl() {
  try {
    settings.setServerUrl(serverUrl.value.trim())
    await settings.loadConfig()
    toast.info('Настройки сохранены')
  } catch (e: any) {
    toast.error('Не удалось подключиться к серверу: ' + e.message)
  }
}

const newChannelName = ref('')
const newChannelPrivate = ref(false)
const showCreate = ref(false)
const error = ref('')

const sortedChannels = computed(() => [...channels.channels].sort((a, b) => a.id - b.id))
const filteredChannels = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return sortedChannels.value
  return sortedChannels.value.filter((c) => c.name.toLowerCase().includes(q))
})

// Цвет аватара канала — по хешу id (палитра как в примере макета).
const AVATAR_COLORS = ['#2aabee', '#ec4899', '#ef4444', '#10b981', '#8b5cf6', '#f59e0b', '#14b8a6', '#6366f1']
function avatarColor(id: number): string {
  return AVATAR_COLORS[id % AVATAR_COLORS.length]
}

// Последнее сообщение канала (если история уже загружена).
function lastMessage(channelId: number) {
  const list = chat.messages.get(channelId)
  if (!list || list.length === 0) return null
  return list[list.length - 1]
}
function preview(channelId: number): string {
  const m = lastMessage(channelId)
  if (!m) return ''
  if (m.encrypted) return '🔒 Сообщение'
  if (m.deleted) return '🗑 Сообщение удалено'
  const text = m.text
  const prefix = m.senderId === auth.user?.id ? 'Вы: ' : ''
  return prefix + text
}
function lastTime(channelId: number): string {
  const m = lastMessage(channelId)
  if (!m) return ''
  const d = new Date(m.createdAt)
  const now = new Date()
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (sameDay(d, now)) {
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  }
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(d, yesterday)) return 'Вчера'
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
  const s = d.toLocaleDateString('ru-RU', opts)
  return s.charAt(0).toUpperCase() + s.slice(1)
}

async function select(id: number) {
  await channels.enterChannel(id)
}

async function createChannel() {
  error.value = ''
  if (!newChannelName.value.trim()) {
    error.value = 'Введите название канала'
    return
  }
  try {
    const ch = await channels.createChannel(newChannelName.value.trim(), newChannelPrivate.value)
    newChannelName.value = ''
    showCreate.value = false
    await select(ch.id)
  } catch (e: any) {
    error.value = e.message
  }
}

async function acceptInvite(id: number) {
  try {
    await channels.acceptInvite(id)
  } catch (e: any) {
    toast.error(e.message)
  }
}
async function declineInvite(id: number) {
  await channels.declineInvite(id)
}

// --- Закрепление чатов и контекстное меню канала ---
const rowMenu = ref<{ x: number; y: number; id: number } | null>(null)
const rowMenuEl = ref<HTMLElement | null>(null)
// Индекс перетаскиваемого закреплённого чата.
const dragFrom = ref(-1)

function openRowMenu(e: MouseEvent, id: number) {
  e.preventDefault()
  rowMenu.value = { x: e.clientX, y: e.clientY, id }
  void nextTick(() => {
    const el = rowMenuEl.value
    if (!el) return
    const r = el.getBoundingClientRect()
    const pad = 8
    rowMenu.value = {
      ...rowMenu.value!,
      x: Math.max(pad, Math.min(rowMenu.value!.x, window.innerWidth - r.width - pad)),
      y: Math.max(pad, Math.min(rowMenu.value!.y, window.innerHeight - r.height - pad)),
    }
  })
}

function togglePin(id: number) {
  if (channels.pinned.includes(id)) channels.unpinChannel(id)
  else channels.pinChannel(id)
  rowMenu.value = null
}

function rowChannel(id: number) {
  return channels.channels.find((c) => c.id === id)
}

async function unsubscribeRow(id: number) {
  rowMenu.value = null
  const c = rowChannel(id)
  if (!confirm(`Отписаться от сообщества «${c?.name || ''}»?`)) return
  try {
    await channels.unsubscribeCommunity(id)
    toast.info('Вы отписались от сообщества')
  } catch (e: any) {
    toast.error(String(e?.message || e).slice(0, 120))
  }
}

// Число подписчиков: точно до 1 млн, дальше 1.1М, 1.2М…
function subs(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000
    return (m >= 10 ? Math.round(m) : Math.round(m * 10) / 10) + 'М'
  }
  return String(n)
}
function subsLabel(n: number): string {
  const s = subs(n)
  if (n >= 1_000_000) return s + ' подписчиков'
  const last = n % 10
  const last2 = n % 100
  if (last === 1 && last2 !== 11) return s + ' подписчик'
  if (last >= 2 && last <= 4 && (last2 < 12 || last2 > 14)) return s + ' подписчика'
  return s + ' подписчиков'
}

// Смена/удаление своего аватара (ограничение сервера — 5 МБ).
function changeAvatarClick() {
  avatarInput.value?.click()
}

async function changeAvatar(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (file.size > 5 * 1024 * 1024) {
    toast.error('Аватар слишком большой: максимум 5 МБ')
    return
  }
  try {
    await useSettingsStore().api.uploadAvatar(file)
    const me = await useSettingsStore().api.me()
    auth.user = { ...auth.user!, ...me }
    toast.info('Аватар обновлён')
  } catch (err: any) {
    toast.error(String(err?.message || err).slice(0, 150))
  } finally {
    ;(e.target as HTMLInputElement).value = ''
  }
}
async function removeAvatar() {
  try {
    await useSettingsStore().api.deleteAvatar()
    const me = await useSettingsStore().api.me()
    auth.user = { ...auth.user!, ...me }
    toast.info('Аватар удалён')
  } catch (err: any) {
    toast.error(String(err?.message || err).slice(0, 150))
  }
}
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-header">
      <button class="burger" title="Меню" @click="menuOpen = !menuOpen">
        <svg class="ico" viewBox="0 0 448 512"><path d="M0 96C0 78.3 14.3 64 32 64l384 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L32 128C14.3 128 0 113.7 0 96zM0 256c0-17.7 14.3-32 32-32l384 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L32 288c-17.7 0-32-14.3-32-32zM448 416c0 17.7-14.3 32-32 32L32 448c-17.7 0-32-14.3-32-32s14.3-32 32-32l384 0c17.7 0 32 14.3 32 32z" /></svg>
      </button>
      <div class="search-bar">
        <svg class="search-ico" viewBox="0 0 512 512"><path d="M416 208c0 45.9-14.9 88.3-40 122.7L502.6 457.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L330.7 376c-34.4 25.2-76.8 40-122.7 40C93.1 416 0 322.9 0 208S93.1 0 208 0S416 93.1 416 208zM208 352a144 144 0 1 0 0-288 144 144 0 1 0 0 288z" /></svg>
        <input v-model="search" placeholder="Поиск" />
      </div>
      <button class="icon-btn add-btn" title="Создать канал" @click="showCreate = true">
        <svg class="ico" viewBox="0 0 448 512"><path d="M256 80c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 144L48 224c-17.7 0-32 14.3-32 32s14.3 32 32 32l144 0 0 144c0 17.7 14.3 32 32 32s32-14.3 32-32l0-144 144 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-144 0 0-144z" /></svg>
      </button>
      <button class="sidebar-close" title="Закрыть" @click="emit('close')">
        <svg class="ico" viewBox="0 0 384 512"><path d="M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z" /></svg>
      </button>
    </div>

    <div v-if="menuOpen" class="server-menu">
      <!-- Общий скрытый input для смены аватара: должен существовать в обоих
           подменю, поэтому вне v-if-веток. -->
      <input ref="avatarInput" type="file" accept="image/*" class="hidden-input" @change="changeAvatar" />
      <!-- Основное меню. -->
      <template v-if="!settingsOpen">
        <div class="menu-user">
          <!-- Аватар без кнопки: смена аватара — только в «Настройках». -->
          <Avatar :user-id="auth.user?.id || 0" :nick="auth.user?.nick || '?'" :avatar="auth.user?.avatar" :size="38" />
          <div class="user-info">
            <b>{{ auth.user?.nick }}</b>
            <span class="muted">ID: {{ auth.user?.id }}</span>
          </div>
        </div>
        <div class="menu-divider"></div>
        <button v-if="auth.isServerAdmin" @click="emit('open-admin')">
          <svg class="ico" viewBox="0 0 512 512"><path d="M256 0c4.6 0 9.2 1 13.4 2.9L457.7 82.8c22 9.3 38.4 31 38.3 57.2c-.5 99.2-41.3 280.7-213.6 363.2c-16.7 8-36.1 8-52.8 0C57.3 420.7 16.5 239.2 16 140c-.1-26.2 16.3-47.9 38.3-57.2L242.7 2.9C246.8 1 251.4 0 256 0zm0 66.8l0 378.1C394 378 431.1 230.1 432 141.4L256 66.8s0 0 0 0z" /></svg>
          Админ панель сервера
        </button>
        <button @click="emit('open-search')">
          <svg class="ico" viewBox="0 0 512 512"><path d="M416 208c0 45.9-14.9 88.3-40 122.7L502.6 457.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L330.7 376c-34.4 25.2-76.8 40-122.7 40C93.1 416 0 322.9 0 208S93.1 0 208 0S416 93.1 416 208zM208 352a144 144 0 1 0 0-288 144 144 0 1 0 0 288z" /></svg>
          Найти контакт
          <span class="chevron-right">›</span>
        </button>
        <button @click="emit('open-community')">
          <svg class="ico" viewBox="0 0 640 512"><path d="M72 88a56 56 0 1 1 112 0A56 56 0 1 1 72 88zM64 245.7C54 256.9 48 271.8 48 288s6 31.1 16 42.3V416c0 35.3 28.7 64 64 64h64c35.3 0 64-28.7 64-64v-85.7c10-11.1 16-26.1 16-42.3s-6-31.1-16-42.3V176c0-35.3-28.7-64-64-64H128c-35.3 0-64 28.7-64 64v69.7zM352 32c64 0 116 52 116 116v104c0 6.4 5.2 11.6 11.6 11.6H528c8.8 0 16 7.2 16 16v48c0 8.8-7.2 16-16 16h-48.4c-6.4 0-11.6 5.2-11.6 11.6V496c0 8.8-7.2 16-16 16h-48c-8.8 0-16-7.2-16-16V356c0-6.4-5.2-11.6-11.6-11.6H368c-6.4 0-11.6-5.2-11.6-11.6V288c0-8.8 7.2-16 16-16h48.4c6.4 0 11.6-5.2 11.6-11.6V148c0-20.4-16.5-36.9-36.9-36.9c-3.4 0-6.9.5-10.2 1.4V52.8C407.7 34.5 386 32 367.3 32H352z" /></svg>
          Создать сообщество
          <span class="chevron-right">›</span>
        </button>
        <button @click="openSettings">
          <svg class="ico" viewBox="0 0 512 512"><path d="M495.9 166.6c3.2 8.7 .5 18.4-6.4 24.6l-43.3 39.4c1.1 8.3 1.7 16.8 1.7 25.4s-.6 17.1-1.7 25.4l43.3 39.4c6.9 6.2 9.6 15.9 6.4 24.6c-4.4 11.9-9.7 23.3-15.8 34.3l-4.7 8.1c-6.6 11-14 21.4-22.1 31.2c-5.9 7.2-15.7 9.6-24.5 6.8l-55.7-17.7c-13.4 10.3-28.2 18.9-44 25.4l-12.5 57.1c-2 9.1-9.3 15.9-18.6 15.9l-84.1 0c-9.3 0-16.6-6.8-18.6-15.9l-12.5-57.1c-15.8-6.6-30.6-15.2-44-25.4l-55.7 17.7c-8.8 2.8-18.6.4-24.5-6.8c-8.1-9.8-15.5-20.2-22.1-31.2l-4.7-8.1c-6.1-11-11.4-22.4-15.8-34.3c-3.2-8.7-.5-18.4 6.4-24.6l43.3-39.4C92.6 273.1 92 264.6 92 256s.6-17.1 1.7-25.4l-43.3-39.4c-6.9-6.2-9.6-15.9-6.4-24.6c4.4-11.9 9.7-23.3 15.8-34.3l4.7-8.1c6.6-11 14-21.4 22.1-31.2c5.9-7.2 15.7-9.6 24.5-6.8l55.7-17.7c13.4-10.3 28.2-18.9 44-25.4l12.5-57.1c2-9.1 9.3-15.9 18.6-15.9l84.1 0c9.3 0 16.6 6.8 18.6 15.9l12.5 57.1c15.8 6.6 30.6 15.2 44 25.4l55.7-17.7c8.8-2.8 18.6-.4 24.5 6.8c8.1 9.8 15.5 20.2 22.1 31.2l4.7 8.1c6.1 11 11.4 22.4 15.8 34.3zM256 336a80 80 0 1 0 0-160 80 80 0 1 0 0 160z" /></svg>
          Настройки
          <span class="chevron-right">›</span>
        </button>
        <button class="danger" @click="emit('logout')">
          <svg class="ico" viewBox="0 0 512 512"><path d="M377.9 105.9L500.7 228.7c7.2 7.2 11.3 17.1 11.3 27.3s-4.1 20.1-11.3 27.3L377.9 406.1c-6.4 6.4-15 9.9-24 9.9c-18.7 0-33.9-15.2-33.9-33.9l0-62.1-128 0c-17.7 0-32-14.3-32-32l0-64c0-17.7 14.3-32 32-32l128 0 0-62.1c0-18.7 15.2-33.9 33.9-33.9c9 0 17.6 3.6 24 9.9zM160 96L96 96c-17.7 0-32 14.3-32 32l0 256c0 17.7 14.3 32 32 32l64 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-64 0c-53 0-96-43-96-96L0 128C0 75 43 32 96 32l64 0c17.7 0 32 14.3 32 32s-14.3 32-32 32z" /></svg>
          Выйти
        </button>
      </template>

      <!-- Подменю «Настройки». -->
      <template v-else>
        <button class="back-btn" @click="backToMenu">
          <span class="back-arrow">‹</span> Назад
        </button>
        <div class="menu-divider"></div>

        <p class="submenu-title">Общие</p>
        <div class="submenu-block">
          <div class="avatar-row">
            <Avatar :user-id="auth.user?.id || 0" :nick="auth.user?.nick || '?'" :avatar="auth.user?.avatar" :size="38" />
            <button class="tiny" @click="changeAvatarClick">Сменить аватар</button>
            <button v-if="auth.user?.avatar" class="tiny danger" @click="removeAvatar()">Удалить</button>
          </div>
          <div class="theme-row">
            <button :class="{ active: settings.theme === 'light' }" @click="settings.setTheme('light')">☀️ Светлая</button>
            <button :class="{ active: settings.theme === 'dark' }" @click="settings.setTheme('dark')">🌙 Тёмная</button>
          </div>
        </div>

        <p class="submenu-title">Сервер</p>
        <div class="submenu-block">
          <input v-model="serverUrl" placeholder="https://ваш-домен.example" />
          <p class="hint-text">Можно сменить при переезде на другой VPS</p>
          <button class="primary" @click="saveServerUrl">Сохранить</button>
        </div>

        <p class="submenu-title">Клавиши</p>
        <div class="submenu-block">
          <div class="hotkey-row">
            <label>Микрофон</label>
            <button
              class="hotkey-btn"
              :class="{ active: capturingHotkey === 'mic' }"
              title="Нажмите, чтобы переназначить клавишу"
              @click="startCapture('mic')"
              @keydown="onCaptureKey"
              @blur="cancelCapture"
            >
              {{ capturingHotkey === 'mic' ? 'Нажмите клавишу…' : keyLabel(settings.hotkeys.mic) }}
            </button>
          </div>
          <div class="hotkey-row">
            <label>Звук собеседников</label>
            <button
              class="hotkey-btn"
              :class="{ active: capturingHotkey === 'speakers' }"
              title="Нажмите, чтобы переназначить клавишу"
              @click="startCapture('speakers')"
              @keydown="onCaptureKey"
              @blur="cancelCapture"
            >
              {{ capturingHotkey === 'speakers' ? 'Нажмите клавишу…' : keyLabel(settings.hotkeys.speakers) }}
            </button>
          </div>
          <div class="hotkey-row">
            <label>Веб-камера</label>
            <button
              class="hotkey-btn"
              :class="{ active: capturingHotkey === 'cam' }"
              title="Нажмите, чтобы переназначить клавишу"
              @click="startCapture('cam')"
              @keydown="onCaptureKey"
              @blur="cancelCapture"
            >
              {{ capturingHotkey === 'cam' ? 'Нажмите клавишу…' : keyLabel(settings.hotkeys.cam) }}
            </button>
          </div>
          <p class="hint-text">Действуют во время звонка</p>
        </div>
      </template>
    </div>

    <div class="chat-list">
      <!-- При поиске — отфильтрованный список без группировки. -->
      <template v-if="search.trim()">
        <div
          v-for="ch in filteredChannels"
          :key="ch.id"
          class="chat-row"
          :class="{ active: ch.id === channels.currentId }"
          @click="select(ch.id)"
          @contextmenu.prevent="openRowMenu($event, ch.id)"
        >
          <Avatar
            class="chat-avatar"
            :user-id="ch.id"
            :nick="ch.name"
            :avatar="null"
            :size="48"
            :color="avatarColor(ch.id)"
          />
          <div class="row-details">
            <div class="row-top">
              <span class="chat-name">
                <span v-if="ch.kind === 'community'" class="kind-ico" title="Сообщество">📣</span>
                <span v-else-if="ch.kind === 'dm'" class="kind-ico" title="Личный чат">💬</span>
                {{ ch.name }}
              </span>
              <span class="chat-time">{{ lastTime(ch.id) }}</span>
            </div>
            <div class="row-bottom">
              <span class="chat-preview" :class="{ muted: !preview(ch.id) }">
                <span v-if="chat.draftOf(ch.id)" class="draft-preview" title="Черновик: {{ chat.draftOf(ch.id) }}">✏️ {{ chat.draftOf(ch.id) }}</span>
                <template v-else-if="ch.kind === 'community'"><span class="subs-count">{{ subsLabel(ch.member_count || 0) }}</span></template>
                <template v-else>{{ preview(ch.id) || '…' }}</template>
              </span>
              <span v-if="chat.unreadCount(ch.id)" class="badge">{{ chat.unreadCount(ch.id) }}</span>
            </div>
          </div>
        </div>
        <p v-if="filteredChannels.length === 0" class="muted empty">Ничего не найдено</p>
      </template>

      <template v-else>
      <!-- Закреплённые чаты: перетаскиванием меняется порядок. -->
      <template v-if="channels.pinnedChannels.length">
        <p class="section-title">Закреплённые</p>
        <div
          v-for="(ch, idx) in channels.pinnedChannels"
          :key="ch.id"
          class="chat-row pinned-row"
          :class="{ active: ch.id === channels.currentId }"
          draggable="true"
          @dragstart="dragFrom = idx"
          @dragover.prevent
          @drop="channels.movePinned(dragFrom, idx)"
          @click="select(ch.id)"
          @contextmenu.prevent="openRowMenu($event, ch.id)"
        >
          <Avatar
            class="chat-avatar"
            :user-id="ch.id"
            :nick="ch.name"
            :avatar="null"
            :size="48"
            :color="avatarColor(ch.id)"
          />
          <div class="row-details">
            <div class="row-top">
              <span class="chat-name">
                <span v-if="ch.kind === 'community'" class="kind-ico" title="Сообщество">📣</span>
                <span v-else-if="ch.kind === 'dm'" class="kind-ico" title="Личный чат">💬</span>
                <svg v-if="ch.private && ch.kind !== 'dm'" class="lock-ico" viewBox="0 0 448 512"><path d="M144 144v48H304V144c0-44.2-35.8-80-80-80s-80 35.8-80 80zM80 192V144C80 64.5 144.5 0 224 0s144 64.5 144 144v48h16c35.3 0 64 28.7 64 64V448c0 35.3-28.7 64-64 64H64c-35.3 0-64-28.7-64-64V256c0-35.3 28.7-64 64-64H80z" /></svg>
                {{ ch.name }}
              </span>
              <span class="chat-time">{{ lastTime(ch.id) }}</span>
            </div>
            <div class="row-bottom">
              <span class="chat-preview" :class="{ muted: !preview(ch.id) }">
                <span v-if="chat.draftOf(ch.id)" class="draft-preview" title="Черновик: {{ chat.draftOf(ch.id) }}">✏️ {{ chat.draftOf(ch.id) }}</span>
                <template v-else-if="ch.kind === 'community'"><span class="subs-count">{{ subsLabel(ch.member_count || 0) }}</span></template>
                <template v-else>{{ preview(ch.id) || '…' }}</template>
              </span>
              <span v-if="chat.unreadCount(ch.id)" class="badge">{{ chat.unreadCount(ch.id) }}</span>
            </div>
          </div>
        </div>
      </template>

      <div
        v-for="ch in channels.unpinnedChannels"
        :key="ch.id"
        class="chat-row"
        :class="{ active: ch.id === channels.currentId }"
        @click="select(ch.id)"
        @contextmenu.prevent="openRowMenu($event, ch.id)"
      >
        <Avatar
          class="chat-avatar"
          :user-id="ch.id"
          :nick="ch.name"
          :avatar="null"
          :size="48"
          :color="avatarColor(ch.id)"
        />
        <div class="row-details">
          <div class="row-top">
            <span class="chat-name">
              <span v-if="ch.kind === 'community'" class="kind-ico" title="Сообщество">📣</span>
              <span v-else-if="ch.kind === 'dm'" class="kind-ico" title="Личный чат">💬</span>
              <svg v-if="ch.private && ch.kind !== 'dm'" class="lock-ico" viewBox="0 0 448 512"><path d="M144 144v48H304V144c0-44.2-35.8-80-80-80s-80 35.8-80 80zM80 192V144C80 64.5 144.5 0 224 0s144 64.5 144 144v48h16c35.3 0 64 28.7 64 64V448c0 35.3-28.7 64-64 64H64c-35.3 0-64-28.7-64-64V256c0-35.3 28.7-64 64-64H80z" /></svg>
              {{ ch.name }}
            </span>
            <span class="chat-time">{{ lastTime(ch.id) }}</span>
          </div>
          <div class="row-bottom">
            <span class="chat-preview" :class="{ muted: !preview(ch.id) }">
              <span v-if="chat.draftOf(ch.id)" class="draft-preview" title="Черновик: {{ chat.draftOf(ch.id) }}">✏️ {{ chat.draftOf(ch.id) }}</span>
              <template v-else-if="ch.kind === 'community'"><span class="subs-count">{{ subsLabel(ch.member_count || 0) }}</span></template>
              <template v-else>{{ preview(ch.id) || '…' }}</template>
            </span>
            <span v-if="chat.unreadCount(ch.id)" class="badge">{{ chat.unreadCount(ch.id) }}</span>
          </div>
        </div>
      </div>
      <p v-if="channels.channels.length === 0" class="muted empty">Чатов пока нет</p>
      </template>

      <!-- Контекстное меню канала: закрепить/открепить, отписка. -->
      <Teleport to="body">
        <div
          v-if="rowMenu"
          ref="rowMenuEl"
          class="row-ctx"
          :style="{ left: rowMenu.x + 'px', top: rowMenu.y + 'px' }"
          @pointerdown.stop
          @click.stop
        >
          <button @click="togglePin(rowMenu.id)">
            {{ channels.pinned.includes(rowMenu.id) ? 'Открепить' : 'Закрепить' }}
          </button>
          <button v-if="rowChannel(rowMenu.id)?.kind === 'community'" class="danger" @click="unsubscribeRow(rowMenu.id)">
            Отписаться от сообщества
          </button>
        </div>
      </Teleport>
    </div>

    <div v-if="channels.invites.length" class="invites">
      <p class="section-title">Приглашения</p>
      <div v-for="inv in channels.invites" :key="inv.id" class="invite-card frame">
        <p>{{ inv.channel_name }}</p>
        <p class="muted">от {{ inv.invited_by_nick }}</p>
        <div class="row">
          <button class="success" @click="acceptInvite(inv.id)">Принять</button>
          <button @click="declineInvite(inv.id)">Отклонить</button>
        </div>
      </div>
    </div>

    <Dialog :open="showCreate" @update:open="(o) => { if (!o) showCreate = false }">
      <DialogContent class="max-w-[420px]">
        <DialogHeader class="text-center">
          <DialogTitle class="text-center">Создать канал</DialogTitle>
        </DialogHeader>
        <div class="field modal-field">
          <label>Название</label>
          <input v-model="newChannelName" placeholder="Название канала" />
        </div>
        <label class="check create-check"><input v-model="newChannelPrivate" type="checkbox" /> Приватный канал</label>
        <div v-if="error" class="error-text">{{ error }}</div>
        <DialogFooter class="grid-cols-2">
          <Button variant="secondary" @click="showCreate = false">Отмена</Button>
          <Button @click="createChannel">Создать</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </aside>
</template>

<style scoped>
.sidebar {
  width: clamp(280px, 22vw, 340px);
  min-width: 0;
  background: var(--bg);
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
}
.sidebar-header {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 60px;
  padding: 0 12px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.burger {
  width: 40px;
  height: 40px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: transparent;
  flex-shrink: 0;
}
.burger:hover {
  background: var(--bg3);
}
.burger .ico {
  width: 18px;
  height: 18px;
  fill: var(--text-dim);
}
.search-bar {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg3);
  border-radius: 18px;
  height: 36px;
  padding: 0 12px;
  min-width: 0;
}
.search-bar input {
  background: transparent;
  border: none;
  padding: 0;
  font-size: 14px;
  color: var(--text);
}
.search-bar input::placeholder {
  color: #999999;
}
.search-ico {
  width: 15px;
  height: 15px;
  fill: #999999;
  flex-shrink: 0;
}
.icon-btn {
  width: 36px;
  height: 36px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: transparent;
  flex-shrink: 0;
}
.icon-btn:hover {
  background: var(--bg3);
}
.icon-btn .ico {
  width: 16px;
  height: 16px;
  fill: var(--text-dim);
}
.add-btn {
  background: var(--accent);
}
.add-btn:hover {
  background: var(--accent-hover);
}
.add-btn .ico {
  fill: #fff;
}

.server-menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}
.server-menu button {
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  background: transparent;
  border-radius: 8px;
  padding: 9px 12px;
  font-size: 14px;
  width: 100%;
}
.server-menu button:hover {
  background: var(--bg3);
}
.server-menu button .ico {
  width: 16px;
  height: 16px;
  fill: var(--text-dim);
}
.server-menu button.danger {
  color: var(--red);
}
.server-menu button.danger .ico {
  fill: var(--red);
}
.chevron-right {
  margin-left: auto;
  color: var(--text-dim);
  font-size: 18px;
  line-height: 1;
}
.back-btn {
  font-weight: 600;
  color: var(--accent);
}
.back-arrow {
  font-size: 20px;
  line-height: 1;
  margin-top: -2px;
}
.submenu-title {
  font-size: 11px;
  text-transform: uppercase;
  color: var(--text-dim);
  font-weight: 700;
  padding: 8px 12px 4px;
  margin-top: 4px;
}
.submenu-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 12px 10px;
}
.submenu-block label {
  font-size: 12px;
  color: var(--text-dim);
  font-weight: 600;
  margin-top: 4px;
}
.avatar-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.avatar-row .tiny {
  padding: 5px 10px;
  font-size: 12px;
  width: auto;
  min-height: 0;
}
.theme-row {
  display: flex;
  gap: 8px;
}
.theme-row button {
  flex: 1;
  justify-content: center;
  background: var(--bg3);
  border-radius: 8px;
  padding: 8px;
}
.theme-row button.active {
  background: var(--accent);
  color: #fff;
}

/* Строки переназначения горячих клавиш в настройках. */
.hotkey-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.hotkey-row label {
  margin-top: 0;
}
.hotkey-btn {
  width: auto !important;
  min-width: 110px;
  justify-content: center;
  background: var(--bg3);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
}
.hotkey-btn.active {
  background: var(--accent);
  color: #fff;
}

.chat-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding: 6px;
  gap: 2px;
}
.chat-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  cursor: pointer;
  width: 100%;
}
.chat-row:hover {
  background: var(--bg3);
}
.chat-row.active {
  background: var(--accent);
}
.chat-row.active .chat-name,
.chat-row.active .chat-time,
.chat-row.active .chat-preview {
  color: #fff;
}
.chat-avatar {
  flex-shrink: 0;
}
.row-details {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.row-top,
.row-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
}
.chat-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}
.lock-ico {
  width: 11px;
  height: 11px;
  fill: var(--text-dim);
  flex-shrink: 0;
}
.chat-time {
  font-size: 12px;
  color: #999999;
  flex-shrink: 0;
}
.chat-preview {
  font-size: 13px;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}
.chat-preview.muted {
  color: #c0c4c8;
}
.badge {
  background: var(--accent);
  color: #fff;
  border-radius: 100px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
  min-width: 22px;
  text-align: center;
}
.empty {
  padding: 16px;
  text-align: center;
}
/* Иконки вида чата и счётчик подписчиков сообщества. */
.kind-ico {
  font-size: 13px;
  flex-shrink: 0;
}
.subs-count {
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
}
.chat-row.active .subs-count {
  color: #fff;
}
/* Индикатор черновика под названием чата. */
.draft-preview {
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chat-row.active .draft-preview {
  color: #fff;
}
/* Контекстное меню канала (закрепить/открепить, отписка). */
.row-ctx {
  position: fixed;
  z-index: 400;
  pointer-events: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 200px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
}
.row-ctx button {
  text-align: left;
  background: transparent;
  border-radius: 6px;
  font-size: 13px;
  padding: 8px 10px;
}
.row-ctx button:hover {
  background: var(--bg3);
}
.row-ctx button.danger {
  color: var(--red);
}
/* Строка закреплённого чата перетаскивается. */
.chat-row[draggable="true"] {
  cursor: grab;
}
.chat-row[draggable="true"]:active {
  cursor: grabbing;
}

.invites {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid var(--border);
}
.section-title {
  font-size: 12px;
  text-transform: uppercase;
  color: var(--text-dim);
  font-weight: 700;
}
.invite-card {
  padding: 10px;
  background: var(--bg2);
  font-size: 13px;
}
.row {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
/* Пользователь в меню бургера: отдельно от остальных кнопок. */
.menu-user {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
}
.menu-user .user-info {
  flex: 1;
  min-width: 0;
}
.menu-divider {
  height: 1px;
  background: var(--border);
  margin: 2px 12px 8px;
}
.user-info {
  display: flex;
  flex-direction: column;
  font-size: 13px;
  min-width: 0;
}
.user-info b {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hidden-input {
  display: none;
}
.check {
  display: flex;
  gap: 8px;
  align-items: center;
  color: var(--text-dim);
  font-size: 14px;
}

/* Поле названия и чекбокс — по центру с одинаковыми отступами по бокам. */
.create-check {
  justify-content: center;
  margin: 0 auto;
  width: min(100%, 300px);
}

.sidebar-close {
  display: none;
}

/* Мобильные: сайдбар — выезжающая шторка слева (скрыта, пока не открыта). */
@media (max-width: 900px) {
  .sidebar {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    width: min(85vw, 340px);
    z-index: 95;
    transform: translateX(-105%);
    transition: transform 0.25s ease;
    border-right: 1px solid var(--border);
    border-bottom: none;
    box-shadow: 8px 0 30px rgba(0, 0, 0, 0.3);
  }
  .sidebar.drawer-open {
    transform: translateX(0);
  }
  .sidebar-header {
    padding: 8px 10px;
  }
  .sidebar-close {
    display: block;
    background: transparent;
    color: var(--text-dim);
    padding: 0 8px;
    min-height: 40px;
    font-size: 15px;
  }
  .sidebar-close:hover {
    background: var(--bg3);
    color: var(--text);
  }
  .server-menu {
    position: static;
    z-index: auto;
  }
  .chat-list {
    flex: 1;
    max-height: none;
  }
  .invites {
    flex-direction: column;
    overflow: visible;
    border-top: 1px solid var(--border);
    padding: 8px;
  }
  .invite-card {
    flex: none;
  }
  .empty {
    display: block;
  }
}
</style>
