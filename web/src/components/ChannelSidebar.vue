// Боковая панель: каналы (с рамками), приглашения, меню сервера.
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useChannelsStore } from '../stores/channels'
import { useSettingsStore } from '../stores/settings'
import { toast } from 'vue-sonner'
import { roleIcon } from '../utils/roles'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import Avatar from './Avatar.vue'

const emit = defineEmits<{
  (e: 'open-invite'): void
  (e: 'open-call'): void
  (e: 'toggle-chat'): void
  (e: 'logout'): void
  (e: 'open-admin'): void
  (e: 'open-settings'): void
  (e: 'close'): void
}>()

const auth = useAuthStore()
const channels = useChannelsStore()

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
    toast.error(e.message)
  }
}

async function acceptInvite(id: number) {
  try {
    await channels.acceptInvite(id)
  } catch (e: any) {
    toast.error(e.message)
  }
}
async function declineInvite(id: number) {
  await channels.declineInvite(id)
}

// Смена/удаление своего аватара (ограничение сервера — 5 МБ).
async function changeAvatar(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (file.size > 5 * 1024 * 1024) {
    toast.error('Аватар слишком большой: максимум 5 МБ')
    return
  }
  try {
    await useSettingsStore().api.uploadAvatar(file)
    const me = await useSettingsStore().api.me()
    auth.user = { ...auth.user!, ...me }
    toast.info('Аватар обновлён')
  } catch (err: any) {
    toast.error(String(err?.message || err).slice(0, 150))
  } finally {
    ;(e.target as HTMLInputElement).value = ''
  }
}
async function removeAvatar() {
  try {
    await useSettingsStore().api.deleteAvatar()
    const me = await useSettingsStore().api.me()
    auth.user = { ...auth.user!, ...me }
    toast.info('Аватар удалён')
  } catch (err: any) {
    toast.error(String(err?.message || err).slice(0, 150))
  }
}
</script>

<template>
  <aside class="sidebar">
    <div class="server-head" @click="menuOpen = !menuOpen">
      <img class="server-logo" src="/logo.png" alt="Golosloom" />
      <span class="server-name">Golosloom</span>
      <span class="chevron">{{ menuOpen ? '▲' : '▼' }}</span>
      <button class="sidebar-close" title="Закрыть" @click.stop="emit('close')">✕</button>
    </div>

    <div v-if="menuOpen" class="server-menu">
      <button v-if="auth.isServerAdmin" @click="emit('open-admin')">Админ панель сервера</button>
      <button @click="showCreate = true">Создать канал</button>
      <button @click="emit('open-settings')">Настройки</button>
      <button class="danger" @click="emit('logout')">Выйти</button>
    </div>

    <div class="channel-list">
      <button class="success create-channel-btn" @click="showCreate = true">
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
        <span class="avatar-wrap" title="Сменить аватар (до 5 МБ)">
          <Avatar :user-id="auth.user?.id || 0" :nick="auth.user?.nick || '?'" :avatar="auth.user?.avatar" :size="32" />
          <label class="avatar-overlay">
            <input type="file" accept="image/*" @change="changeAvatar" />
          </label>
        </span>
        <div class="user-info">
          <b>{{ auth.user?.nick }}</b>
          <span class="muted">ID: {{ auth.user?.id }}</span>
          <button class="tiny" title="Удалить аватар" @click="removeAvatar">✕ аватар</button>
        </div>
      </div>
    </div>

    <Dialog :open="showCreate" @update:open="(o) => { if (!o) showCreate = false }">
      <DialogContent class="max-w-[420px]">
        <DialogHeader class="text-center">
          <DialogTitle class="text-center">Создать канал</DialogTitle>
        </DialogHeader>
        <div class="field modal-field">
          <label>Название</label>
          <input v-model="newChannelName" placeholder="Название канала" />
        </div>
        <label class="check create-check"><input v-model="newChannelPrivate" type="checkbox" /> Приватный канал</label>
        <div v-if="error" class="error-text">{{ error }}</div>
        <DialogFooter class="grid-cols-2">
          <Button variant="secondary" @click="showCreate = false">Отмена</Button>
          <Button @click="createChannel">Создать</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  font-weight: 600;
  border-radius: 6px;
}

.sidebar-close {
  display: none;
}

@media (max-width: 1200px) {
  .sidebar {
    width: 200px;
  }
}

/* Мобильные: сайдбар — выезжающая шторка слева (скрыта, пока не открыта). */
@media (max-width: 900px) {
  .sidebar {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    width: min(85vw, 320px);
    z-index: 95;
    transform: translateX(-105%);
    transition: transform 0.25s ease;
    border-right: 1px solid var(--border);
    border-bottom: none;
    box-shadow: 8px 0 30px rgba(0, 0, 0, 0.4);
  }
  .sidebar.drawer-open {
    transform: translateX(0);
  }
  .server-head {
    padding: 12px 14px;
  }
  .sidebar-close {
    display: block;
    background: transparent;
    color: var(--text-dim);
    padding: 2px 10px;
    min-height: 40px;
    font-size: 15px;
    margin-left: 4px;
  }
  .sidebar-close:hover {
    background: var(--bg4);
    color: var(--text);
  }
  .server-menu {
    position: static;
    z-index: auto;
  }
  .channel-list {
    flex: 1;
    max-height: none;
  }
  .invites {
    flex-direction: column;
    overflow: visible;
    border-top: 1px solid var(--border);
    padding: 8px;
  }
  .invite-card {
    flex: none;
  }
  .sidebar-footer {
    display: flex;
  }
  .empty {
    display: block;
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
.avatar-wrap {
  position: relative;
  cursor: pointer;
}
.avatar-overlay input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
  width: 100%;
  height: 100%;
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

/* Поле названия и чекбокс — по центру с одинаковыми отступами по бокам. */
.create-check {
  justify-content: center;
  margin: 0 auto;
  width: min(100%, 300px);
}
</style>
