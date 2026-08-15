// Одно сообщение в чате — пузырь: свои справа (синий), чужие слева (белый).
<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ChatMessage } from '../stores/chat'
import type { Role, Attachment } from '../api/types'
import { roleIcon } from '../utils/roles'
import { useAuthStore } from '../stores/auth'
import { useChannelsStore } from '../stores/channels'
import { useChatStore } from '../stores/chat'
import { useSettingsStore } from '../stores/settings'
import { splitMarkdown } from '../utils/markdown'
import Avatar from './Avatar.vue'
import CodeBlock from './CodeBlock.vue'
import FileViewer from './FileViewer.vue'
import VideoPopup from './VideoPopup.vue'
import { usePlayerStore } from '../stores/player'

const props = defineProps<{
  msg: ChatMessage
  myId: number
  canModerate: boolean
  highlight?: boolean
}>()
const emit = defineEmits<{
  (e: 'contextmenu', ev: MouseEvent): void
  (e: 'reply'): void
  (e: 'jump', id: number): void
}>()

const auth = useAuthStore()
const channels = useChannelsStore()
const chat = useChatStore()
const player = usePlayerStore()
const settings = useSettingsStore()

// Сообщение, на которое отвечает текущее (для цитаты).
const replied = computed(() => {
  if (!props.msg.replyToId) return null
  return chat.messages.get(props.msg.channelId)?.find((m) => m.id === props.msg.replyToId) || null
})

const isMine = computed(() => props.msg.senderId === props.myId)
const member = computed(() => channels.members.find((m) => m.user_id === props.msg.senderId))
// Аватар отправителя (если есть) — из списка участников канала.
const senderAvatar = computed(() => member.value?.avatar || null)
// Иконка роли отправителя сообщения, а не текущего пользователя.
const role = computed<Role>(() => {
  if (member.value?.is_server_admin) return 'server_admin'
  return member.value?.role || 'user'
})
// Имя отправителя в пузыре (для групповых чатов).
const showSender = computed(() => {
  const members = channels.members
  return members.length > 2 && !isMine.value && !props.msg.encrypted
})
// GIF-сообщения приходят как ![gif](url) — рендерим картинку.
const gifUrl = computed(() => {
  const m = props.msg.text.match(/!\[gif\]\((https?:\/\/[^)\s]+)\)/)
  return m ? m[1] : ''
})
// Markdown-сегменты (код-блоки и форматированный текст).
const segments = computed(() => {
  if (props.msg.encrypted || props.msg.deleted || gifUrl.value) return []
  return splitMarkdown(props.msg.text)
})
// Вложения сообщения: одно или несколько (из буфера обмена и т.д.).
const atts = computed(() =>
  props.msg.attachments && props.msg.attachments.length > 0 ? props.msg.attachments : [],
)
function srcOf(a: { id: number; localUrl?: string }): string {
  return a.localUrl || settings.api.fileUrl(a.id)
}
const isImage = (a: Attachment) => a.mime.startsWith('image/')
const isVideo = (a: Attachment) => a.mime.startsWith('video/')
const isAudio = (a: Attachment) => a.mime.startsWith('audio/')
// Открытый в лайтбоксе/попапе конкретный файл.
const viewerAtt = ref<Attachment | null>(null)
const videoAtt = ref<Attachment | null>(null)
// Голосовое сообщение сейчас играет в верхнем плеере канала.
const voiceActive = (a: Attachment) =>
  !!a && player.voice?.msgId === props.msg.id && player.voice?.attId === a.id
// Запуск/остановка голосового вложения в верхнем плеере.
function toggleVoice(a: Attachment) {
  player.toggleVoice({
    msgId: props.msg.id,
    attId: a.id,
    channelId: props.msg.channelId,
    fileId: a.id,
    src: srcOf(a),
    filename: a.filename,
  })
}
// Иконка и человекочитаемый размер для карточки файла.
function fileIcon(mime: string): string {
  if (mime.startsWith('text/')) return '📄'
  if (mime.includes('pdf')) return '📕'
  if (mime.includes('zip') || mime.includes('tar') || mime.includes('rar')) return '🗜'
  if (mime.includes('audio')) return '🎵'
  return '📎'
}
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' МБ'
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' КБ'
  return bytes + ' Б'
}

