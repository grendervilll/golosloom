// Кнопка "Войти в звонок" — вход в ранее отклонённый/пропущенный звонок.
<script setup lang="ts">
import { computed } from 'vue'
import { useCallStore } from '../stores/calls'
import { useToasts } from '../stores/toasts'

const calls = useCallStore()
const toasts = useToasts()

const visible = computed(() => calls.canJoinCall)

async function join() {
  const call = calls.calls.find((c) => c.status !== 'ended' && !c.inCall && !c.incoming)
  if (!call) return
  try {
    await calls.join(call.id)
  } catch (e: any) {
    toasts.push({ kind: 'error', text: e.message })
  }
}
</script>

<template>
  <div v-if="visible" class="join-bar">
    <button class="primary" @click="join">📞 Войти в звонок</button>
  </div>
</template>

<style scoped>
.join-bar {
  padding: 8px 14px;
  border-top: 1px solid var(--border);
  background: var(--bg2);
}
.join-bar button {
  width: 100%;
}
</style>
