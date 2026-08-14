// Панель чата — главное содержимое центра: история, отправка, редактирование.
// Мессенджер-стиль: шапка с аватаром, пузыри сообщений.
<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useChannelsStore } from '../stores/channels'
import { useChatStore, type ChatMessage } from '../stores/chat'
import { useCallStore } from '../stores/calls'
import { useSettingsStore } from '../stores/settings'
import { usePlayerStore } from '../stores/player'
import { toast } from 'vue-sonner'
import MessageItem from './MessageItem.vue'
import EmojiPicker from './EmojiPicker.vue'
import Avatar from './Avatar.vue'
import FileViewer from './FileViewer.vue'
import AudioPlayer from './AudioPlayer.vue'
import type { Attachment } from '../api/types'

const emit = defineEmits<{ (e: 'toggle-participants'): void; (e: 'open-invite'): void; (e: 'open-call'): void; (e: 'open-reg-invite'): void }>()

const auth = useAuthStore()
const channels = useChannelsStore()
const chat = useChatStore()
const calls = useCallStore()
const settings = useSettingsStore()
const player = usePlayerStore()
const showPicker = ref(false)

const listEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)
const menu = ref({ x: 0, y: 0, msg: null as ChatMessage | null })
const menuEl = ref<HTMLElement | null>(null)
const mediaMenuEl = ref<HTMLElement | null>(null)

const messages = computed(() => chat.messages.get(channels.currentId) || [])
const channelName = computed(() => channels.current?.name || '')
const canModerate = computed(() => chat.canSeeDeleted())
// Приглашение на регистрацию — только админ сервера или админ канала.
const canCreateRegInvite = computed(
  () => auth.isServerAdmin || channels.currentRole === 'channel_admin',
)

// --- «Печатает…» ---
const typers = ref<{ userId: number; nick: string }[]>([])
watch(
  () => chat.typingUsers(channels.currentId),
  (v) => (typers.value = v),
  { deep: true },
)
const typingSummary = computed(() => {
  const t = typers.value
  if (t.length === 0) return ''
  const visible = t.slice(0, 4).map((x) => x.nick).join(', ')
  const verb = t.length === 1 ? 'печатает' : 'печатают'
  if (t.length > 4) {
    const rest = t.length - 4
    return `${visible} и ещё ${rest} ${rest === 1 ? 'печатает' : 'печатают'}…`
  }
  return `${visible} ${verb}…`
})
const showTypersList = ref(false)
// Список печатающих раскрывается вверх (открытая шторка).
function toggleTypersList() {
  if (typers.value.length <= 4) return
  showTypersList.value = !showTypersList.value
}

// --- Меню канала: поиск / фото и видео / участники ---
const channelMenuOpen = ref(false)
const channelMenuTab = ref<'main' | 'search' | 'media'>('main')
const searchQuery = ref('')
const searchResults = ref<ChatMessage[]>([])
const searchInputEl = ref<HTMLInputElement | null>(null)
let searchTimer = 0
// ID сообщения, которое подсвечиваем после перехода.
const highlightId = ref(0)

function openChannelMenu() {
  channelMenuOpen.value = !channelMenuOpen.value
  if (channelMenuOpen.value) channelMenuTab.value = 'main'
}
function closeChannelMenu() {
  channelMenuOpen.value = false
  searchQuery.value = ''
  searchResults.value = []
}

watch(searchQuery, () => {
  if (searchTimer) window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => void runSearch(), 300)
})
async function runSearch() {
  const q = searchQuery.value
  if (!q.trim()) {
    searchResults.value = []
    return
  }
  searchResults.value = await chat.searchMessages(channels.currentId, q)
}

// Переход к сообщению в чате: закрыть меню, проскроллить, подсветить.
async function scrollToMessage(id: number) {
  closeChannelMenu()
  await nextTick()
  const el = document.querySelector(`[data-msg-id="${id}"]`)
  if (el) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    highlightId.value = id
    setTimeout(() => (highlightId.value = 0), 2200)
  }
}

// --- Ответ на сообщение ---
function setReply(msg: ChatMessage) {
  chat.replyTo = { channelId: channels.currentId, messageId: msg.id }
}
const replyPreview = computed(() => {
  const r = chat.replyTo
  if (!r || r.channelId !== channels.currentId) return null
  const m = chat.messages.get(r.channelId)?.find((x) => x.id === r.messageId)
  if (!m) return null
  return { nick: m.senderNick, text: m.text || m.attachment?.filename || '…' }
})
function cancelReply() {
  chat.replyTo = null
}
function replyFromMenu(msg: ChatMessage) {
  menu.value.msg = null
  setReply(msg)
  inputEl.value?.focus()
}