// Кнопка «⋯» открывает то же меню, что и правая кнопка мыши
// (работает и на мобильных устройствах).
function openMore(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  emit('contextmenu', { clientX: rect.right, clientY: rect.bottom } as MouseEvent)
}
</script>

<template>
  <div v-if="msg.system" class="msg system">
    <p class="system-text">{{ msg.text }}</p>
  </div>
  <div
    v-else
    class="msg"
    :class="{ mine: isMine, deleted: msg.deleted, pending: msg.pending, flash: highlight }"
    :data-msg-id="msg.id"
    @contextmenu.prevent="emit('contextmenu', $event)"
    @dblclick="emit('reply')"
  >
    <div class="bubble">
      <div v-if="showSender" class="sender">{{ msg.senderNick }}</div>
      <!-- Цитата сообщения, на которое отвечаем; клик — переход к нему. -->
      <button
        v-if="replied && !msg.encrypted"
        class="reply-quote"
        :class="{ 'mine-quote': isMine }"
        @click.stop="emit('jump', replied.id)"
      >
        <span class="quote-line"></span>
        <span class="quote-body">
          <span class="quote-nick">{{ replied.senderNick || '…' }}</span>
          <span class="quote-text">{{ replied.text || replied.attachments?.[0]?.filename || '…' }}</span>
        </span>
      </button>
      <!-- Вложение: фото — миниатюра с просмотром по клику, видео — превью
           с открытием попапа, голос — кнопка с плеером вверху чата,
           остальное — карточка файла со скачиванием. -->
      <!-- Вложения: фото — миниатюра с просмотром по клику, видео — превью
           с открытием попапа, голос — кнопка с плеером вверху чата,
           остальное — карточка файла со скачиванием. Несколько вложений
           группируются в одном сообщении. -->
      <div v-if="msg.attachmentDeleted" class="att-deleted">Файл был удалён администратором сервера</div>
      <div v-else-if="atts.length" class="att" :class="{ multi: atts.length > 1 }">
        <template v-for="a in atts" :key="a.id">
          <img
            v-if="isImage(a)"
            class="att-img"
            :class="{ 'att-thumb': atts.length > 1 }"
            :src="srcOf(a)"
            :alt="a.filename"
            loading="lazy"
            @click="viewerAtt = a"
          />
          <button
            v-else-if="isVideo(a)"
            class="att-video-btn"
            :title="'Смотреть видео: ' + a.filename"
            @click="videoAtt = a"
          >
            <video class="att-video" :src="srcOf(a)" muted preload="metadata"></video>
            <span class="video-play">▶</span>
          </button>
          <button
            v-else-if="isAudio(a)"
            class="voice-card"
            :class="{ active: voiceActive(a) }"
            :title="'Воспроизвести: ' + a.filename"
            @click="toggleVoice(a)"
          >
            <span class="voice-ico">
              <svg v-if="voiceActive(a)" class="ico" viewBox="0 0 320 512"><path d="M48 64C21.5 64 0 85.5 0 112L0 400c0 26.5 21.5 48 48 48s48-21.5 48-48l0-288c0-26.5-21.5-48-48-48zm192 0c-26.5 0-48 21.5-48 48l0 288c0 26.5 21.5 48 48 48s48-21.5 48-48l0-288c0-26.5-21.5-48-48-48z" /></svg>
              <svg v-else class="ico" viewBox="0 0 384 512"><path d="M73 39c-14.8-9.3-33.4-9.1-48 .3C9.4 48.5 0 65.4 0 83.5L0 428.5c0 18.1 9.4 35 25 44.2 14.6 9.4 33.2 9.6 48 .3L361 297.6c14.9-9.4 23.9-25.3 23.9-41.6s-9-32.2-23.9-41.6L73 39z" /></svg>
            </span>
            <span class="voice-name">{{ a.filename }}</span>
            <span class="voice-bars" :class="{ playing: voiceActive(a) }">
              <i></i><i></i><i></i><i></i>
            </span>
          </button>
          <div v-else class="file-card">
            <span class="file-icon">{{ fileIcon(a.mime) }}</span>
            <div class="file-info">
              <span class="file-name">{{ a.filename }}</span>
              <span class="file-size">{{ formatSize(a.size) }} · {{ a.mime.split('/')[1]?.toUpperCase() }}</span>
            </div>
            <a class="file-download" :href="settings.api.downloadUrl(a.id)" download>Скачать</a>
          </div>
        </template>
      </div>
      <p v-if="msg.encrypted" class="encrypted">🔒 Сообщение зашифровано (ключ канала недоступен)</p>
      <p v-else-if="msg.deleted && canModerate" class="deleted-text">
        🗑 {{ msg.text || 'Сообщение удалено' }}
      </p>
      <p v-else-if="msg.deleted" class="deleted-text">Сообщение удалено</p>
      <template v-else-if="!gifUrl">
        <div v-for="(seg, i) in segments" :key="i" class="text">
          <CodeBlock v-if="seg.type === 'code'" :lang="seg.lang" :code="seg.code || ''" />
          <template v-else>
            <!-- eslint-disable-next-line vue/no-v-html -- текст экранирован в markdown.ts -->
            <div v-html="seg.html"></div>
          </template>
        </div>
      </template>
      <img v-if="gifUrl" class="gif-img" :src="gifUrl" alt="GIF" loading="lazy" />
      <span class="meta">
        <span class="role-icon">{{ roleIcon(undefined, role) }}</span>
        <span class="time">{{ new Date(msg.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) }}</span>
        <span v-if="msg.edited" class="edited">изменено</span>
      </span>
    </div>
    <FileViewer
      v-if="viewerAtt"
      :src="srcOf(viewerAtt)"
      :filename="viewerAtt.filename"
      @close="viewerAtt = null"
    />
    <VideoPopup
      v-if="videoAtt"
      :src="srcOf(videoAtt)"
      :filename="videoAtt.filename"
      @close="videoAtt = null"
    />
    <button class="more-btn" title="Действия с сообщением" @click.stop="openMore($event)">⋯</button>
  </div>
