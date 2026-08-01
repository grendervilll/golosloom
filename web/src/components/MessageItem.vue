// Одно сообщение в чате.
<script setup lang="ts">
import { computed } from 'vue'
import type { ChatMessage } from '../stores/chat'
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
const role = computed(() => member.value?.role || 'user')
</script>

<template>
  <div
    class="msg"
    :class="{ mine: isMine, deleted: msg.deleted }"
    @contextmenu.prevent="emit('contextmenu', $event)"
  >
    <span class="role-icon" :style="{ filter: 'grayscale(0.6)' }">{{ roleIcon(auth.user, role) }}</span>
    <div class="body">
      <div class="head">
        <b>{{ msg.senderNick }}</b>
        <span class="muted small">{{ new Date(msg.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) }}</span>
        <span v-if="msg.edited" class="muted small">(изменено)</span>
      </div>
      <p v-if="msg.encrypted" class="encrypted">🔒 Сообщение зашифровано (ключ канала недоступен)</p>
      <p v-else-if="msg.deleted" class="deleted-text">Сообщение удалено</p>
      <p v-else class="text">{{ msg.text }}</p>
    </div>
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
.encrypted,
.deleted-text {
  color: var(--text-dim);
  font-style: italic;
}
</style>
