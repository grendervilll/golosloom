// Кнопка "Войти в звонок" — вход в ранее отклонённый/пропущенный звонок.
<script setup lang="ts">
import { computed } from 'vue'
import { useCallStore } from '../stores/calls'
import { toast } from 'vue-sonner'

const calls = useCallStore()

const visible = computed(() => calls.canJoinCall)

async function join() {
  const call = calls.calls.find((c) => c.status !== 'ended' && !c.inCall && !c.incoming)
  if (!call) return
  try {
    await calls.join(call.id)
  } catch (e: any) {
    toast.error(e.message)
  }
}
</script>

<template>
  <div v-if="visible" class="join-bar">
    <button class="success" @click="join">📞 Войти в звонок</button>
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
  border-radius: 999px;
  font-weight: 600;
}
</style>