</template>

<style scoped>
.msg {
  display: flex;
  gap: 6px;
  justify-content: flex-start;
}
.msg.mine {
  justify-content: flex-end;
}
.msg:hover {
  background: var(--bg2);
  border-radius: 8px;
}
.bubble {
  max-width: min(78%, 560px);
  min-width: 0;
  background: var(--bubble);
  border: 1px solid var(--border);
  border-radius: 14px;
  border-top-left-radius: 4px;
  padding: 8px 12px 6px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
.msg.mine .bubble {
  background: var(--accent);
  border-color: var(--accent);
  border-radius: 14px;
  border-top-right-radius: 4px;
}
.sender {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent-hover);
  margin-bottom: 2px;
}
.text {
  word-break: break-word;
  overflow-wrap: anywhere;
  font-size: 14px;
  color: var(--text);
}
/* Inline-разметка внутри текста сообщения. */
.text :deep(code) {
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12.5px;
  background: var(--bg4);
  border-radius: 5px;
  padding: 1px 5px;
}
.msg.mine .text :deep(code) {
  background: rgba(255, 255, 255, 0.22);
}
.text :deep(a) {
  color: var(--accent-hover);
  text-decoration: underline;
}
.msg.mine .text :deep(a) {
  color: #fff;
  text-decoration: underline;
}
.text :deep(s) {
  opacity: 0.7;
}
/* Блочный markdown: заголовки, списки, цитаты, таблицы, hr. */
.text :deep(h1),
.text :deep(h2),
.text :deep(h3),
.text :deep(h4) {
  font-weight: 700;
  margin: 4px 0 2px;
  line-height: 1.3;
}
.text :deep(h1) {
  font-size: 17px;
}
.text :deep(h2) {
  font-size: 16px;
}
.text :deep(h3) {
  font-size: 15px;
}
.text :deep(h4) {
  font-size: 14px;
}
.text :deep(ul),
.text :deep(ol) {
  margin: 4px 0;
  padding-left: 22px;
}
.text :deep(li) {
  margin: 2px 0;
}
.text :deep(li.task) {
  list-style: none;
  margin-left: -18px;
}
.text :deep(li.task::before) {
  content: '☐ ';
}
.text :deep(li.task.done::before) {
  content: '☑ ';
}
.text :deep(blockquote) {
  border-left: 3px solid var(--accent);
  background: var(--bg3);
  border-radius: 0 6px 6px 0;
  padding: 3px 10px;
  margin: 4px 0;
  opacity: 0.92;
}
.text :deep(hr) {
  border: none;
  border-top: 1px solid var(--border);
  margin: 6px 0;
}
.text :deep(.md-table) {
  overflow-x: auto;
  margin: 4px 0;
}
.text :deep(table) {
  border-collapse: collapse;
  font-size: 13px;
}
.text :deep(th),
.text :deep(td) {
  border: 1px solid var(--border);
  padding: 3px 8px;
}
.text :deep(th) {
  background: var(--bg3);
  font-weight: 700;
}
.text :deep(p) {
  margin: 2px 0;
}
/* На синем фоне своих сообщений md-элементы тоже должны читаться. */
.msg.mine .text :deep(blockquote) {
  background: rgba(255, 255, 255, 0.14);
  border-left-color: rgba(255, 255, 255, 0.7);
}
.msg.mine .text :deep(hr) {
  border-top-color: rgba(255, 255, 255, 0.35);
}
.msg.mine .text :deep(th),
.msg.mine .text :deep(td) {
  border-color: rgba(255, 255, 255, 0.35);
}
.msg.mine .text :deep(th) {
  background: rgba(255, 255, 255, 0.14);
}
/* Вложения. */
.att {
  margin: 4px 0;
}
/* Несколько вложений в одном сообщении: компактная сетка. */
.att.multi {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.att.multi .att-img.att-thumb,
.att.multi .att-video {
  width: 140px;
  height: 140px;
  max-width: 140px;
  max-height: 140px;
  object-fit: cover;
}
.att.multi .file-card {
  min-width: 0;
  max-width: 260px;
}
.att.multi .voice-card {
  min-width: 0;
  max-width: 240px;
}
/* Вложение удалено администратором сервера: файл стёрт, текст сообщения остался. */
.att-deleted {
  margin: 4px 0;
  padding: 8px 12px;
  background: var(--bg3);
  border-radius: 10px;
  color: var(--text-dim);
  font-size: 13px;
  font-style: italic;
  max-width: 260px;
}
.msg.mine .att-deleted {
  background: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.85);
}
.att-img {
  display: block;
  max-width: min(320px, 100%);
  max-height: 280px;
  border-radius: 10px;
  cursor: zoom-in;
  object-fit: cover;
}
.att-video {
  display: block;
  max-width: min(360px, 100%);
  max-height: 200px;
  border-radius: 10px;
  background: #000;
}
/* Превью видео: кнопка с плеером попапа по клику. */
.att-video-btn {
  position: relative;
  display: block;
  padding: 0;
  border-radius: 10px;
  overflow: hidden;
  background: transparent;
}
.video-play {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 26px;
  background: rgba(0, 0, 0, 0.25);
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.8);
}
.att-video-btn:hover .video-play {
  background: rgba(0, 0, 0, 0.05);
}
/* Голосовое сообщение: кнопка запуска плеера вверху чата. */
.voice-card {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--bg3);
  border-radius: 10px;
  padding: 8px 12px;
  min-width: 220px;
  max-width: 100%;
}
.voice-card:hover {
  background: var(--bg4);
}
.voice-ico {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--accent);
  flex-shrink: 0;
}
.voice-ico .ico {
  width: 13px;
  height: 13px;
  fill: #fff;
}
.voice-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Анимированные полоски «волны» при воспроизведении. */
.voice-bars {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 14px;
  flex-shrink: 0;
}
.voice-bars i {
  width: 3px;
  border-radius: 2px;
  background: var(--accent);
  height: 4px;
}
.voice-bars.playing i {
  animation: bar-bounce 0.9s ease-in-out infinite;
}
.voice-bars.playing i:nth-child(2) {
  animation-delay: 0.15s;
}
.voice-bars.playing i:nth-child(3) {
  animation-delay: 0.3s;
}
.voice-bars.playing i:nth-child(4) {
  animation-delay: 0.45s;
}
@keyframes bar-bounce {
  0%,
  100% {
    height: 4px;
  }
  50% {
    height: 14px;
  }
}
.msg.mine .voice-card {
  background: rgba(255, 255, 255, 0.15);
}
.msg.mine .voice-card:hover {
  background: rgba(255, 255, 255, 0.25);
}
.msg.mine .voice-name {
  color: #fff;
}
.msg.mine .voice-bars i {
  background: #fff;
}
.file-card {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--bg3);
  border-radius: 10px;
  padding: 10px 12px;
  min-width: 240px;
  max-width: 100%;
}
.file-icon {
  font-size: 24px;
  flex-shrink: 0;
}
.file-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.file-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-size {
  font-size: 11px;
  color: var(--text-dim);
}
.file-download {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
  text-decoration: none;
  flex-shrink: 0;
  padding: 6px 10px;
  border-radius: 8px;
}
.file-download:hover {
  background: var(--bg4);
}
.msg.mine .file-card {
  background: rgba(255, 255, 255, 0.15);
}
.msg.mine .file-name {
  color: #fff;
}
.msg.mine .file-size {
  color: rgba(255, 255, 255, 0.75);
}
.msg.mine .file-download {
  color: #fff;
}
.msg.mine .file-download:hover {
  background: rgba(255, 255, 255, 0.2);
}
/* Цитата ответа. */
.reply-quote {
  display: flex;
  align-items: stretch;
  gap: 8px;
  width: 100%;
  background: var(--bg3);
  border-radius: 8px;
  padding: 5px 10px;
  margin-bottom: 4px;
  text-align: left;
  min-height: 28px;
}
.reply-quote.mine-quote {
  background: rgba(255, 255, 255, 0.15);
}
.reply-quote:hover {
  background: var(--bg4);
}
.reply-quote.mine-quote:hover {
  background: rgba(255, 255, 255, 0.25);
}
.quote-line {
  width: 3px;
  border-radius: 2px;
  background: var(--accent);
  flex-shrink: 0;
}
.quote-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.quote-nick {
  font-size: 12px;
  font-weight: 700;
  color: var(--accent-hover);
}
.mine-quote .quote-nick {
  color: #fff;
}
.quote-text {
  font-size: 12px;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mine-quote .quote-text {
  color: rgba(255, 255, 255, 0.8);
}
/* Подсветка сообщения после перехода к нему. */
.flash {
  animation: flash-msg 2.2s ease;
  border-radius: 10px;
}
@keyframes flash-msg {
  0% {
    background: rgba(42, 171, 238, 0.35);
  }
  60% {
    background: rgba(42, 171, 238, 0.22);
  }
  100% {
    background: transparent;
  }
}
.msg.mine .text {
  color: #fff;
}
/* Оптимистично показанное сообщение (ещё не подтверждено сервером). */
.msg.pending {
  opacity: 0.55;
}
.gif-img {
  max-width: 320px;
  max-height: 240px;
  border-radius: 10px;
  margin-top: 4px;
  display: block;
  object-fit: contain;
}
.encrypted,
.deleted-text {
  color: var(--text-dim);
  font-style: italic;
  font-size: 13px;
}
.msg.mine .encrypted,
.msg.mine .deleted-text {
  color: rgba(255, 255, 255, 0.85);
}
.meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 3px;
}
.time,
.edited {
  font-size: 11px;
  color: #999999;
}
.msg.mine .time,
.msg.mine .edited {
  color: rgba(255, 255, 255, 0.75);
}
.role-icon {
  font-size: 11px;
  opacity: 0.7;
}
.msg.system {
  justify-content: center;
  padding: 6px;
}
.system-text {
  font-size: 12px;
  color: var(--text-dim);
  background: var(--bg3);
  padding: 4px 12px;
  border-radius: 999px;
}
.more-btn {
  visibility: hidden;
  align-self: center;
  background: transparent;
  padding: 2px 8px;
  color: var(--text-dim);
  font-size: 16px;
  border-radius: 6px;
  flex-shrink: 0;
}
.msg:hover .more-btn,
.more-btn:focus {
  visibility: visible;
}
.more-btn:hover {
  background: var(--bg3);
  color: var(--text);
}
</style>
