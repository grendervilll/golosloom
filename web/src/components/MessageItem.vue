// Одно сообщение в чате — пузырь: свои справа (синий), чужие слева (белый).
<script setup lang="ts">
import { computed } from 'vue'
import type { ChatMessage } from '../stores/chat'
import type { Role } from '../api/types'
import { roleIcon } from '../utils/roles'
import { useAuthStore } from '../stores/auth'
import { useChannelsStore } from '../stores/channels'
import Avatar from './Avatar.vue'

const props = defineProps<{
  msg: ChatMessage
  myId: number
  canModerate: boolean
}>()
const emit = defineEmits<{ (e: 'contextmenu', ev: MouseEvent): void }>()

const auth = useAuthStore()
const channels = useChannelsStore()

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
    :class="{ mine: isMine, deleted: msg.deleted, pending: msg.pending }"
    @contextmenu.prevent="emit('contextmenu', $event)"
  >
    <div class="bubble">
      <div v-if="showSender" class="sender">{{ msg.senderNick }}</div>
      <p v-if="msg.encrypted" class="encrypted">🔒 Сообщение зашифровано (ключ канала недоступен)</p>
      <p v-else-if="msg.deleted && canModerate" class="deleted-text">
        🗑 {{ msg.text || 'Сообщение удалено' }}
      </p>
      <p v-else-if="msg.deleted" class="deleted-text">Сообщение удалено</p>
      <p v-else-if="!gifUrl" class="text">{{ msg.text }}</p>
      <img v-if="gifUrl" class="gif-img" :src="gifUrl" alt="GIF" loading="lazy" />
      <span class="meta">
        <span class="role-icon">{{ roleIcon(undefined, role) }}</span>
        <span class="time">{{ new Date(msg.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) }}</span>
        <span v-if="msg.edited" class="edited">изменено</span>
      </span>
    </div>
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
  white-space: pre-wrap;
  font-size: 14px;
  color: var(--text);
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
