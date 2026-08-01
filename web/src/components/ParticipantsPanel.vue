// Список участников канала со статусами, ролями и ID.
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useChannelsStore } from '../stores/channels'
import { useSettingsStore } from '../stores/settings'
import { useToasts } from '../stores/toasts'
import { roleIcon, roleLabel } from '../utils/roles'
import type { Role } from '../api/types'

const auth = useAuthStore()
const channels = useChannelsStore()
const settings = useSettingsStore()
const toasts = useToasts()

const showMembers = ref(true)
const showModeration = ref(false)
const modTarget = ref(0)
const modReason = ref('')
const canKick = computed(() => hasPerm('kick'))
const canBan = computed(() => hasPerm('ban'))
const canManage = computed(() => hasPerm('manage_members') || auth.isServerAdmin)

function hasPerm(perm: string): boolean {
  const role = channels.currentRole
  if (role === 'server_admin') return true
  const defaults: Record<string, string[]> = {
    user: [],
    channel_moderator: ['ban', 'kick', 'invite', 'delete_message'],
    channel_admin: ['ban', 'kick', 'invite', 'delete_message', 'delete_channel', 'manage_members'],
  }
  return defaults[role]?.includes(perm) || false
}

async function setRole(userId: number, role: Role) {
  try {
    await channels.setRole(channels.currentId, userId, role)
  } catch (e: any) {
    toasts.push({ kind: 'error', text: e.message })
  }
}

async function kick(userId: number, nick: string) {
  if (!modReason.value.trim()) {
    toasts.push({ kind: 'warning', text: 'Укажите причину кика' })
    return
  }
  try {
    await channels.kick(channels.currentId, userId, modReason.value)
    toasts.push({ kind: 'info', text: `${nick} кикнут` })
  } catch (e: any) {
    toasts.push({ kind: 'error', text: e.message })
  }
  modTarget.value = 0
  modReason.value = ''
}

async function ban(userId: number, nick: string) {
  if (!modReason.value.trim()) {
    toasts.push({ kind: 'warning', text: 'Укажите причину бана' })
    return
  }
  try {
    await channels.ban(channels.currentId, userId, modReason.value)
    toasts.push({ kind: 'info', text: `${nick} забанен` })
  } catch (e: any) {
    toasts.push({ kind: 'error', text: e.message })
  }
  modTarget.value = 0
  modReason.value = ''
}
</script>

<template>
  <div class="members-panel">
    <div class="members-head" @click="showMembers = !showMembers">
      <span>Участники канала ({{ channels.members.length }})</span>
      <span class="chevron">{{ showMembers ? '▼' : '▲' }}</span>
    </div>
    <div v-if="showMembers" class="members-list">
      <div v-for="m in channels.members" :key="m.user_id" class="member">
        <span class="role-icon">{{ roleIcon(auth.user, m.role) }}</span>
        <div class="member-info">
          <span class="nick">{{ m.nick }}</span>
          <span class="muted small">ID: {{ m.user_id }} · {{ roleLabel(m.role) }}</span>
        </div>
        <span class="status" :class="{ online: m.online }">{{ m.online ? 'Онлайн' : 'Офлайн' }}</span>
        <div v-if="modTarget === m.user_id" class="mod-box">
          <input v-model="modReason" placeholder="Причина" />
          <div class="row">
            <button v-if="canKick" class="danger" @click="kick(m.user_id, m.nick)">Кикнуть</button>
            <button v-if="canBan" class="danger" @click="ban(m.user_id, m.nick)">Забанить</button>
            <button @click="modTarget = 0">Отмена</button>
          </div>
        </div>
        <div v-else-if="(canKick || canBan) && m.user_id !== auth.user?.id" class="row">
          <button class="tiny" @click="modTarget = m.user_id">Кик/Бан</button>
          <select v-if="canManage" class="tiny" :value="m.role" @change="setRole(m.user_id, ($event.target as HTMLSelectElement).value as Role)">
            <option value="user">Пользователь</option>
            <option value="channel_moderator">Модератор</option>
            <option value="channel_admin">Админ канала</option>
          </select>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.members-panel {
  border-top: 1px solid var(--border);
  flex: 1;
  min-height: 120px;
  display: flex;
  flex-direction: column;
}
.members-head {
  padding: 10px 14px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  color: var(--text-dim);
  font-weight: 700;
  font-size: 13px;
  text-transform: uppercase;
}
.members-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.member {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  flex-wrap: wrap;
}
.member:hover {
  background: var(--bg3);
}
.member-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.nick {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status {
  font-size: 11px;
  color: var(--text-dim);
}
.status.online {
  color: var(--green);
}
.tiny {
  padding: 3px 8px;
  font-size: 12px;
}
.row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.mod-box {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
</style>
