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
    <button class="join-btn" title="Войти в звонок" @click="join">
      <svg class="ico" viewBox="0 0 512 512"><path d="M164.9 24.6c-7.7-18.6-28-28.5-47.4-23.2l-88 24C12.1 30.2 0 46 0 64C0 311.4 200.6 512 448 512c18 0 33.8-12.1 38.6-29.5l24-88c5.3-19.4-4.6-39.7-23.2-47.4l-96-40c-16.3-6.8-35.2-2.1-46.3 11.6L304.7 368C234.3 334.7 177.3 277.7 144 207.3L193.3 167c13.7-11.2 18.4-30 11.6-46.3l-40-96z" /></svg>
    </button>
  </div>
</template>

<style scoped>
.join-bar {
  padding: 8px 14px;
  border-top: 1px solid var(--border);
  background: var(--bg2);
  display: flex;
  justify-content: center;
}
.join-btn {
  width: 46px;
  height: 46px;
  padding: 0;
  border-radius: 50%;
  background: var(--green);
  display: flex;
  align-items: center;
  justify-content: center;
}
.join-btn:hover:not(:disabled) {
  background: #1a7f44;
}
.join-btn .ico {
  width: 20px;
  height: 20px;
  fill: #fff;
  animation: keyframes-fill 0.5s;
}
@keyframes keyframes-fill {
  0% {
    transform: rotate(0deg) scale(0);
    opacity: 0;
  }
  50% {
    transform: rotate(-10deg) scale(1.2);
  }
  100% {
    transform: rotate(0deg) scale(1);
    opacity: 1;
  }
}
</style>
