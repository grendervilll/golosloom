// Приглашение пользователя в приватный канал по его ID.
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useChannelsStore } from '../stores/channels'
import { useAuthStore } from '../stores/auth'
import { useSettingsStore } from '../stores/settings'
import { toast } from 'vue-sonner'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'

const emit = defineEmits<{ (e: 'close'): void }>()

const channels = useChannelsStore()
const auth = useAuthStore()
const settings = useSettingsStore()

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
    toast.info('Приглашение отправлено')
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
  <Dialog :open="true" @update:open="(o) => { if (!o) emit('close') }">
    <DialogContent class="max-h-[85vh] max-w-[420px] overflow-y-auto">
      <DialogHeader class="text-center">
        <DialogTitle class="text-center">Пригласить в канал «{{ channels.current?.name }}»</DialogTitle>
      </DialogHeader>
      <div class="field modal-field">
        <label>ID пользователя</label>
        <input v-model.number="userId" type="number" placeholder="Например: 42" />
      </div>
      <div class="modal-field">
        <Button class="w-full" :disabled="busy" @click="inviteById">Пригласить по ID</Button>
      </div>

      <p class="section-title">Или выберите из списка:</p>
      <div class="user-list">
        <div v-for="u in candidates" :key="u.id" class="user-row" @click="invite(u.id)">
          <span class="role-icon">{{ u.is_server_admin ? '👑' : '👤' }}</span>
          <span class="nick">{{ u.nick }}</span>
          <span class="muted small">ID: {{ u.id }}</span>
        </div>
        <p v-if="candidates.length === 0" class="muted center">Все участники уже в канале</p>
      </div>
      <div v-if="error" class="error-text">{{ error }}</div>
      <DialogFooter class="grid-cols-1">
        <Button variant="secondary" @click="emit('close')">Закрыть</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
.section-title {
  margin: 14px 0 8px;
  font-size: 12px;
  text-transform: uppercase;
  color: var(--text-dim);
  font-weight: 700;
  text-align: center;
}
.user-list {
  max-height: 260px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
  padding: 0 16px;
}
.user-list .center {
  text-align: center;
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
</style>
