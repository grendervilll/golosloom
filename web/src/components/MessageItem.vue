// Одно сообщение в чате — пузырь: свои справа (синий), чужие слева (белый).
<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ChatMessage } from '../stores/chat'
import type { Role } from '../api/types'
import { roleIcon } from '../utils/roles'
import { useAuthStore } from '../stores/auth'
import { useChannelsStore } from '../stores/channels'
import { useChatStore } from '../stores/chat'
import { useSettingsStore } from '../stores/settings'
import { splitMarkdown } from '../utils/markdown'
import Avatar from './Avatar.vue'
import CodeBlock from './CodeBlock.vue'
import FileViewer from './FileViewer.vue'

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
// Вложение: URL с токеном (уже привязанного или локальный предпросмотр).
const settings = useSettingsStore()
const viewerOpen = ref(false)
const att = computed(() => props.msg.attachment)
const attSrc = computed(() => {
  if (!att.value) return ''
  return props.msg.localUrl || settings.api.fileUrl(att.value.id)
})
const isImage = computed(() => !!att.value && att.value.mime.startsWith('image/'))
const isVideo = computed(() => !!att.value && att.value.mime.startsWith('video/'))
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
          <span class="quote-text">{{ replied.text || replied.attachment?.filename || '…' }}</span>
        </span>
      </button>
      <!-- Вложение: фото — миниатюра с просмотром по клику, видео — плеер,
           остальное — карточка файла со скачиванием. -->
      <div v-if="att && isImage" class="att">
        <img class="att-img" :src="attSrc" :alt="att.filename" loading="lazy" @click="viewerOpen = true" />
      </div>
      <div v-else-if="att && isVideo" class="att">
        <video class="att-video" :src="attSrc" controls preload="metadata"></video>
      </div>
      <div v-else-if="att" class="att">
        <div class="file-card">
          <span class="file-icon">{{ fileIcon(att.mime) }}</span>
          <div class="file-info">
            <span class="file-name">{{ att.filename }}</span>
            <span class="file-size">{{ formatSize(att.size) }} · {{ att.mime.split('/')[1]?.toUpperCase() }}</span>
          </div>
          <a class="file-download" :href="settings.api.downloadUrl(att.id)" download>Скачать</a>
        </div>
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
            <span v-html="seg.html"></span>
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
    <FileViewer v-if="viewerOpen" :src="attSrc" :filename="att?.filename || ''" @close="viewerOpen = false" />
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
/* Вложения. */
.att {
  margin: 4px 0;
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
  max-height: 280px;
  border-radius: 10px;
  background: #000;
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
