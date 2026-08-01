// Админ панель сервера: пользователи, роли, баны, регистрация, пароли, каналы.
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useSettingsStore } from '../stores/settings'
import { useToasts } from '../stores/toasts'
import { roleIcon } from '../utils/roles'

const emit = defineEmits<{ (e: 'close'): void }>()

const auth = useAuthStore()
const settings = useSettingsStore()
const toasts = useToasts()

const users = ref<any[]>([])
const channels = ref<any[]>([])
const registrationEnabled = ref(true)
const tab = ref<'users' | 'channels'>('users')
const bannedByChannel = ref<Record<number, any[]>>({})
const bannedOpen = ref<Record<number, boolean>>({})

const newNick = ref('')
const newPass = ref('')
const resetPass = ref<Record<number, string>>({})
const banReason = ref<Record<number, string>>({})

async function load() {
  users.value = await settings.api.adminListUsers()
  channels.value = await settings.api.adminListChannels()
}

onMounted(load)

async function loadBanned(channelId: number) {
  try {
    bannedByChannel.value[channelId] = await settings.api.listBannedMembers(channelId)
  } catch {
    bannedByChannel.value[channelId] = []
  }
}

async function toggleBanned(channelId: number) {
  bannedOpen.value[channelId] = !bannedOpen.value[channelId]
  if (bannedOpen.value[channelId]) await loadBanned(channelId)
}

async function unbanInChannel(channelId: number, userId: number, nick: string) {
  try {
    await settings.api.unbanMember(channelId, userId)
    toasts.push({ kind: 'info', text: `${nick} разбанен в канале` })
    await loadBanned(channelId)
  } catch (e: any) {
    toasts.push({ kind: 'error', text: e.message })
  }
}

async function deleteChannel(channelId: number, name: string) {
  if (!confirm(`Удалить канал «${name}»? Сообщения и звонки будут удалены.`)) return
  try {
    await settings.api.deleteChannel(channelId)
    toasts.push({ kind: 'info', text: `Канал «${name}» удалён` })
    await load()
  } catch (e: any) {
    toasts.push({ kind: 'error', text: e.message })
  }
}

async function createUser() {
  if (!newNick.value.trim() || !newPass.value) {
    toasts.push({ kind: 'warning', text: 'Укажите ник и пароль' })
    return
  }
  try {
    await settings.api.adminCreateUser(newNick.value.trim(), newPass.value)
    newNick.value = ''
    newPass.value = ''
    toasts.push({ kind: 'info', text: 'Пользователь создан' })
    await load()
  } catch (e: any) {
    toasts.push({ kind: 'error', text: e.message })
  }
}

async function resetPassword(u: any) {
  const pw = resetPass.value[u.id]
  if (!pw) return
  try {
    await settings.api.adminResetPassword(u.id, pw)
    resetPass.value[u.id] = ''
    toasts.push({ kind: 'info', text: `Пароль ${u.nick} обновлён` })
  } catch (e: any) {
    toasts.push({ kind: 'error', text: e.message })
  }
}

async function toggleBan(u: any) {
  try {
    if (u.server_banned) {
      await settings.api.adminServerUnban(u.id)
      toasts.push({ kind: 'info', text: `${u.nick} разбанен` })
    } else {
      const reason = banReason.value[u.id]
      await settings.api.adminServerBan(u.id, reason || '')
      toasts.push({ kind: 'info', text: `${u.nick} забанен на сервере` })
    }
    await load()
  } catch (e: any) {
    toasts.push({ kind: 'error', text: e.message })
  }
}

async function toggleRegistration() {
  await settings.api.adminSetRegistration(registrationEnabled.value)
  toasts.push({ kind: 'info', text: registrationEnabled.value ? 'Регистрация включена' : 'Регистрация запрещена' })
}

