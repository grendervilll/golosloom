// Одно сообщение в чате.
<script setup lang="ts">
import { computed } from 'vue'
import type { ChatMessage } from '../stores/chat'
import type { Role } from '../api/types'
import { roleIcon } from '../utils/roles'
import { useAuthStore } from '../stores/auth'
import { useChannelsStore } from '../stores/channels'

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
// Иконка роли отправителя сообщения, а не текущего пользователя.
const role = computed<Role>(() => {
  if (member.value?.is_server_admin) return 'server_admin'
  return member.value?.role || 'user'
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
  <div
    class="msg"
    :class="{ mine: isMine, deleted: msg.deleted, pending: msg.pending }"
    @contextmenu.prevent="emit('contextmenu', $event)"
  >
    <span class="role-icon" :style="{ filter: 'grayscale(0.6)' }">{{ roleIcon(undefined, role) }}</span>
    <div class="body">
      <div class="head">
        <b>{{ msg.senderNick }}</b>
        <span class="muted small">{{ new Date(msg.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) }}</span>
        <span v-if="msg.edited" class="muted small">(изменено)</span>
      </div>
      <p v-if="msg.encrypted" class="encrypted">🔒 Сообщение зашифровано (ключ канала недоступен)</p>
      <p v-else-if="msg.deleted && canModerate" class="deleted-text">
        🗑 {{ msg.text || 'Сообщение удалено' }}
      </p>
      <p v-else-if="msg.deleted" class="deleted-text">Сообщение удалено</p>
      <p v-else-if="!gifUrl" class="text">{{ msg.text }}</p>
      <img v-if="gifUrl" class="gif-img" :src="gifUrl" alt="GIF" loading="lazy" />
    </div>
    <button class="more-btn" title="Действия с сообщением" @click.stop="openMore($event)">⋯</button>
  </div>
</template>

<style scoped>
.msg {
  display: flex;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
}
.msg:hover {
  background: var(--bg3);
}
.body {
  min-width: 0;
}
.head {
  display: flex;
  gap: 8px;
  align-items: baseline;
}
.small {
  font-size: 11px;
}
.text {
  word-break: break-word;
  white-space: pre-wrap;
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
}
.more-btn {
  visibility: hidden;
  align-self: center;
  background: transparent;
  padding: 2px 8px;
  color: var(--text-dim);
  font-size: 16px;
  border-radius: 6px;
}
.msg:hover .more-btn,
.more-btn:focus {
  visibility: visible;
}
.more-btn:hover {
  background: var(--bg4);
  color: var(--text);
}
</style>
