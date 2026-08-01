// Выбор пользователей для звонка: конкретный, несколько, "Выбрать всех", "Снять всех".
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useChannelsStore } from '../stores/channels'
import { useCallStore } from '../stores/calls'
import { useToasts } from '../stores/toasts'
import { roleIcon } from '../utils/roles'
import { useAuthStore } from '../stores/auth'

const emit = defineEmits<{ (e: 'close'): void }>()

const channels = useChannelsStore()
const calls = useCallStore()
const auth = useAuthStore()
const toasts = useToasts()

const selected = ref<number[]>([])
const busy = ref(false)

const candidates = computed(() => channels.members.filter((m) => m.user_id !== auth.user?.id))

function toggle(id: number) {
  if (selected.value.includes(id)) {
    selected.value = selected.value.filter((x) => x !== id)
  } else {
    selected.value.push(id)
  }
}

function selectAll() {
  selected.value = candidates.value.map((c) => c.user_id)
}
function clearAll() {
  selected.value = []
}

async function start() {
  if (selected.value.length === 0) {
    toasts.push({ kind: 'warning', text: 'Выберите хотя бы одного пользователя' })
    return
  }
  busy.value = true
  try {
    await calls.initiate(channels.currentId, selected.value)
    emit('close')
  } catch (e: any) {
    toasts.push({ kind: 'error', text: e.message })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal">
      <h2>Кому позвонить?</h2>
      <div class="toolbar">
        <button @click="selectAll">Выбрать всех</button>
        <button @click="clearAll">Снять всех</button>
      </div>
      <div class="user-list">
        <div v-for="u in candidates" :key="u.user_id" class="user-row" :class="{ picked: selected.includes(u.user_id) }" @click="toggle(u.user_id)">
          <input type="checkbox" :checked="selected.includes(u.user_id)" />
          <span class="role-icon">{{ roleIcon(auth.user, u.role) }}</span>
          <span class="nick">{{ u.nick }}</span>
          <span class="muted small">ID: {{ u.user_id }}</span>
        </div>
        <p v-if="candidates.length === 0" class="muted">В канале нет других участников</p>
      </div>
      <div class="row">
        <button class="primary" :disabled="busy" @click="start">Начать вызов</button>
        <button @click="emit('close')">Отмена</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.user-list {
  max-height: 320px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
}
.user-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-radius: 6px;
  cursor: pointer;
}
.user-row:hover {
  background: var(--bg3);
}
.user-row.picked {
  background: var(--bg4);
}
.nick {
  flex: 1;
}
.row {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
