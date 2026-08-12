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
const avatarInput = ref<HTMLInputElement | null>(null)
const avatarMenuOpen = ref(false)

function closeAvatarMenu() {
  avatarMenuOpen.value = false
}
function openAvatarMenu() {
  avatarMenuOpen.value = !avatarMenuOpen.value
}
// Клик мимо — закрываем меню аватара.
window.addEventListener('click', closeAvatarMenu)
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
function onAvatarMenu(action: string) {
  avatarMenuOpen.value = false
  if (action === 'set') {
    avatarInput.value?.click()
  } else if (action === 'remove') {
    if (!auth.user?.avatar) {
      toast.error('У вас не установлен аватар')
      return
    }
    void removeAvatar()
  }
}

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
      <button class="sidebar-close" title="Закрыть" @click.stop="emit('close')">
        <svg class="ico" viewBox="0 0 384 512"><path d="M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z" /></svg>
      </button>
    </div>

    <div v-if="menuOpen" class="server-menu">
      <button v-if="auth.isServerAdmin" @click="emit('open-admin')">
        <svg class="ico" viewBox="0 0 512 512"><path d="M256 0c4.6 0 9.2 1 13.4 2.9L457.7 82.8c22 9.3 38.4 31 38.3 57.2c-.5 99.2-41.3 280.7-213.6 363.2c-16.7 8-36.1 8-52.8 0C57.3 420.7 16.5 239.2 16 140c-.1-26.2 16.3-47.9 38.3-57.2L242.7 2.9C246.8 1 251.4 0 256 0zm0 66.8l0 378.1C394 378 431.1 230.1 432 141.4L256 66.8s0 0 0 0z" /></svg>
        Админ панель сервера
      </button>
      <button @click="showCreate = true">
        <svg class="ico" viewBox="0 0 448 512"><path d="M256 80c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 144L48 224c-17.7 0-32 14.3-32 32s14.3 32 32 32l144 0 0 144c0 17.7 14.3 32 32 32s32-14.3 32-32l0-144 144 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-144 0 0-144z" /></svg>
        Создать канал
      </button>
      <button @click="emit('open-settings')">
        <svg class="ico" viewBox="0 0 512 512"><path d="M495.9 166.6c3.2 8.7 .5 18.4-6.4 24.6l-43.3 39.4c1.1 8.3 1.7 16.8 1.7 25.4s-.6 17.1-1.7 25.4l43.3 39.4c6.9 6.2 9.6 15.9 6.4 24.6c-4.4 11.9-9.7 23.3-15.8 34.3l-4.7 8.1c-6.6 11-14 21.4-22.1 31.2c-5.9 7.2-15.7 9.6-24.5 6.8l-55.7-17.7c-13.4 10.3-28.2 18.9-44 25.4l-12.5 57.1c-2 9.1-9.3 15.9-18.6 15.9l-84.1 0c-9.3 0-16.6-6.8-18.6-15.9l-12.5-57.1c-15.8-6.6-30.6-15.2-44-25.4l-55.7 17.7c-8.8 2.8-18.6.4-24.5-6.8c-8.1-9.8-15.5-20.2-22.1-31.2l-4.7-8.1c-6.1-11-11.4-22.4-15.8-34.3c-3.2-8.7-.5-18.4 6.4-24.6l43.3-39.4C92.6 273.1 92 264.6 92 256s.6-17.1 1.7-25.4l-43.3-39.4c-6.9-6.2-9.6-15.9-6.4-24.6c4.4-11.9 9.7-23.3 15.8-34.3l4.7-8.1c6.6-11 14-21.4 22.1-31.2c5.9-7.2 15.7-9.6 24.5-6.8l55.7 17.7c13.4-10.3 28.2-18.9 44-25.4l12.5-57.1c2-9.1 9.3-15.9 18.6-15.9l84.1 0c9.3 0 16.6 6.8 18.6 15.9l12.5 57.1c15.8 6.6 30.6 15.2 44 25.4l55.7-17.7c8.8-2.8 18.6-.4 24.5 6.8c8.1 9.8 15.5 20.2 22.1 31.2l4.7 8.1c6.1 11 11.4 22.4 15.8 34.3zM256 336a80 80 0 1 0 0-160 80 80 0 1 0 0 160z" /></svg>
        Настройки
      </button>
      <button class="danger" @click="emit('logout')">
        <svg class="ico" viewBox="0 0 512 512"><path d="M377.9 105.9L500.7 228.7c7.2 7.2 11.3 17.1 11.3 27.3s-4.1 20.1-11.3 27.3L377.9 406.1c-6.4 6.4-15 9.9-24 9.9c-18.7 0-33.9-15.2-33.9-33.9l0-62.1-128 0c-17.7 0-32-14.3-32-32l0-64c0-17.7 14.3-32 32-32l128 0 0-62.1c0-18.7 15.2-33.9 33.9-33.9c9 0 17.6 3.6 24 9.9zM160 96L96 96c-17.7 0-32 14.3-32 32l0 256c0 17.7 14.3 32 32 32l64 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-64 0c-53 0-96-43-96-96L0 128C0 75 43 32 96 32l64 0c17.7 0 32 14.3 32 32s-14.3 32-32 32z" /></svg>
        Выйти
      </button>
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
        <input ref="avatarInput" type="file" accept="image/*" class="hidden-input" @change="changeAvatar" />
        <div class="avatar-menu" @click.stop="avatarMenuOpen = !avatarMenuOpen">
          <Avatar :user-id="auth.user?.id || 0" :nick="auth.user?.nick || '?'" :avatar="auth.user?.avatar" :size="32" />
          <div v-if="avatarMenuOpen" class="avatar-dropdown" @click.stop>
            <button @click.stop="onAvatarMenu('set')">📷 Установить аватар</button>
            <button class="danger" @click.stop="onAvatarMenu('remove')">🗑 Удалить аватар</button>
          </div>
        </div>
        <div class="user-info">
          <b>{{ auth.user?.nick }}</b>
          <span class="muted">ID: {{ auth.user?.id }}</span>
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
  width: 40px;
  height: 40px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--green);
  margin: 0 auto 8px;
}
.create-channel-btn .ico {
  width: 16px;
  height: 16px;
  fill: #fff;
}
.server-menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  text-align: left;
}
.server-menu button .ico {
  width: 14px;
  height: 14px;
  fill: var(--text-dim);
}
.server-menu button.danger .ico {
  fill: var(--red);
}
.sidebar-close .ico {
  width: 14px;
  height: 14px;
  fill: var(--text-dim);
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
.avatar-menu {
  position: relative;
  display: inline-flex;
  cursor: pointer;
}
.hidden-input {
  display: none;
}
.avatar-dropdown {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 60;
  background: #111214;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 190px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}
.avatar-dropdown button {
  text-align: left;
  background: transparent;
  border-radius: 4px;
  font-size: 13px;
  padding: 8px 10px;
}
.avatar-dropdown button:hover {
  background: var(--accent);
  color: #fff;
}
.avatar-dropdown button.danger:hover {
  background: var(--red);
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
