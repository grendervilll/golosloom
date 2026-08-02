// Боковая панель: каналы (с рамками), приглашения, меню сервера.
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useChannelsStore } from '../stores/channels'
import { useToasts } from '../stores/toasts'
import { roleIcon } from '../utils/roles'

const emit = defineEmits<{
  (e: 'open-invite'): void
  (e: 'open-call'): void
  (e: 'toggle-chat'): void
  (e: 'logout'): void
  (e: 'open-admin'): void
  (e: 'open-settings'): void
}>()

const auth = useAuthStore()
const channels = useChannelsStore()
const toasts = useToasts()

const menuOpen = ref(false)
const newChannelName = ref('')
const newChannelPrivate = ref(false)
const showCreate = ref(false)
const error = ref('')

const sortedChannels = computed(() => [...channels.channels].sort((a, b) => a.id - b.id))

async function select(id: number) {
  await channels.enterChannel(id)
}

async function createChannel() {
  error.value = ''
  if (!newChannelName.value.trim()) {
    error.value = 'Введите название канала'
    return
  }
  try {
    const ch = await channels.createChannel(newChannelName.value.trim(), newChannelPrivate.value)
    newChannelName.value = ''
    showCreate.value = false
    await select(ch.id)
  } catch (e: any) {
    error.value = e.message
  }
}

async function deleteCurrent() {
  const ch = channels.current
  if (!ch) return
  if (!confirm(`Удалить канал «${ch.name}»?`)) return
  try {
    await channels.deleteChannel(ch.id)
  } catch (e: any) {
    toasts.push({ kind: 'error', text: e.message })
  }
}

async function acceptInvite(id: number) {
  try {
    await channels.acceptInvite(id)
  } catch (e: any) {
    toasts.push({ kind: 'error', text: e.message })
  }
}
async function declineInvite(id: number) {
  await channels.declineInvite(id)
}
</script>

<template>
  <aside class="sidebar">
    <div class="server-head" @click="menuOpen = !menuOpen">
      <img class="server-logo" src="/logo.png" alt="Golosloom" />
      <span class="server-name">Golosloom</span>
      <span class="chevron">{{ menuOpen ? '▲' : '▼' }}</span>
    </div>

    <div v-if="menuOpen" class="server-menu">
      <button v-if="auth.isServerAdmin" @click="emit('open-admin')">Админ панель сервера</button>
      <button @click="showCreate = true">Создать канал</button>
      <button @click="emit('open-settings')">Настройки</button>
      <button class="danger" @click="emit('logout')">Выйти</button>
    </div>

    <div class="channel-list">
      <button class="create-channel-btn" @click="showCreate = true">
        <span>➕</span> Создать канал
      </button>
      <div v-for="ch in sortedChannels" :key="ch.id" class="frame channel-item" :class="{ active: ch.id === channels.currentId }" @click="select(ch.id)">
        <span class="channel-icon">{{ ch.private ? '🔒' : '#' }}</span>
        <span class="channel-name">{{ ch.name }}</span>
        <span v-if="ch.private && !ch.is_member" class="badge">приватный</span>
      </div>
      <p v-if="sortedChannels.length === 0" class="muted empty">Каналов пока нет</p>
    </div>

    <div v-if="channels.invites.length" class="invites">
      <p class="section-title">Приглашения</p>
      <div v-for="inv in channels.invites" :key="inv.id" class="invite-card frame">
        <p>{{ inv.channel_name }}</p>
        <p class="muted">от {{ inv.invited_by_nick }}</p>
        <div class="row">
          <button class="success" @click="acceptInvite(inv.id)">Принять</button>
          <button @click="declineInvite(inv.id)">Отклонить</button>
        </div>
      </div>
    </div>

    <div class="sidebar-footer">
      <div class="user-chip">
        <span class="role-icon">{{ roleIcon(auth.user) }}</span>
        <div class="user-info">
          <b>{{ auth.user?.nick }}</b>
          <span class="muted">ID: {{ auth.user?.id }}</span>
        </div>
      </div>
    </div>

    <div v-if="showCreate" class="modal-backdrop" @click.self="showCreate = false">
      <div class="modal">
        <h2>Создать канал</h2>
        <div class="field">
          <label>Название</label>
          <input v-model="newChannelName" placeholder="Название канала" />
        </div>
        <label class="check"><input v-model="newChannelPrivate" type="checkbox" /> Приватный канал</label>
        <div v-if="error" class="error-text">{{ error }}</div>
        <div class="row" style="margin-top: 14px">
          <button class="primary" @click="createChannel">Создать</button>
          <button @click="showCreate = false">Отмена</button>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: clamp(200px, 18vw, 320px);
  min-width: 0;
  background: var(--bg2);
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
}
.server-head {
  padding: 14px;
  background: var(--bg3);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 700;
}
.server-logo {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  object-fit: cover;
  flex-shrink: 0;
}
.server-name {
  flex: 1;
}
.server-menu {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  background: var(--bg);
}
.channel-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.channel-item {
  padding: 10px 12px;
  cursor: pointer;
  display: flex;
  gap: 8px;
  align-items: center;
  background: var(--bg3);
}
.channel-item.active {
  border-color: var(--accent);
  background: var(--bg4);
}
.channel-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.empty {
  padding: 12px;
  text-align: center;
}
.create-channel-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  margin-bottom: 4px;
  background: var(--accent);
  color: #fff;
  font-weight: 600;
}
.create-channel-btn:hover {
  background: var(--accent-hover);
}

@media (max-width: 1200px) {
  .sidebar {
    width: 200px;
  }
}

/* Мобильный режим: сайдбар — верхняя панель, каналы — вертикальный список. */
@media (max-width: 900px) {
  .sidebar {
    position: relative;
    width: 100%;
    min-width: 0;
    flex-direction: row;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    padding: 6px 10px;
    border-right: none;
    border-bottom: 1px solid var(--border);
  }
  .server-head {
    padding: 6px 10px;
    flex: 0 0 auto;
  }
  .server-menu {
    position: absolute;
    top: 100%;
    left: 8px;
    right: 8px;
    z-index: 95;
  }
  .channel-list {
    flex: 1 1 100%;
    flex-direction: column;
    align-items: stretch;
    overflow-y: auto;
    max-height: 42vh;
    padding: 4px 2px 6px;
    min-width: 0;
  }
  .channel-item {
    flex: none;
    width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .create-channel-btn {
    width: 100%;
    flex: none;
    margin-bottom: 0;
    padding: 8px 10px;
  }
  .invites {
    flex-direction: row;
    overflow-x: auto;
    border-top: none;
    padding: 0;
  }
  .invite-card {
    flex: 0 0 auto;
  }
  .sidebar-footer {
    display: none;
  }
  .empty {
    display: none;
  }
}
.invites {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid var(--border);
}
.section-title {
  font-size: 12px;
  text-transform: uppercase;
  color: var(--text-dim);
  font-weight: 700;
}
.invite-card {
  padding: 10px;
  background: var(--bg3);
}
.row {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.sidebar-footer {
  padding: 10px;
  background: var(--bg3);
}
.user-chip {
  display: flex;
  align-items: center;
  gap: 8px;
}
.user-info {
  display: flex;
  flex-direction: column;
  font-size: 13px;
}
.check {
  display: flex;
  gap: 8px;
  align-items: center;
  color: var(--text-dim);
  font-size: 14px;
}
</style>