// --- Фото и видео канала ---
const mediaItems = computed(() => {
  const list = chat.messages.get(channels.currentId) || []
  return list.filter(
    (m) => m.attachment && (m.attachment.mime.startsWith('image/') || m.attachment.mime.startsWith('video/')),
  )
})
const mediaViewer = ref<{ src: string; filename: string; video?: boolean } | null>(null)
const mediaMenu = ref({ x: 0, y: 0, msg: null as ChatMessage | null })
function openMediaMenu(e: MouseEvent, msg: ChatMessage) {
  e.preventDefault()
  mediaMenu.value = { x: e.clientX, y: e.clientY, msg }
  void nextTick(clampMenu)
}
function openMedia(msg: ChatMessage) {
  if (!msg.attachment) return
  mediaViewer.value = {
    src: settings.api.fileUrl(msg.attachment.id),
    filename: msg.attachment.filename,
    video: msg.attachment.mime.startsWith('video/'),
  }
}
function mediaJump(msg: ChatMessage) {
  mediaMenu.value.msg = null
  void scrollToMessage(msg.id)
}

async function scrollBottom() {
  await nextTick()
  if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
}

// Авторасширение поля ввода: растёт до 13 строк, дальше — прокрутка.
const MAX_INPUT_HEIGHT = 276
function autoResize() {
  const el = inputEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, MAX_INPUT_HEIGHT) + 'px'
}

watch(messages, async (list, old) => {
  // Прокручиваем вниз только если были у нижнего края (иначе догрузка
  // старой истории при поиске не будет дёргать чат).
  await nextTick()
  const el = listEl.value
  if (!el) return
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  if (nearBottom || (old && old.length === 0)) void scrollBottom()
  void list
}, { deep: true })
onMounted(() => void scrollBottom())
// При изменении текста (ввод, начало редактирования, очистка) — подгоняем высоту.
watch(
  () => chat.draft,
  () => void nextTick(autoResize),
)
// При переключении канала — считаем его прочитанным.
watch(
  () => channels.currentId,
  (id) => {
    if (id) chat.markRead(id)
    showTypersList.value = false
  },
)

// Отправка «печатает…» при вводе текста (троттлинг — в сторе).
function onTyping() {
  if (chat.draft.trim()) chat.typing(channels.currentId)
}

async function send() {
  const text = chat.draft.trim()
  if (!text && !chat.replyTo) return
  // Длинное сообщение отклоняется сервером (лимит MAX_MESSAGE_LEN) —
  // предупреждаем заранее и показываем понятную ошибку.
  const max = settings.serverConfig?.max_message_len || 2000
  const bytes = new TextEncoder().encode(text).length
  if (bytes > max) {
    toast.error(`Сообщение слишком длинное: максимум ${max} символов`)
    return
  }
  const replyToId = chat.replyTo?.channelId === channels.currentId ? chat.replyTo.messageId : 0
  try {
    if (chat.editingId) {
      await chat.edit(channels.currentId, chat.editingId, text)
      return
    }
    const ok = await chat.send(channels.currentId, text, 0, replyToId)
    if (!ok) {
      toast.warning('Ключ канала ещё не получен, повторите позже')
      return
    }
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось отправить сообщение')
    return
  }
  chat.draft = ''
  chat.replyTo = null
}

// --- Файлы (вложения, максимум 100 МБ) ---
const MAX_FILE_SIZE = 100 * 1024 * 1024
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref<{ name: string } | null>(null)

async function onPickFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !channels.currentId) return
  if (file.size > MAX_FILE_SIZE) {
    toast.error('Файл слишком большой: максимум 100 МБ')
    return
  }
  // Локальный предпросмотр картинки до ответа сервера.
  const localUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
  uploading.value = { name: file.name }
  try {
    const att = await settings.api.uploadFile(channels.currentId, file)
    uploading.value = null
    await sendWithAttachment(att, localUrl)
  } catch (err: any) {
    if (localUrl) URL.revokeObjectURL(localUrl)
    uploading.value = null
    toast.error(err?.message || 'Не удалось загрузить файл')
  }
}

// Отправка сообщения с вложением (текст может быть пустым).
async function sendWithAttachment(att: Attachment, localUrl?: string) {
  const text = chat.draft.trim()
  const max = settings.serverConfig?.max_message_len || 2000
  if (new TextEncoder().encode(text).length > max) {
    toast.error(`Сообщение слишком длинное: максимум ${max} символов`)
    return
  }
  const replyToId = chat.replyTo?.channelId === channels.currentId ? chat.replyTo.messageId : 0
  try {
    const ok = await chat.send(channels.currentId, text, att.id, replyToId, localUrl)
    if (!ok) {
      toast.warning('Ключ канала ещё не получен, повторите позже')
      return
    }
  } catch (e: any) {
    toast.error(e?.message || 'Не удалось отправить сообщение')
    return
  }
  chat.draft = ''
  chat.editingId = 0
  chat.replyTo = null
}

// --- Запись голосовых и видео-сообщений ---
// Режим кнопки отправки: send (текст) → mic (голос) → cam (видео).
// Переключается ПКМ по кнопке; ЛКМ — отправить/начать/остановить запись.
const sendMode = ref<'send' | 'mic' | 'cam'>('send')
// Видео-сообщения ограничены 3 минутами, голосовые — нет.
const VIDEO_LIMIT_MS = 3 * 60 * 1000
const rec = ref<{
  kind: 'mic' | 'cam'
  recorder: MediaRecorder
  stream: MediaStream
  chunks: Blob[]
  timer: number
  discarded: boolean
  startedAtMs: number
} | null>(null)
const recTime = ref(0)

