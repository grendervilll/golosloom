// Список всплывающих уведомлений.
<script setup lang="ts">
import { useToasts } from '../stores/toasts'
import { useChannelsStore } from '../stores/channels'

const toasts = useToasts()
const channels = useChannelsStore()

async function accept(id: number) {
  await channels.acceptInvite(id)
  toasts.remove(id)
}
async function decline(id: number) {
  await channels.declineInvite(id)
  toasts.remove(id)
}
</script>

<template>
  <div class="toasts">
    <div v-for="t in toasts.items" :key="t.id" class="toast frame" :class="t.kind">
      <span class="icon">{{ t.kind === 'invite' ? '📨' : t.kind === 'call' ? '📞' : t.kind === 'punch' ? '👊' : t.kind === 'warning' ? '⚠️' : 'ℹ️' }}</span>
      <div class="body">
        <p>{{ t.text }}</p>
        <div v-if="t.kind === 'invite' && t.inviteId" class="row">
          <button class="success tiny" @click="accept(t.inviteId!)">Принять</button>
          <button class="tiny" @click="decline(t.inviteId!)">Отклонить</button>
        </div>
      </div>
      <button class="close" @click="toasts.remove(t.id)">✕</button>
    </div>
  </div>
</template>

<style scoped>
.toasts {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 300;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 360px;
}
.toast {
  background: var(--bg3);
  padding: 10px 12px;
  display: flex;
  gap: 10px;
  align-items: flex-start;
  animation: slide-in 0.2s ease;
}
.toast.warning {
  border-color: var(--red);
}
.toast.call {
  border-color: var(--green);
}
.toast.punch {
  border-color: var(--yellow);
}
.body {
  flex: 1;
}
.row {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.tiny {
  padding: 3px 10px;
  font-size: 12px;
}
.close {
  background: transparent;
  padding: 2px 6px;
}
@keyframes slide-in {
  from {
    transform: translateX(20px);
    opacity: 0;
  }
  to {
    transform: none;
    opacity: 1;
  }
}
</style>
