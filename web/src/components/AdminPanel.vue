// Админ панель сервера: пользователи, роли, баны, регистрация, пароли, каналы,
// файлы сервера.
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, nextTick } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useSettingsStore } from '../stores/settings'
import { toast } from 'vue-sonner'
import { roleIcon } from '../utils/roles'
import { isTextFile } from '../utils/textFile'
import TextPreview from './TextPreview.vue'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import AdminGauge from './AdminGauge.vue'
import type { AdminFile } from '../api/types'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'jump-message', payload: { channelId: number; messageId: number }): void
}>()

const tab = ref<'users' | 'channels' | 'server' | 'files'>('users')
const stats = ref<Record<string, number | string>>({})
const busy = ref(false)
let statsTimer: number | null = null

// --- Вкладка «Файлы» ---
const files = ref<AdminFile[]>([])
const fileCat = ref<'all' | 'photo' | 'video' | 'text'>('all')
const filesMenu = ref<{ x: number; y: number; file: AdminFile } | null>(null)
const filesMenuEl = ref<HTMLElement | null>(null)
const previewFile = ref<AdminFile | null>(null)

async function loadFiles() {
  try {
    files.value = await useSettingsStore().api.adminListFiles()
  } catch (e: any) {
    toast.error('Не удалось загрузить список файлов: ' + String(e?.message || e).slice(0, 120))
  }
}

function fileCatOf(f: AdminFile): 'photo' | 'video' | 'text' {
  if (f.mime.startsWith('image/')) return 'photo'
  if (f.mime.startsWith('video/')) return 'video'
  if (isTextFile(f.mime, f.filename)) return 'text'
  return 'text' // для категорий не показываем, но тип нужен
}

const filteredFiles = computed(() => {
  if (fileCat.value === 'all') return files.value
  return files.value.filter((f) => fileCatOf(f) === fileCat.value)
})

function fileUrl(id: number): string {
  return useSettingsStore().api.fileUrl(id)
}

function canPreview(f: AdminFile): boolean {
  return isTextFile(f.mime, f.filename)
}

function openFilesMenu(e: MouseEvent, f: AdminFile) {
  e.preventDefault()
  filesMenu.value = { x: e.clientX, y: e.clientY, file: f }
  void nextTick(() => {
    const el = filesMenuEl.value
    if (!el) return
    const r = el.getBoundingClientRect()
    const pad = 8
    filesMenu.value = {
      ...filesMenu.value!,
      x: Math.max(pad, Math.min(filesMenu.value!.x, window.innerWidth - r.width - pad)),
      y: Math.max(pad, Math.min(filesMenu.value!.y, window.innerHeight - r.height - pad)),
    }
  })
}

function jumpToMessage(f: AdminFile) {
  filesMenu.value = null
  emit('jump-message', { channelId: f.channel_id, messageId: f.message_id })
}

async function deleteFile(f: AdminFile) {
  filesMenu.value = null
  if (!confirm(`Удалить файл «${f.filename}» с сервера? Файл будет стёрт с диска, сообщение останется.`)) return
  try {
    await useSettingsStore().api.adminDeleteFile(f.id)
    toast.info(`Файл «${f.filename}» удалён с сервера`)
    files.value = files.value.filter((x) => x.id !== f.id)
  } catch (e: any) {
    toast.error('Не удалось удалить файл: ' + String(e?.message || e).slice(0, 120))
  }
}

function openPreview(f: AdminFile) {
  filesMenu.value = null
  previewFile.value = f
}

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' МБ'
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' КБ'
  return bytes + ' Б'
}

function fileIcon(f: AdminFile): string {
  if (f.mime.startsWith('image/')) return '🖼'
  if (f.mime.startsWith('video/')) return '🎬'
  if (isTextFile(f.mime, f.filename)) return '📄'
  return '📎'
}