const recText = computed(() => {
  if (!rec.value) return ''
  const s = Math.floor(recTime.value / 1000)
  const m = Math.floor(s / 60)
  const label = rec.value.kind === 'mic' ? 'Голосовое сообщение' : 'Видео-сообщение'
  const max = rec.value.kind === 'cam' ? ' · максимум 3:00' : ''
  return `${label} · ${m}:${String(s % 60).padStart(2, '0')}${max} — нажмите ещё раз, чтобы остановить`
})

// Цикл режимов кнопки правой кнопкой мыши: отправить → микрофон → камера.
function cycleSendMode() {
  if (rec.value) return
  sendMode.value = sendMode.value === 'send' ? 'mic' : sendMode.value === 'mic' ? 'cam' : 'send'
}

// Подходящий mime-тип записи для браузера (webm, иначе mp4/ogg).
function pickRecorderMime(kind: 'mic' | 'cam'): string {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates =
    kind === 'mic'
      ? ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
      : ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4', 'video/ogg;codecs=theora']
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c
    } catch {
      /* ignore */
    }
  }
  return ''
}

async function startRec() {
  if (!channels.currentId || rec.value) return
  const kind = sendMode.value === 'cam' ? 'cam' : 'mic'
  const constraints: MediaStreamConstraints =
    kind === 'mic'
      ? { audio: true }
      : // Видео 640×480, чтобы меньше занимало места на сервере.
        { audio: true, video: { width: { ideal: 640, max: 640 }, height: { ideal: 480, max: 480 } } }
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints)
  } catch {
    toast.error(
      kind === 'mic'
        ? 'Нет доступа к микрофону — проверьте разрешения'
        : 'Нет доступа к камере или микрофону — проверьте разрешения',
    )
    return
  }
  const mime = pickRecorderMime(kind)
  let recorder: MediaRecorder
  try {
    recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
  } catch {
    stream.getTracks().forEach((t) => t.stop())
    toast.error('Запись недоступна в этом браузере')
    return
  }
  const chunks: Blob[] = []
  const state: {
    kind: 'mic' | 'cam'
    recorder: MediaRecorder
    stream: MediaStream
    chunks: Blob[]
    timer: number
    discarded: boolean
    startedAtMs: number
  } = {
    kind,
    recorder,
    stream,
    chunks,
    timer: 0,
    discarded: false,
    startedAtMs: Date.now(),
  }
  recorder.ondataavailable = (e: BlobEvent) => {
    if (e.data && e.data.size > 0) chunks.push(e.data)
  }
  recorder.onstop = () => {
    stream.getTracks().forEach((t) => t.stop())
    if (!state.discarded) void uploadRecording(kind, chunks)
  }
  recorder.start(250)
  recTime.value = 0
  state.timer = window.setInterval(() => {
    if (!rec.value) return
    recTime.value = Date.now() - rec.value.startedAtMs
    // Видео: максимум 3 минуты — останавливаем автоматически.
    if (kind === 'cam' && recTime.value >= VIDEO_LIMIT_MS) {
      toast.info('Видео-сообщение достигло 3 минут — запись остановлена')
      stopRec()
    }
  }, 250)
  rec.value = state
}

function stopRec() {
  const r = rec.value
  if (!r) return
  clearInterval(r.timer)
  rec.value = null
  try {
    r.recorder.stop()
  } catch {
    /* ignore */
  }
}

// Отмена записи без отправки (смена канала, закрытие чата).
function cancelRec() {
  const r = rec.value
  if (!r) return
  clearInterval(r.timer)
  r.discarded = true
  rec.value = null
  try {
    r.recorder.stop()
  } catch {
    /* ignore */
  }
}

// Загрузка готовой записи и отправка как вложения.
async function uploadRecording(kind: 'mic' | 'cam', chunks: Blob[]) {
  if (!channels.currentId || chunks.length === 0) return
  const type = chunks[0].type || (kind === 'mic' ? 'audio/webm' : 'video/webm')
  const ext = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : 'webm'
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const name = `${kind === 'mic' ? 'Голосовое' : 'Видео'}-${ts}.${ext}`
  const file = new File(chunks, name, { type })
  uploading.value = { name }
  try {
    const att = await settings.api.uploadFile(channels.currentId, file)
    uploading.value = null
    await sendWithAttachment(att)
  } catch (err: any) {
    uploading.value = null
    toast.error(err?.message || 'Не удалось отправить запись')
  }
}

// ЛКМ по кнопке отправки: в режиме текста — отправить, в режиме записи —
// начать/остановить запись.
function onSendClick() {
  if (rec.value) {
    stopRec()
    return
  }
  if (sendMode.value === 'send') {
    void send()
    return
  }
  void startRec()
}

const sendTitle = computed(() => {
  if (rec.value) return 'Остановить запись'
  if (sendMode.value === 'mic') return 'Записать голосовое сообщение (ПКМ — переключить режим)'
  if (sendMode.value === 'cam') return 'Записать видео-сообщение до 3 минут (ПКМ — переключить режим)'
  return 'Отправить (ПКМ — режим записи голоса/видео)'
})

