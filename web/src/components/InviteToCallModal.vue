// Приглашение в уже созданный звонок: кнопка "+" в панели звонка.
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useChannelsStore } from '../stores/channels'
import { useCallStore } from '../stores/calls'
import { useSettingsStore } from '../stores/settings'
import { useAuthStore } from '../stores/auth'
import { toast } from 'vue-sonner'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { roleIcon } from '../utils/roles'

const emit = defineEmits<{ (e: 'close'): void }>()

const channels = useChannelsStore()
const calls = useCallStore()
const auth = useAuthStore()
const settings = useSettingsStore()

const selected = ref<number[]>([])
const busy = ref(false)

onMounted(async () => {
  if (channels.currentId) {
    try {
      channels.members = await settings.api.listMembers(channels.currentId)
    } catch {
      /* ignore */
    }
  }
})

// Уже в звонке — не показываем
const currentCall = computed(() => calls.currentCall)
const participants = computed(() => {
  const call = currentCall.value
  if (!call) return new Set<number>()
  const s = new Set<number>(call.participants || [])
  s.add(call.initiator_id)
  // Добавляем remoteParticipants из LiveKit
  for (const p of calls.remoteParticipants) {
    const uid = Number(p.identity.split(':')[0])
    if (uid) s.add(uid)
  }
  return s
})

const candidates = computed(() =>
  channels.members.filter((m) => m.user_id !== auth.user?.id && !participants.value.has(m.user_id))
)

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

async function invite() {
  if (selected.value.length === 0) {
    toast.warning('Выберите хотя бы одного пользователя')
    return
  }
  busy.value = true
  try {
    await calls.inviteToCall(selected.value)
    toast.success('Приглашение отправлено')
    emit('close')
  } catch (e: any) {
    toast.error(e.message || 'Не удалось пригласить')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Dialog :open="true" @update:open="(o) => { if (!o) emit('close') }">
    <DialogContent class="max-w-[420px]">
      <DialogHeader class="text-center">
        <DialogTitle class="text-center">Пригласить в звонок</DialogTitle>
      </DialogHeader>
      <div class="toolbar">
        <Button variant="secondary" size="sm" @click="selectAll">Выбрать всех</Button>
        <Button variant="secondary" size="sm" @click="clearAll">Снять всех</Button>
      </div>
      <div class="user-list">
        <div v-for="u in candidates" :key="u.user_id" class="user-row" :class="{ picked: selected.includes(u.user_id) }" @click="toggle(u.user_id)">
          <input type="checkbox" :checked="selected.includes(u.user_id)" />
          <span class="role-icon">{{ roleIcon({ is_server_admin: (u as any).is_server_admin } as any, u.role) }}</span>
          <span class="nick">{{ u.nick }}</span>
          <span class="muted small">ID: {{ u.user_id }}</span>
        </div>
        <p v-if="candidates.length === 0" class="muted center">Нет доступных пользователей для приглашения</p>
      </div>
      <DialogFooter class="grid-cols-2">
        <Button variant="secondary" @click="emit('close')">Отмена</Button>
        <Button :disabled="busy" @click="invite">Пригласить</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
.toolbar {
  display: flex;
  justify-content: center;
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
.user-row.picked {
  background: var(--bg4);
}
.user-row .nick {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.user-row .role-icon {
  flex-shrink: 0;
}
.user-row .muted.small {
  flex-shrink: 0;
  margin-left: auto;
}
</style>