function fmtBytes(n: any): string {
  const v = Number(n) || 0
  if (v < 1024) return v + ' Б'
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' КБ'
  return (v / 1024 / 1024).toFixed(1) + ' МБ'
}
function fmtUptime(sec: any): string {
  const s = Number(sec) || 0
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}д ${h}ч`
  if (h > 0) return `${h}ч ${m}м`
  return `${m}м`
}

async function loadStats() {
  try {
    stats.value = await useSettingsStore().api.adminStats()
  } catch {
    /* панель закроется — не критично */
  }
}

// Текущий статус регистрации загружается с сервера (запоминается).
async function loadRegistrationStatus() {
  try {
    const res = await useSettingsStore().api.adminGetRegistration()
    registrationEnabled.value = !!res?.enabled
  } catch {
    /* ignore */
  }
}

async function downloadBackup() {
  busy.value = true
  try {
    const blob = await useSettingsStore().api.adminBackup()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `golosloom-backup-${new Date().toISOString().slice(0, 10)}.db`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  } catch (e: any) {
    toast.error('Бэкап не удался: ' + String(e?.message || e).slice(0, 150))
  } finally {
    busy.value = false
  }
}

async function restoreBackup(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (!window.confirm('Восстановить базу данных из файла ' + file.name + '? Текущие данные будут заменены.')) {
    ;(e.target as HTMLInputElement).value = ''
    return
  }
  busy.value = true
  try {
    await useSettingsStore().api.adminRestore(file)
    toast.info('База восстановлена — перезагружаем страницу')
    setTimeout(() => window.location.reload(), 1200)
  } catch (err: any) {
    toast.error('Восстановление не удалось: ' + String(err?.message || err).slice(0, 150))
    busy.value = false
  }
}

onMounted(() => {
  if (useAuthStore().isServerAdmin) {
    void loadStats()
    void loadRegistrationStatus()
    void loadFiles()
    statsTimer = window.setInterval(() => void loadStats(), 2000)
  }
})
onUnmounted(() => {
  if (statsTimer !== null) clearInterval(statsTimer)
})

const auth = useAuthStore()
const settings = useSettingsStore()
const users = ref<any[]>([])
const channels = ref<any[]>([])
const registrationEnabled = ref(true)
const bannedByChannel = ref<Record<number, any[]>>({})
const bannedOpen = ref<Record<number, boolean>>({})
const permsOpen = ref<Record<number, boolean>>({})
const perms = ref<Record<number, any>>({})

const ROLES = [
  { id: 'user', label: 'Пользователь' },
  { id: 'channel_moderator', label: 'Модератор' },
  { id: 'channel_admin', label: 'Админ канала' },
]
const ALL_PERMS = [
  { id: 'create_channel', label: 'Создавать каналы' },
  { id: 'send_message', label: 'Писать сообщения' },
  { id: 'delete_message', label: 'Удалять сообщения' },
  { id: 'ban', label: 'Банить' },
  { id: 'kick', label: 'Кикать' },
  { id: 'invite', label: 'Приглашать' },
  { id: 'delete_channel', label: 'Удалять канал' },
  { id: 'manage_members', label: 'Управлять участниками' },
]
// Права по умолчанию (как в бэкенде).
const PERM_DEFAULTS: Record<string, string[]> = {
  user: ['create_channel', 'send_message'],
  channel_moderator: ['send_message', 'delete_message', 'ban', 'kick', 'invite'],
  channel_admin: ['send_message', 'delete_message', 'ban', 'kick', 'invite', 'delete_channel', 'manage_members'],
}

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

async function loadPerms(channelId: number) {
  try {
    perms.value[channelId] = await settings.api.getPermissions(channelId)
  } catch {
    perms.value[channelId] = {}
  }
}

async function togglePerms(channelId: number) {
  permsOpen.value[channelId] = !permsOpen.value[channelId]
  if (permsOpen.value[channelId]) await loadPerms(channelId)
}

function permAllowed(channelId: number, role: string, perm: string): boolean {
  const overrides = perms.value[channelId] || {}
  if (overrides[role] && perm in overrides[role]) return overrides[role][perm]
  return (PERM_DEFAULTS[role] || []).includes(perm)
}

async function togglePerm(channelId: number, role: string, perm: string) {
  const current = permAllowed(channelId, role, perm)
  try {
    await settings.api.setPermission(channelId, role, perm, !current)
    toast.info('Права обновлены')
    await loadPerms(channelId)
  } catch (e: any) {
    toast.error(e.message)
  }
}

async function unbanInChannel(channelId: number, userId: number, nick: string) {
  try {
    await settings.api.unbanMember(channelId, userId)
    toast.info(`${nick} разбанен в канале`)
    await loadBanned(channelId)
  } catch (e: any) {
    toast.error(e.message)
  }
}

async function deleteChannel(channelId: number, name: string) {
  if (!confirm(`Удалить канал «${name}»? Сообщения и звонки будут удалены.`)) return
  try {
    await settings.api.deleteChannel(channelId)
    toast.info(`Канал «${name}» удалён`)
    await load()
  } catch (e: any) {
    toast.error(e.message)
  }
}

async function createUser() {
  if (!newNick.value.trim() || !newPass.value) {
    toast.warning('Укажите ник и пароль')
    return
  }
  try {
    await settings.api.adminCreateUser(newNick.value.trim(), newPass.value)
    newNick.value = ''
    newPass.value = ''
    toast.info('Пользователь создан')
    await load()
  } catch (e: any) {
    toast.error(e.message)
  }
}

async function resetPassword(u: any) {
  const pw = resetPass.value[u.id]
  if (!pw) return
  try {
    await settings.api.adminResetPassword(u.id, pw)
    resetPass.value[u.id] = ''
    toast.info(`Пароль ${u.nick} обновлён`)
  } catch (e: any) {
    toast.error(e.message)
  }
}

async function toggleBan(u: any) {
  try {
    if (u.server_banned) {
      await settings.api.adminServerUnban(u.id)
      toast.info(`${u.nick} разбанен`)
    } else {
      const reason = banReason.value[u.id]
      await settings.api.adminServerBan(u.id, reason || '')
      toast.info(`${u.nick} забанен на сервере`)
    }
    await load()
  } catch (e: any) {
    toast.error(e.message)
  }
}

async function toggleRegistration() {
  busy.value = true
  try {
    const next = !registrationEnabled.value
    await settings.api.adminSetRegistration(next)
    registrationEnabled.value = next
    toast.info(next ? 'Регистрация разрешена' : 'Регистрация запрещена')
  } catch (e: any) {
    toast.error('Не удалось изменить: ' + String(e?.message || e).slice(0, 120))
  } finally {
    busy.value = false
  }
}

function copyId(u: any) {
  navigator.clipboard?.writeText(String(u.id)).catch(() => undefined)
  toast.info(`ID ${u.id} скопирован`)
}
</script>

<template>
  <Dialog v-if="auth.isServerAdmin" :open="true" @update:open="(o) => { if (!o) emit('close') }">
    <DialogContent class="max-h-[85vh] max-w-[680px] overflow-y-auto">
      <DialogHeader class="text-center">
        <DialogTitle class="text-center">Админ панель сервера</DialogTitle>
      </DialogHeader>
      <div class="tabs">
        <button :class="{ active: tab === 'users' }" @click="tab = 'users'">Пользователи</button>
        <button :class="{ active: tab === 'channels' }" @click="tab = 'channels'">Каналы</button>
        <button :class="{ active: tab === 'files' }" @click="tab = 'files'; loadFiles()">Файлы</button>
        <button :class="{ active: tab === 'server' }" @click="tab = 'server'">Сервер</button>
      </div>
      <div v-if="tab === 'server'">
        <div class="frame">
          <p class="section-title">Мониторинг</p>
          <div class="gauges">
            <AdminGauge label="ЦПУ" :percent="stats.cpu_percent" />
            <AdminGauge label="RAM" :percent="stats.ram_percent" :value="`${stats.ram_total_mb ?? '—'} МБ`" />
            <AdminGauge label="База данных" :percent="stats.db_percent" :value="fmtBytes(stats.db_size)" />
            <AdminGauge label="Память процесса" :percent="stats.mem_percent" :value="`${stats.mem_mb ?? '—'} МБ`" />
          </div>
          <div class="stats-grid">
            <div class="stat"><b>{{ stats.online ?? '—' }}</b><span>онлайн</span></div>
            <div class="stat"><b>{{ stats.users ?? '—' }}</b><span>пользователей</span></div>
            <div class="stat"><b>{{ stats.channels ?? '—' }}</b><span>каналов</span></div>
            <div class="stat"><b>{{ stats.messages ?? '—' }}</b><span>сообщений</span></div>
            <div class="stat"><b>{{ stats.calls ?? '—' }}</b><span>звонков</span></div>
            <div class="stat"><b>{{ fmtUptime(stats.uptime_sec) }}</b><span>аптайм</span></div>
          </div>
          <p class="muted small">Go {{ stats.go }} · goroutines: {{ stats.goroutines }}</p>
        </div>

        <div class="frame">
          <p class="section-title">Бэкап базы данных</p>
          <p class="muted small">Скачайте полный бэкап (все пользователи, каналы и сообщения). Для восстановления загрузите файл бэкапа — база будет заменена, страница перезагрузится.</p>
          <div class="row backup-row">
            <button class="primary" :disabled="busy" @click="downloadBackup">⬇️ Скачать бэкап</button>
            <label class="btn-file">
              ⬆️ Восстановить из файла
              <input type="file" accept=".db,.sqlite" :disabled="busy" @change="restoreBackup" />
            </label>
          </div>
          <p v-if="busy" class="muted small">Выполняется…</p>
        </div>
      </div>

      <div v-if="tab === 'files'" @click="filesMenu = null">
        <div class="file-cats">
          <button :class="{ active: fileCat === 'all' }" @click="fileCat = 'all'">Все</button>
          <button :class="{ active: fileCat === 'photo' }" @click="fileCat = 'photo'">Фото</button>
          <button :class="{ active: fileCat === 'video' }" @click="fileCat = 'video'">Видео</button>
          <button :class="{ active: fileCat === 'text' }" @click="fileCat = 'text'">Текстовые</button>
        </div>
        <div class="file-grid">
          <p v-if="filteredFiles.length === 0" class="muted center">Файлов нет</p>
          <div
            v-for="f in filteredFiles"
            :key="f.id"
            class="file-tile"
            :title="f.filename"
            @contextmenu.prevent="openFilesMenu($event, f)"
          >
            <div class="file-preview">
              <img
                v-if="f.mime.startsWith('image/')"
                class="file-thumb"
                :src="fileUrl(f.id)"
                loading="lazy"
                alt=""
              />
              <video
                v-else-if="f.mime.startsWith('video/')"
                class="file-thumb"
                :src="fileUrl(f.id)"
                muted
                preload="metadata"
              ></video>
              <span v-else class="file-ico">{{ fileIcon(f) }}</span>
            </div>
            <span class="file-name" :title="f.filename">{{ f.filename }}</span>
            <span class="file-meta">{{ fmtSize(f.size) }}</span>
            <span class="file-meta">{{ f.channel_name ? '#' + f.channel_name : 'канал удалён' }} · {{ f.sender_nick }}</span>
          </div>
        </div>
      </div>

      <div v-if="tab === 'users'">
        <div class="reg-toggle">
          <span class="reg-status" :class="registrationEnabled ? 'ok' : 'no'">
            <span class="dot"></span>
            {{ registrationEnabled ? 'Разрешено' : 'Запрещено' }}
          </span>
          <button class="primary" :disabled="busy" @click="toggleRegistration">
            {{ registrationEnabled ? 'Запретить регистрацию' : 'Разрешить регистрацию' }}
          </button>
          <p class="muted small">Когда регистрация запрещена, новые пользователи входят только по одноразовому приглашению (действует 5 минут).</p>
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
              <button class="tiny" @click="togglePerms(c.id)">Права групп</button>
              <button class="tiny danger" @click="deleteChannel(c.id, c.name)">Удалить канал</button>
            </div>
            <div v-if="permsOpen[c.id]" class="perms-box">
              <p class="section-title">Права групп в канале</p>
              <div v-for="r in ROLES" :key="r.id" class="perm-role">
                <b>{{ r.label }}</b>
                <div class="perm-grid">
                  <label v-for="p in ALL_PERMS" :key="r.id + p.id" class="perm-item">
                    <input type="checkbox" :checked="permAllowed(c.id, r.id, p.id)" @change="togglePerm(c.id, r.id, p.id)" />
                    <span>{{ p.label }}</span>
                  </label>
                </div>
              </div>
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

      <!-- ПКМ-меню файла: переход к сообщению / показать / удалить. -->
      <div
        v-if="filesMenu"
        ref="filesMenuEl"
        class="files-ctx"
        :style="{ left: filesMenu.x + 'px', top: filesMenu.y + 'px' }"
        @click.stop
      >
        <button @click="jumpToMessage(filesMenu.file)">Перейти к сообщению</button>
        <button v-if="canPreview(filesMenu.file)" @click="openPreview(filesMenu.file)">Показать</button>
        <button class="danger" @click="deleteFile(filesMenu.file)">Удалить</button>
      </div>

      <DialogFooter class="grid-cols-1">
        <Button variant="secondary" @click="emit('close')">Закрыть</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
  <TextPreview
    v-if="previewFile"
    :src="fileUrl(previewFile.id)"
    :filename="previewFile.filename"
    @close="previewFile = null"
  />
</template>

<style scoped>
.tabs {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 12px;
  padding: 0 12px;
}
.tabs button {
  border-radius: 6px;
  font-weight: 600;
}
.tabs .active {
  background: var(--accent);
  color: #fff;
}
.tabs .active:hover:not(:disabled) {
  background: var(--accent-hover);
}
/* Вкладка «Файлы»: категории, сетка превью, ПКМ-меню. */
.file-cats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 10px;
  padding: 0 12px;
}
.file-cats button {
  border-radius: 6px;
  font-weight: 600;
  font-size: 13px;
}
.file-cats .active {
  background: var(--accent);
  color: #fff;
}
.file-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 8px;
  max-height: 46vh;
  overflow-y: auto;
  padding: 0 12px 8px;
}
.file-tile {
  display: flex;
  flex-direction: column;
  gap: 3px;
  border-radius: 10px;
  padding: 6px;
  background: var(--bg3);
  cursor: context-menu;
  min-width: 0;
}
.file-tile:hover {
  background: var(--bg4);
}
.file-preview {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
}
.file-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.file-ico {
  font-size: 28px;
}
.file-name {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-meta {
  font-size: 10.5px;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.center {
  text-align: center;
  padding: 16px;
}
.files-ctx {
  position: fixed;
  z-index: 400;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 210px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
}
.files-ctx button {
  text-align: left;
  background: transparent;
  border-radius: 6px;
  font-size: 13px;
  padding: 8px 10px;
}
.files-ctx button:hover {
  background: var(--bg3);
}
.files-ctx button.danger {
  color: var(--red);
}
/* Рамки-блоки: текст внутри не прикасается к краям рамки.
   (user-card/channel-card/create-user задают свой паддинг ниже.) */
.frame {
  padding: 12px 16px;
}
.gauges {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
  margin-bottom: 10px;
}
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 8px;
  margin-bottom: 8px;
}
.stat {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: center;
}
.stat b {
  font-size: 16px;
}
.stat span {
  font-size: 11px;
  color: var(--text-dim);
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
  text-align: center;
}
.btn-file {
  display: inline-block;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  background: transparent;
  color: var(--text);
  text-align: center;
}
.btn-file:hover {
  background: var(--bg3);
}
.btn-file input {
  display: none;
}
.reg-toggle {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 12px;
  padding: 0 12px;
}
.reg-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 700;
  font-size: 14px;
}
.reg-status .dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}
.reg-status.ok {
  color: #4ade80;
}
.reg-status.ok .dot {
  background: #22c55e;
  box-shadow: 0 0 6px #22c55e;
}
.reg-status.no {
  color: #f87171;
}
.reg-status.no .dot {
  background: #ef4444;
  box-shadow: 0 0 6px #ef4444;
}
.row {
  display: flex;
  gap: 8px;
  margin-top: 6px;
  align-items: center;
}
.backup-row {
  justify-content: center;
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
.perms-box {
  width: 100%;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.perm-role {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.perm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 4px 10px;
}
.perm-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text);
}
.perm-item input {
  width: auto;
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