// При смене канала: запись отменяется, плеер голосовых закрывается.
watch(
  () => channels.currentId,
  () => {
    if (rec.value) cancelRec()
    player.stop()
  },
)

onUnmounted(() => {
  if (rec.value) cancelRec()
})

function insertEmoji(e: string) {
  const el = inputEl.value
  const start = el?.selectionStart ?? chat.draft.length
  const end = el?.selectionEnd ?? start
  chat.draft = chat.draft.slice(0, start) + e + chat.draft.slice(end)
  void nextTick(() => {
    el?.focus()
    el?.setSelectionRange(start + e.length, start + e.length)
  })
}

async function sendGif(url: string) {
  showPicker.value = false
  const ok = await chat.send(channels.currentId, '![gif](' + url + ')')
  if (!ok) {
    toast.warning('Ключ канала ещё не получен, повторите позже')
  }
}

function startEdit(msg: ChatMessage) {
  if (msg.senderId !== auth.user?.id) return
  chat.editingId = msg.id
  chat.draft = msg.text
  inputEl.value?.focus()
}

async function remove(msg: ChatMessage) {
  menu.value.msg = null
  await chat.remove(channels.currentId, msg.id)
}

function showOriginal(msg: ChatMessage) {
  if (!canModerate.value || !msg.original) return
  const t = msg.text
  msg.text = msg.original
  msg.original = t
}

function openMenu(e: MouseEvent, msg: ChatMessage) {
  e.preventDefault?.()
  if (!canModerate.value && msg.senderId !== auth.user?.id) return
  menu.value = { x: e.clientX, y: e.clientY, msg }
  void nextTick(clampMenu)
}

function openSearchMenu(e: MouseEvent, msg: ChatMessage) {
  menu.value = { x: e.clientX, y: e.clientY, msg }
  void nextTick(clampMenu)
}

// Контекстное меню не должно выходить за пределы окна: после рендера
// замеряем его размер и прижимаем к границам.
function clampMenu() {
  const el = menuEl.value || mediaMenuEl.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const m = menu.value || mediaMenu.value
  if (!m) return
  const pad = 8
  m.x = Math.max(pad, Math.min(m.x, window.innerWidth - r.width - pad))
  m.y = Math.max(pad, Math.min(m.y, window.innerHeight - r.height - pad))
}

function closeMenu() {
  menu.value.msg = null
  showPicker.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    // Во время записи Enter не отправляет текст.
    if (!rec.value) void send()
  }
  if (e.key === 'Escape') closeMenu()
}
</script>

