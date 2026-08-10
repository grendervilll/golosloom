// Участники канала: статусы, роли, ID; во время звонка — громкость и «Пнуть».
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useChannelsStore } from '../stores/channels'
import { useSettingsStore } from '../stores/settings'
import { useCallStore } from '../stores/calls'
import { toast } from 'vue-sonner'
import { roleIcon, roleLabel } from '../utils/roles'
import type { Role } from '../api/types'

defineEmits<{ (e: 'close'): void }>()

const auth = useAuthStore()
const channels = useChannelsStore()
const settings = useSettingsStore()
const calls = useCallStore()

const showMembers = ref(true)

// Список участников всегда актуален при открытии панели.
onMounted(async () => {
  if (channels.currentId) {
    try {
      channels.members = await settings.api.listMembers(channels.currentId)
      await channels.loadBanned(channels.currentId)
    } catch {
      /* ignore */
    }
  }
})
const modTarget = ref(0)
const modReason = ref('')
const canKick = computed(() => hasPerm('kick'))
const canBan = computed(() => hasPerm('ban'))
const canManage = computed(() => hasPerm('manage_members') || auth.isServerAdmin)
const inCall = computed(() => calls.connectedCallId > 0)
const inCallIds = computed(() => calls.currentCall?.participants ?? [])

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
    toast.error(e.message)
  }
}

async function kick(userId: number, nick: string) {
  if (!modReason.value.trim()) {
    toast.warning('Укажите причину кика')
    return
  }
  try {
    await channels.kick(channels.currentId, userId, modReason.value)
    toast.info(`${nick} кикнут`)
  } catch (e: any) {
    toast.error(e.message)
  }
  modTarget.value = 0
  modReason.value = ''
}

async function ban(userId: number, nick: string) {
  if (!modReason.value.trim()) {
    toast.warning('Укажите причину бана')
    return
  }
  try {
    await channels.ban(channels.currentId, userId, modReason.value)
    toast.info(`${nick} забанен`)
  } catch (e: any) {
    toast.error(e.message)
  }
  modTarget.value = 0
  modReason.value = ''
}

async function unban(userId: number, nick: string) {
  try {
    await channels.unban(channels.currentId, userId)
    toast.info(`${nick} разбанен`)
  } catch (e: any) {
    toast.error(e.message)
  }
}

function punch(userId: number) {
  void calls.punch(userId)
}

function setVolume(userId: number, v: number) {
  void calls.setParticipantVolume(userId, v)
}
</script>

<template>
  <aside class="members-panel">
    <div class="members-head">
      <span>Участники ({{ channels.members.length }})</span>
      <button class="close-btn" title="Закрыть" @click="emit('close')">✕</button>
    </div>
    <div class="members-list">
      <div v-for="m in channels.members" :key="m.user_id" class="member" :class="{ 'in-call': inCall && inCallIds.includes(m.user_id) }">
        <span class="role-icon">{{ roleIcon(undefined, m.is_server_admin ? 'server_admin' : m.role) }}</span>
        <div class="member-info">
          <span class="nick">{{ m.nick }}</span>
          <span class="muted small">ID: {{ m.user_id }} · {{ roleLabel(m.is_server_admin ? 'server_admin' : m.role) }}</span>
        </div>
        <span class="status" :class="{ online: m.online }">{{ m.online ? 'Онлайн' : 'Офлайн' }}</span>

        <div v-if="inCall && inCallIds.includes(m.user_id) && m.user_id !== auth.user?.id" class="call-actions">
          <span class="vol-label" title="Громкость">🔊</span>
          <input
            class="vol"
            type="range"
            min="0"
            max="200"
            :value="settings.volumes[m.user_id] ?? 100"
            @input="setVolume(m.user_id, Number(($event.target as HTMLInputElement).value))"
          />
          <button class="tiny" title="Пнуть" @click="punch(m.user_id)">👊</button>
        </div>

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
          <select
            v-if="canManage"
            class="tiny"
            :value="m.role"
            @change="setRole(m.user_id, ($event.target as HTMLSelectElement).value as Role)"
          >
            <option value="user">Пользователь</option>
            <option value="channel_moderator">Модератор</option>
            <option value="channel_admin">Админ канала</option>
          </select>
        </div>
      </div>

      <div v-if="canBan && channels.banned.length" class="banned-section">
        <div class="banned-head">Забаненные ({{ channels.banned.length }})</div>
        <div v-for="b in channels.banned" :key="'b' + b.user_id" class="banned-item">
          <span class="nick">{{ b.nick }}</span>
          <span class="muted small reason">{{ b.ban_reason || 'без причины' }}</span>
          <button class="tiny success" @click="unban(b.user_id, b.nick)">Разбанить</button>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.members-panel {
  width: clamp(240px, 22vw, 380px);
  min-width: 0;
  background: var(--bg2);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.members-head {
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--text-dim);
  font-weight: 700;
  font-size: 13px;
  text-transform: uppercase;
}
.close-btn {
  display: none;
  padding: 2px 8px;
}
.members-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
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
.member.in-call {
  border: 1px solid var(--green);
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
.call-actions {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
}
.vol {
  flex: 1;
  padding: 0;
  height: 20px;
}
.vol-label {
  font-size: 12px;
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
.banned-section {
  border-top: 1px solid var(--border);
  padding-top: 8px;
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.banned-head {
  font-size: 12px;
  text-transform: uppercase;
  color: var(--red);
  font-weight: 700;
}
.banned-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--bg3);
}
.banned-item .reason {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 900px) {
  .close-btn {
    display: block;
  }
  .right-col.open {
    position: fixed;
    inset: 0;
    width: 100%;
    z-index: 90;
  }
}

@media (min-width: 901px) and (max-width: 1200px) {
  .members-panel {
    width: 260px;
  }
}
</style>
