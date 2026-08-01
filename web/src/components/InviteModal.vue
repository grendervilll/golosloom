// Приглашение пользователя в приватный канал по его ID.
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useChannelsStore } from '../stores/channels'
import { useAuthStore } from '../stores/auth'
import { useSettingsStore } from '../stores/settings'
import { useToasts } from '../stores/toasts'

const emit = defineEmits<{ (e: 'close'): void }>()

const channels = useChannelsStore()
const auth = useAuthStore()
const settings = useSettingsStore()
const toasts = useToasts()

const userId = ref<number | null>(null)
const userList = ref<any[]>([])
const busy = ref(false)
const error = ref('')

async function loadUsers() {
  try {
    userList.value = await settings.api.listUsers()
  } catch {
    userList.value = []
  }
}
void loadUsers()

const candidates = computed(() =>
  userList.value.filter(
    (u) => u.id !== auth.user?.id && !channels.members.some((m) => m.user_id === u.id),
  ),
)

async function invite(id: number) {
  busy.value = true
  error.value = ''
  try {
    await channels.enterChannel(channels.currentId)
    await settings.api.inviteToChannel(channels.currentId, id)
    toasts.push({ kind: 'info', text: 'Приглашение отправлено' })
    emit('close')
  } catch (e: any) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}

async function inviteById() {
  if (!userId.value) {
    error.value = 'Введите ID пользователя'
    return
  }
  await invite(userId.value)
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal">
      <h2>Пригласить в канал «{{ channels.current?.name }}»</h2>
      <div class="field">
        <label>ID пользователя</label>
        <input v-model.number="userId" type="number" placeholder="Например: 42" />
      </div>
      <button class="primary" :disabled="busy" @click="inviteById">Пригласить по ID</button>

      <p class="section-title">Или выберите из списка:</p>
      <div class="user-list">
        <div v-for="u in candidates" :key="u.id" class="user-row" @click="invite(u.id)">
          <span class="role-icon">{{ u.is_server_admin ? '👑' : '👤' }}</span>
          <span class="nick">{{ u.nick }}</span>
          <span class="muted small">ID: {{ u.id }}</span>
        </div>
        <p v-if="candidates.length === 0" class="muted">Все участники уже в канале</p>
      </div>
      <div v-if="error" class="error-text">{{ error }}</div>
      <div class="row">
        <button @click="emit('close')">Закрыть</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.section-title {
  margin: 14px 0 8px;
  font-size: 12px;
  text-transform: uppercase;
  color: var(--text-dim);
  font-weight: 700;
}
.user-list {
  max-height: 260px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
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
.nick {
  flex: 1;
}
.row {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}
</style>