<template>
  <div class="chat-panel" @click="closeMenu">
    <div class="chat-head">
      <Avatar
        :user-id="channels.currentId"
        :nick="channelName"
        :avatar="null"
        :size="36"
        :color="'#2aabee'"
      />
      <button
        class="head-title"
        :title="'Меню канала: поиск, фото и видео, участники'"
        @click="openChannelMenu"
      >
        <h2>
          {{ channelName }}
          <svg v-if="channels.current?.private" class="lock-ico" viewBox="0 0 448 512"><path d="M144 144v48H304V144c0-44.2-35.8-80-80-80s-80 35.8-80 80zM80 192V144C80 64.5 144.5 0 224 0s144 64.5 144 144v48h16c35.3 0 64 28.7 64 64V448c0 35.3-28.7 64-64 64H64c-35.3 0-64-28.7-64-64V256c0-35.3 28.7-64 64-64H80z" /></svg>
        </h2>
        <span
          v-if="typingSummary"
          class="typing-hint"
          :class="{ clickable: typers.length > 4 }"
          @click.stop="toggleTypersList"
        >{{ typingSummary }}</span>
        <span v-else class="muted small">ID канала: {{ channels.currentId }}</span>
        <!-- Список печатающих (при >4) раскрывается вверх от шапки. -->
        <div v-if="showTypersList" class="typers-drop" @click.stop>
          <div v-for="t in typers" :key="t.userId" class="typer-row">{{ t.nick }}</div>
        </div>
      </button>

      <!-- Меню канала: поиск / фото и видео / участники. -->
      <div v-if="channelMenuOpen" class="channel-menu" @click.stop>
        <template v-if="channelMenuTab === 'main'">
          <button class="menu-item" @click="channelMenuTab = 'search'; nextTick(() => searchInputEl?.focus())">
            <span class="mi-ico">🔍</span> Поиск сообщений
          </button>
          <button class="menu-item" @click="channelMenuTab = 'media'">
            <span class="mi-ico">🖼</span> Фото и видео
            <span class="mi-count">{{ mediaItems.length }}</span>
          </button>
          <button class="menu-item" @click="emit('toggle-participants'); closeChannelMenu()">
            <span class="mi-ico">👥</span> Участники
            <span class="mi-count">{{ channels.members.length }}</span>
          </button>
        </template>

        <template v-else-if="channelMenuTab === 'search'">
          <div class="menu-back">
            <button class="back-btn" @click="channelMenuTab = 'main'">‹</button>
            <input ref="searchInputEl" v-model="searchQuery" class="menu-search" placeholder="Поиск по сообщениям…" />
          </div>
          <div class="menu-list">
            <p v-if="chat.searchBusy" class="muted center">Поиск…</p>
            <p v-else-if="searchQuery && searchResults.length === 0" class="muted center">Ничего не найдено</p>
            <p v-else-if="!searchQuery" class="muted center">Введите текст для поиска</p>
            <div
              v-for="m in searchResults"
              :key="m.id"
              class="search-row"
              @contextmenu.prevent="openSearchMenu($event, m)"
            >
              <div class="search-row-info">
                <span class="search-row-nick">{{ m.senderNick }}</span>
                <span class="search-row-text">{{ m.text || (m.attachment?.filename || '…') }}</span>
              </div>
              <span class="search-row-time">{{ new Date(m.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) }}</span>
              <button class="jump-btn" title="Перейти к сообщению" @click="scrollToMessage(m.id)">⤴</button>
            </div>
          </div>
        </template>

        <template v-else>
          <div class="menu-back">
            <button class="back-btn" @click="channelMenuTab = 'main'">‹</button>
            <span class="menu-title">Фото и видео</span>
          </div>
          <div class="media-grid">
            <p v-if="mediaItems.length === 0" class="muted center">В этом чате нет фото и видео</p>
            <div
              v-for="m in mediaItems"
              :key="m.id"
              class="media-thumb"
              :title="m.attachment?.filename"
              @click="openMedia(m)"
              @contextmenu.prevent="openMediaMenu($event, m)"
            >
              <img
                v-if="m.attachment!.mime.startsWith('image/')"
                class="media-img"
                :src="m.localUrl || settings.api.fileUrl(m.attachment!.id)"
                loading="lazy"
                alt=""
              />
              <div v-else class="media-video">
                <video :src="settings.api.fileUrl(m.attachment!.id)" muted preload="metadata"></video>
                <span class="play-ico">▶</span>
              </div>
            </div>
          </div>
        </template>
      </div>
      <button
        v-if="channels.current?.private"
        class="icon-btn"
        title="Пригласить пользователя в приватный канал"
        @click="emit('open-invite')"
      >
        <svg class="ico" viewBox="0 0 640 512"><path d="M96 128a128 128 0 1 1 256 0A128 128 0 1 1 96 128zM0 482.3C0 383.8 79.8 304 178.3 304l91.4 0C368.2 304 448 383.8 448 482.3c0 16.4-13.3 29.7-29.7 29.7L29.7 512C13.3 512 0 498.7 0 482.3zM504 312l0-64-64 0c-13.3 0-24-10.7-24-24s10.7-24 24-24l64 0 0-64c0-13.3 10.7-24 24-24s24 10.7 24 24l0 64 64 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-64 0 0 64c0 13.3-10.7 24-24 24s-24-10.7-24-24z" /></svg>
      </button>
      <button
        v-if="canCreateRegInvite"
        class="icon-btn reg-invite-btn"
        title="Одноразовая ссылка на регистрацию (5 минут)"
        @click="emit('open-reg-invite')"
      >
        <svg class="ico" viewBox="0 0 512 512"><path d="M48 64C21.5 64 0 85.5 0 112c0 15.1 7.1 29.3 19.2 38.4L236.8 313.6c11.4 8.5 27 8.5 38.4 0L492.8 150.4c12.1-9.1 19.2-23.3 19.2-38.4c0-26.5-21.5-48-48-48L48 64zM0 176L0 384c0 35.3 28.7 64 64 64l384 0c35.3 0 64-28.7 64-64l0-208L294.4 339.2c-22.8 17.1-54 17.1-76.8 0L0 176z" /></svg>
      </button>
      <button v-if="!calls.inCall" class="icon-btn" title="Позвонить участникам канала" @click="emit('open-call')">
        <svg class="ico" viewBox="0 0 512 512"><path d="M164.9 24.6c-7.7-18.6-28-28.5-47.4-23.2l-88 24C12.1 30.2 0 46 0 64C0 311.4 200.6 512 448 512c18 0 33.8-12.1 38.6-29.5l24-88c5.3-19.4-4.6-39.7-23.2-47.4l-96-40c-16.3-6.8-35.2-2.1-46.3 11.6L304.7 368C234.3 334.7 177.3 277.7 144 207.3L193.3 167c13.7-11.2 18.4-30 11.6-46.3l-40-96z" /></svg>
      </button>
    </div>
    <!-- Плеер голосового сообщения: вверху рабочей зоны канала. -->
    <AudioPlayer />
    <div ref="listEl" class="chat-list">
      <MessageItem
        v-for="m in messages"
        :key="m.id"
        :msg="m"
        :my-id="auth.user?.id || 0"
        :can-moderate="canModerate"
        :highlight="m.id === highlightId"
        @contextmenu="(e) => openMenu(e, m)"
        @reply="setReply(m)"
        @jump="scrollToMessage"
      />
      <p v-if="messages.length === 0" class="muted empty">Сообщений пока нет</p>
    </div>
    <div class="chat-input">
      <!-- Панель ответа на сообщение. -->
      <div v-if="replyPreview" class="reply-bar">
        <span class="reply-ico">↩</span>
        <span class="reply-text"><b>{{ replyPreview.nick }}</b>: {{ replyPreview.text }}</span>
        <button class="reply-cancel" title="Отменить ответ" @click="cancelReply">✕</button>
      </div>
      <div v-if="uploading" class="uploading-hint">Загрузка {{ uploading.name }}…</div>
      <div v-if="recText" class="rec-hint">{{ recText }}</div>
      <div class="input-pill">
        <input ref="fileInput" type="file" class="hidden-input" @change="onPickFile" />
        <textarea
          v-model="chat.draft"
          ref="inputEl"
          rows="1"
          :placeholder="chat.editingId ? 'Редактирование сообщения...' : 'Сообщение в чат...'"
          @input="onTyping"
          @keydown="onKeydown"
        ></textarea>
        <button v-if="chat.editingId" class="icon-btn edit-cancel" title="Отменить редактирование" @click="chat.editingId = 0; chat.draft = ''">
          <svg class="ico" viewBox="0 0 384 512"><path d="M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z" /></svg>
        </button>
        <button class="icon-btn clip-btn" title="Прикрепить файл (до 100 МБ)" @click="fileInput?.click()">
          <svg class="ico" viewBox="0 0 512 512"><path d="M396.2 83.8c-24.4-24.4-64-24.4-88.4 0l-184 184c-48.8 48.8-48.8 128 0 176.8s128 48.8 176.8 0l152-152c10.9-10.9 28.7-10.9 39.6 0s10.9 28.7 0 39.6l-152 152c-70.7 70.7-185.3 70.7-256 0s-70.7-185.3 0-256l184-184c46.3-46.3 121.3-46.3 167.6 0s46.3 121.3 0 167.6l-176 176c-23.6 23.6-61.9 23.6-85.5 0s-23.6-61.9 0-85.5L297.4 170.4c10.9-10.9 28.7-10.9 39.6 0s10.9 28.7 0 39.6l-105.4 105.4c-1.7 1.7-4.5 1.7-6.2 0s-1.7-4.5 0-6.2l176-176c24.4-24.4 64-24.4 88.4 0s24.4 64 0 88.4l-184 184c-48.8 48.8-128 48.8-176.8 0s-48.8-128 0-176.8l184-184c46.3-46.3 121.3-46.3 167.6 0z" /></svg>
        </button>
        <button class="icon-btn emoji-btn" title="Смайлики и GIF" @click.stop="showPicker = !showPicker">
          <svg class="ico" viewBox="0 0 512 512"><path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM164.1 325.5C182 346.2 212.6 368 256 368s74-21.8 91.9-42.5c5.8-6.7 15.9-7.4 22.6-1.6s7.4 15.9 1.6 22.6C349.8 372.1 311.1 400 256 400s-93.8-27.9-116.1-53.5c-5.8-6.7-5.1-16.8 1.6-22.6s16.8-5.1 22.6 1.6zM144.4 208a32 32 0 1 1 64 0 32 32 0 1 1 -64 0zm192-32a32 32 0 1 1 0 64 32 32 0 1 1 0-64z" /></svg>
        </button>
        <button
          class="send-btn"
          :class="{ rec: !!rec, 'mode-mic': !rec && sendMode === 'mic', 'mode-cam': !rec && sendMode === 'cam' }"
          :title="sendTitle"
          :disabled="sendMode === 'send' && !chat.draft.trim()"
          @click="onSendClick"
          @contextmenu.prevent="cycleSendMode"
        >
          <svg v-if="rec" class="ico stop-ico" viewBox="0 0 512 512"><path d="M96 96c0-17.7 14.3-32 32-32l256 0c17.7 0 32 14.3 32 32l0 320c0 17.7-14.3 32-32 32l-256 0c-17.7 0-32-14.3-32-32l0-320z" /></svg>
          <svg v-else-if="sendMode === 'mic'" class="ico" viewBox="0 0 384 512"><path d="M192 0C139 0 96 43 96 96V256c0 53 43 96 96 96s96-43 96-96V96c0-53-43-96-96-96zM64 216c0-13.3-10.7-24-24-24s-24 10.7-24 24v40c0 89.1 66.2 162.7 152 174.4V464H120c-13.3 0-24 10.7-24 24s10.7 24 24 24h72 72c13.3 0 24-10.7 24-24s-10.7-24-24-24H216V430.4c85.8-11.7 152-85.3 152-174.4V216c0-13.3-10.7-24-24-24s-24 10.7-24 24v40c0 70.7-57.3 128-128 128s-128-57.3-128-128V216z" /></svg>
          <svg v-else-if="sendMode === 'cam'" class="ico" viewBox="0 0 512 512"><path d="M149.1 64.8L138.7 96 64 96C28.7 96 0 124.7 0 160L0 416c0 35.3 28.7 64 64 64l384 0c35.3 0 64-28.7 64-64l0-256c0-35.3-28.7-64-64-64l-74.7 0L362.9 64.8C356.4 45.2 338.1 32 317.4 32L194.6 32c-20.7 0-39 13.2-45.5 32.8zM256 192a96 96 0 1 1 0 192 96 96 0 1 1 0-192z" /></svg>
          <svg v-else class="ico" viewBox="0 0 512 512"><path d="M498.1 5.6c10.1 7 15.4 19.1 13.5 31.2l-64 416c-1.5 9.7-7.4 18.2-16 23s-18.9 5.4-28 1.6L284 427.7l-68.5 74.1c-8.9 9.7-22.9 12.9-35.2 8.1S160 493.2 160 480l0-83.6c0-4 1.5-7.8 4.2-10.8L331.8 202.8c5.8-6.3 5.6-16-.4-22s-15.7-6.4-22-.7L106 360.8 17.7 316.6C7.1 311.3 .3 300.7 0 288.1s4.8-25.1 14.8-31.1l80.5-48.3 288.5-173.2 114.3-68.6z" /></svg>
        </button>
      </div>
      <EmojiPicker
        v-if="showPicker"
        @insert="insertEmoji"
        @send-gif="sendGif"
        @close="showPicker = false"
      />
    </div>

    <div v-if="menu.msg" ref="menuEl" class="ctx-menu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @click.stop>
      <button @click="replyFromMenu(menu.msg!)">Ответить</button>
      <button v-if="menu.msg.senderId === auth.user?.id" @click="startEdit(menu.msg!)">Изменить сообщение</button>
      <button v-if="menu.msg.senderId === auth.user?.id || canModerate" class="danger" @click="remove(menu.msg!)">
        Удалить сообщение
      </button>
      <button v-if="canModerate && menu.msg.original" @click="showOriginal(menu.msg!)">Показать оригинал сообщения</button>
    </div>

    <!-- Контекстное меню фото/видео: переход к фото в чате. -->
    <div
      v-if="mediaMenu.msg"
      ref="mediaMenuEl"
      class="ctx-menu"
      :style="{ left: mediaMenu.x + 'px', top: mediaMenu.y + 'px' }"
      @click.stop
    >
      <button @click="mediaJump(mediaMenu.msg!)">Перейти к фото</button>
    </div>

    <!-- Просмотр фото/видео из галереи. -->
    <FileViewer
      v-if="mediaViewer"
      :src="mediaViewer.src"
      :filename="mediaViewer.filename"
      :video="mediaViewer.video"
      @close="mediaViewer = null"
    />
  </div>
