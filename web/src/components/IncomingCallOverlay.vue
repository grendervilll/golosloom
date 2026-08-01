// Окно входящего звонка: принять или отклонить.
<script setup lang="ts">
import { computed } from 'vue'
import { useCallStore } from '../stores/calls'
import { useToasts } from '../stores/toasts'
import type { Call } from '../api/types'

const calls = useCallStore()
const toasts = useToasts()

const call = computed(() => calls.ringingCall)

async function accept(c: Call) {
  try {
    await calls.accept(c)
  } catch (e: any) {
    toasts.push({ kind: 'error', text: e.message || 'Не удалось подключиться к звонку' })
  }
}
async function decline(c: Call) {
  await calls.decline(c)
}
</script>

<template>
  <div v-if="call" class="modal-backdrop">
    <div class="modal incoming">
      <h2>📞 Входящий звонок</h2>
      <p>Вам звонят в канале. Принять?</p>
      <div class="row">
        <button class="success" @click="accept(call)">Принять</button>
        <button class="danger" @click="decline(call)">Отклонить</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.incoming {
  text-align: center;
  width: 360px;
}
.row {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-top: 16px;
}
.row button {
  flex: 1;
}
</style>