function copyId(u: any) {
  navigator.clipboard?.writeText(String(u.id)).catch(() => undefined)
  toasts.push({ kind: 'info', text: `ID ${u.id} скопирован` })
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal admin">
      <h2>Админ панель сервера</h2>
      <div class="tabs">
        <button :class="{ active: tab === 'users' }" @click="tab = 'users'">Пользователи</button>
        <button :class="{ active: tab === 'channels' }" @click="tab = 'channels'">Каналы</button>
      </div>

      <div v-if="tab === 'users'">
        <div class="reg-toggle">
          <label class="check">
            <input v-model="registrationEnabled" type="checkbox" @change="toggleRegistration" />
            Разрешить регистрацию новых пользователей
          </label>
        </div>

        <div class="create-user frame">
          <p class="section-title">Ручная регистрация</p>
          <div class="row">
            <input v-model="newNick" placeholder="Ник" />
            <input v-model="newPass" type="password" placeholder="Пароль (мин. 12 символов)" />
            <button class="primary" @click="createUser">Создать</button>
          </div>
        </div>

        <div class="user-list">
          <div v-for="u in users" :key="u.id" class="user-card frame">
            <div class="user-head">
              <span class="role-icon">{{ roleIcon(u) }}</span>
              <b>{{ u.nick }}</b>
              <span class="badge" :class="u.is_server_admin ? 'admin' : u.server_banned ? 'banned' : ''">
                {{ u.is_server_admin ? 'Админ сервера' : u.server_banned ? 'Бан' : '' }}
              </span>
              <span class="muted small">ID: {{ u.id }}</span>
              <button class="tiny" @click="copyId(u.id)">📋</button>
              <span class="status" :class="{ online: u.online }">{{ u.online ? 'Онлайн' : 'Офлайн' }}</span>
            </div>
            <div class="user-actions">
              <div class="row">
                <input v-model="resetPass[u.id]" type="password" placeholder="Новый пароль" />
                <button class="tiny" @click="resetPassword(u)">Сбросить пароль</button>
              </div>
              <div v-if="!u.is_server_admin" class="row">
                <input v-model="banReason[u.id]" placeholder="Причина бана" />
                <button class="tiny danger" @click="toggleBan(u)">{{ u.server_banned ? 'Снять бан' : 'Бан на сервере' }}</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-else>
        <div class="user-list">
          <div v-for="c in channels" :key="c.id" class="channel-card frame">
            <span class="channel-icon">{{ c.private ? '🔒' : '#' }}</span>
            <b>{{ c.name }}</b>
            <span class="muted small">создал: {{ c.creator_nick }} (ID {{ c.creator_id }})</span>
            <div class="row">
              <button class="tiny" @click="toggleBanned(c.id)">
                Забаненные ({{ bannedByChannel[c.id]?.length ?? 0 }})
              </button>
              <button class="tiny danger" @click="deleteChannel(c.id, c.name)">Удалить канал</button>
            </div>
            <div v-if="bannedOpen[c.id]" class="banned-list">
              <div v-for="b in bannedByChannel[c.id] || []" :key="b.user_id" class="banned-row">
                <span>{{ b.nick }}</span>
                <span class="muted small">{{ b.ban_reason || 'без причины' }}</span>
                <button class="tiny success" @click="unbanInChannel(c.id, b.user_id, b.nick)">Разбанить</button>
              </div>
              <p v-if="!(bannedByChannel[c.id] || []).length" class="muted small">Нет забаненных</p>
            </div>
          </div>
          <p v-if="channels.length === 0" class="muted">Каналов нет</p>
        </div>
      </div>

      <div class="row end">
        <button @click="emit('close')">Закрыть</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.admin {
  width: 640px;
}
.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.tabs .active {
  border-color: var(--accent);
}
.reg-toggle {
  margin-bottom: 10px;
}
.create-user {
  padding: 10px;
  margin-bottom: 10px;
}
.section-title {
  font-size: 12px;
  text-transform: uppercase;
  color: var(--text-dim);
  font-weight: 700;
  margin-bottom: 8px;
}
.row {
  display: flex;
  gap: 8px;
  margin-top: 6px;
  align-items: center;
}
.user-list {
  max-height: 380px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.user-card,
.channel-card {
  padding: 10px;
  background: var(--bg3);
}
.user-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.user-actions {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.badge.admin {
  background: var(--yellow);
  color: #000;
}
.badge.banned {
  background: var(--red);
  color: #fff;
}
.tiny {
  padding: 3px 8px;
  font-size: 12px;
}
.status {
  font-size: 12px;
  color: var(--text-dim);
  margin-left: auto;
}
.status.online {
  color: var(--green);
}
.channel-card {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.banned-list {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
}
.banned-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.banned-row .small {
  flex: 1;
}
.end {
  justify-content: flex-end;
  margin-top: 12px;
}
.check {
  display: flex;
  gap: 8px;
  align-items: center;
  color: var(--text);
}
</style>