</template>

<style scoped>
.chat-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  background: var(--bg);
}
.chat-panel.in-call {
  flex: 0 0 300px;
  border-top: 1px solid var(--border);
}
.chat-head {
  height: 60px;
  padding: 0 16px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--bg);
  flex-shrink: 0;
  position: relative;
}
.head-title {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  align-items: center;
  text-align: center;
  background: transparent;
  border-radius: 10px;
  padding: 4px 10px;
  min-height: 44px;
  position: relative;
  max-width: 420px;
  margin: 0 auto;
}
.head-title:hover {
  background: var(--bg3);
}
.chat-head h2 {
  font-size: 16px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lock-ico {
  width: 12px;
  height: 12px;
  fill: var(--text-dim);
  flex-shrink: 0;
}
.small {
  font-size: 12px;
}
/* Индикатор «печатает…». */
.typing-hint {
  font-size: 12.5px;
  color: var(--accent);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.typing-hint.clickable {
  cursor: pointer;
  text-decoration: underline dotted;
}
/* Список печатающих при >4: раскрывается вверх от шапки. */
.typers-drop {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 6px;
  min-width: 200px;
  max-width: 260px;
  max-height: 40vh;
  overflow-y: auto;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  z-index: 120;
  animation: typers-in 0.15s ease-out;
  transform-origin: bottom left;
}
@keyframes typers-in {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.typer-row {
  padding: 6px 10px;
  font-size: 13px;
  border-radius: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.typer-row:hover {
  background: var(--bg3);
}
/* Меню канала: поиск / фото и видео / участники. */
.channel-menu {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  width: min(400px, calc(100vw - 24px));
  max-height: 60vh;
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
  z-index: 120;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  animation: picker-in 0.15s ease-out;
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  background: transparent;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 14px;
  text-align: left;
}
.menu-item:hover {
  background: var(--bg3);
}
.mi-ico {
  font-size: 16px;
}
.mi-count {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-dim);
  background: var(--bg3);
  border-radius: 999px;
  padding: 2px 8px;
}
.menu-back {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px;
}
.menu-back .back-btn {
  background: transparent;
  border-radius: 8px;
  width: 34px;
  height: 34px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
}
.menu-back .back-btn:hover {
  background: var(--bg3);
}
.menu-search {
  flex: 1;
  background: var(--bg3);
  border-radius: 10px;
  border: none;
  padding: 8px 12px;
  font-size: 14px;
}
.menu-title {
  font-size: 14px;
  font-weight: 600;
}
.menu-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 46vh;
  overflow-y: auto;
}
.center {
  text-align: center;
  padding: 16px;
  font-size: 13px;
}
.search-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
}
.search-row:hover {
  background: var(--bg3);
}
.search-row-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.search-row-nick {
  font-size: 13px;
  font-weight: 600;
}
.search-row-text {
  font-size: 12.5px;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-row-time {
  font-size: 11px;
  color: var(--text-dim);
  flex-shrink: 0;
}
.jump-btn {
  width: 32px;
  height: 32px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  flex-shrink: 0;
  font-size: 14px;
}
.jump-btn:hover {
  background: var(--accent-hover);
}
.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  gap: 4px;
  max-height: 46vh;
  overflow-y: auto;
  padding: 4px;
}
.media-thumb {
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  aspect-ratio: 1;
  cursor: pointer;
  background: var(--bg3);
}
.media-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.media-video {
  width: 100%;
  height: 100%;
  position: relative;
}
.media-video video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.play-ico {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 20px;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
}
/* Панель ответа на сообщение. */
.reply-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg3);
  border-radius: 10px;
  padding: 6px 10px;
  font-size: 12.5px;
  min-width: 0;
}
.reply-ico {
  flex-shrink: 0;
}
.reply-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-dim);
}
.reply-text b {
  color: var(--accent-hover);
}
.reply-cancel {
  background: transparent;
  color: var(--text-dim);
  padding: 2px 8px;
  border-radius: 6px;
  flex-shrink: 0;
}
.reply-cancel:hover {
  background: var(--bg4);
  color: var(--text);
}
/* Круглые кнопки-иконки в шапке чата. */
.icon-btn {
  width: 36px;
  height: 36px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--bg3);
  flex-shrink: 0;
}
.icon-btn:hover:not(:disabled) {
  background: var(--bg4);
}
.icon-btn .ico {
  width: 15px;
  height: 15px;
  fill: var(--text-dim);
  flex-shrink: 0;
}
.icon-btn:hover .ico {
  fill: var(--text);
}
.reg-invite-btn .ico {
  fill: var(--accent);
}
.chat-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--bg2);
}
.empty {
  text-align: center;
  margin-top: 40px;
}
.chat-input {
  padding: 8px 12px;
  border-top: 1px solid var(--border);
  background: var(--bg);
  position: relative;
}
/* Капсула ввода: текст + кнопки смайликов и отправки внутри, справа.
   Поле текста уже всей капсулы (padding-right), текст не доходит до кнопок. */
.input-pill {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  background: var(--bg3);
  border-radius: 20px;
  padding: 6px;
  min-height: 48px;
}
.input-pill textarea {
  flex: 1;
  min-width: 0;
  resize: none;
  background: transparent;
  border: none;
  padding: 8px 4px 8px 10px;
  font-size: 14px;
  line-height: 1.45;
  max-height: 276px;
  overflow-y: auto;
  box-shadow: none;
}
.input-pill textarea:focus {
  border: none;
  box-shadow: none;
}
.edit-cancel {
  flex-shrink: 0;
  align-self: center;
  background: transparent;
}
.edit-cancel .ico {
  width: 13px;
  height: 13px;
}
.emoji-btn {
  flex-shrink: 0;
}
.clip-btn {
  flex-shrink: 0;
}
.clip-btn .ico {
  width: 16px;
  height: 16px;
}
.hidden-input {
  display: none;
}
.uploading-hint {
  font-size: 12px;
  color: var(--text-dim);
  padding: 2px 6px;
}
/* Индикатор идущей записи голоса/видео. */
.rec-hint {
  font-size: 12px;
  color: var(--red);
  font-weight: 600;
  padding: 2px 6px;
  animation: rec-blink 1.2s ease-in-out infinite;
}
@keyframes rec-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}
.send-btn.rec {
  background: var(--red);
  animation: rec-pulse 1.2s ease-in-out infinite;
}
@keyframes rec-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.45);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(220, 38, 38, 0);
  }
}
.send-btn.mode-mic {
  background: var(--accent);
}
.send-btn.mode-cam {
  background: var(--accent);
}
.send-btn .stop-ico {
  width: 13px;
  height: 13px;
}
.send-btn {
  width: 38px;
  height: 38px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--accent);
  flex-shrink: 0;
}
.send-btn:hover:not(:disabled) {
  background: var(--accent-hover);
}
.send-btn:disabled {
  opacity: 0.5;
}
.send-btn .ico {
  width: 15px;
  height: 15px;
  fill: #fff;
}
.ctx-menu {
  position: fixed;
  z-index: 200;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 200px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  animation: ctx-in 0.1s ease;
}
.ctx-menu button {
  text-align: left;
  background: transparent;
  border-radius: 6px;
  font-size: 13px;
  padding: 8px 10px;
}
.ctx-menu button:hover {
  background: var(--bg3);
}
.ctx-menu button.danger {
  color: var(--red);
}
@keyframes ctx-in {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (max-width: 900px) {
  .id-text {
    display: none;
  }
  .chat-head {
    flex-wrap: wrap;
    height: auto;
    min-height: 60px;
    padding: 8px 10px;
    gap: 6px;
  }
  .chat-list {
    padding: 8px 10px;
  }
  .chat-input {
    padding: 8px 10px;
  }
}
</style>
