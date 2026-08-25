// Корневой компонент: авторизация, Centrifugo-события, модальные уведомления.
<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
import { useAuthStore } from './stores/auth'
import { useSettingsStore } from './stores/settings'
import { useChannelsStore } from './stores/channels'
import { useChatStore } from './stores/chat'
import { useCallStore } from './stores/calls'
import { toast } from 'vue-sonner'
import { sounds } from './audio/sounds'
import { Toaster } from './components/ui/sonner'
import { showElectronNotification, shouldShowNotification, onElectronNotificationClicked, isElectron } from './utils/electronPush'

const auth = useAuthStore()
const settings = useSettingsStore()
const channels = useChannelsStore()
const chat = useChatStore()
const calls = useCallStore()

let unsubs: (() => void)[] = []
let electronUnsub: (() => void) | null = null

// Применяем тему сразу (до первого рендера) и следим за переключением.
settings.applyTheme()
watch(
  () => settings.theme,
  () => settings.applyTheme(),
)

function notifyElectron(title: string, body: string, tag?: string) {
  if (!isElectron()) return
  // Для сообщений — не спамим, если смотришь этот канал и окно в фокусе
  if (tag?.startsWith('ch-')) {
    const chId = parseInt(tag.slice(3), 10)
    if (!shouldShowNotification() && channels.currentId === chId) return
  } else if (!shouldShowNotification()) {
    // Для системных — тоже проверяем, но звонки важнее — показываем всегда
    if (!tag?.startsWith('call-') && !tag?.startsWith('invite-')) return
  }
  void showElectronNotification(title, body, tag)
}

async function subscribeRingtone() {
  try {
    const res = await settings.api.centrifugoSubscribe('ringtone')
    const token = (res as any)?.token
    if (token) await auth.centrifuge.subscribeChannel('ringtone', token)
  } catch {}
}

function wireWs() {
  unsubs.forEach((u) => u())
  unsubs = []
  const c = auth.centrifuge
  unsubs.push(
    c.on('presence', async (d: { user_id: number }) => {
      await channels.refresh()
      if (channels.currentId) {
        channels.members = await settings.api.listMembers(channels.currentId)
      }
      auth.refreshUsers()
      void d
    }),
    c.on('message.new', (d: any) => {
      void chat.handleNew(d)
      const chId = d.channel_id as number
      const isSelf = d.sender_id === auth.user?.id
      if (!isSelf) {
        const chName = channels.channels.find((x) => x.id === chId)?.name || 'канале'
        notifyElectron(`💬 ${d.sender_nick || 'Новое сообщение'}`, `Новое сообщение в «${chName}»`, `ch-${chId}`)
      }
    }),
    c.on('message.edited', (d: any) => void chat.handleEdited(d)),
    c.on('message.deleted', (d: any) => chat.handleDeleted(d)),
    c.on('attachment.deleted', (d: any) => chat.handleAttachmentDeleted(d)),
    c.on('typing', (d: any) => chat.handleTyping(d)),
    c.on('invite.new', (d: any) => {
      void channels.handleInviteEvent(d)
      const chName = (d as any).channel_name || (d as any).channelName || ''
      notifyElectron('📨 Приглашение', chName ? `Вас пригласили в «${chName}»` : 'Вас пригласили в канал', `invite-${(d as any).id || (d as any).invite_id || Date.now()}`)
    }),
    c.on('invite.pending', (d: any) => void channels.handleInviteEvent(d)),
    c.on('invite.updated', () => void channels.refreshInvites()),
    c.on('call.invite', (d: any) => {
      calls.handleCallInvite(d)
      const chId = (d as any).channel_id
      const chName = channels.channels.find((x) => x.id === chId)?.name || ''
      const who = (d as any).initiator_nick || 'Кто-то'
      notifyElectron(`📞 ${who} звонит`, chName ? `Входящий звонок в «${chName}»` : 'Входящий звонок', `call-${(d as any).call_id || chId}`)
      sounds.playRing()
    }),
    c.on('call.started', (d: any) => calls.handleCallStarted(d.call_id)),
    c.on('call.declined', (d: any) => calls.handleCallDeclined(d)),
    c.on('call.created', () => calls.handleCallCreated()),
    c.on('call.ended', (d: any) => {
      const startAt = calls.connectedAt
      const startStr = startAt ? new Date(startAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : null
      const endStr = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
      const dur = calls.callDurationText()
      const call = calls.calls.find((x) => x.id === d.call_id)
      const channelId = (call?.channel_id as number) || channels.currentId || (d as any).channel_id
      calls.handleCallEnded(d)
      if (channelId) {
        let text: string
        if (startStr && endStr && dur) {
          text = `Звонок: ${startStr} — ${endStr} (${dur})`
        } else if (dur) {
          text = `Звонок завершён, длительность ${dur}`
        } else if (startStr) {
          text = `Звонок завершён в ${endStr}, начался в ${startStr}`
        } else {
          text = `Звонок завершён в ${endStr}`
        }
        // Если звонок не был отвечен (нет connectedAt и нет длительности) — показываем "не отвечен"
        if (!startAt && !dur) {
          const chName = channels.channels.find((c) => c.id === channelId)?.name || ''
          text = chName ? `Пропущенный звонок в «${chName}» в ${endStr}` : `Пропущенный звонок в ${endStr}`
        }
        chat.pushSystem(channelId, text)
        notifyElectron('📞 Звонок завершён', text, `ch-${channelId}`)
      }
    }),
    c.on('call.participants', (d: any) => {
      const c2 = calls.calls.find((x) => x.id === d.call_id)
      if (c2) c2.participants = d.participants
    }),
    c.on('call.invite.timeout', (d: any) => {
      // Для исходящего — гасит гудки, для входящего — гасит звонок.
      calls.handleInviteTimeout(d.call_id)
      toast.info('Вызов не принят, звонок отклонён автоматически')
      notifyElectron('⏰ Вызов не принят', 'Звонок отклонён автоматически', `call-${d.call_id}`)
    }),
    c.on('punch', (d: any) => {
      calls.handlePunch(d)
      const who = (d as any).from_nick || (d as any).nick || 'Кто-то'
      notifyElectron('👊 Толчок', `${who} толкнул вас`, `ch-${(d as any).channel_id || channels.currentId || ''}`)
    }),
    c.on('device.registered', () => void channels.syncAllKeys()),
    c.on('kicked', (d: any) => {
      sounds.warning()
      toast.warning(`Вас кикнули из канала: ${d.reason || 'без причины'}`)
      notifyElectron('⚠️ Кик', `Вас кикнули из канала`, `ch-${(d as any).channel_id || ''}`)
    }),
    c.on('banned', (d: any) => {
      sounds.warning()
      toast.warning(`Вас забанили в канале: ${d.reason || 'без причины'}`)
      void channels.refresh()
      notifyElectron('⛔ Бан', `Вас забанили в канале`, `ch-${(d as any).channel_id || ''}`)
    }),
    c.on('server_banned', (d: any) => {
      sounds.warning()
      toast.warning(`Вы забанены на сервере: ${d.reason || 'без причины'}`)
      notifyElectron('⛔ Бан на сервере', `Вы забанены: ${d.reason || ''}`, 'server-banned')
      auth.logout()
    }),
    c.on('channel.deleted', (d: any) => {
      calls.endAllInChannel(d.channel_id)
      void channels.refresh()
      notifyElectron('🗑️ Канал удалён', 'Канал был удалён', `ch-${d.channel_id}`)
    }),
    c.on('role.changed', () => void channels.refresh()),
    c.on('member.banned', () => void channels.refresh()),
    c.on('member.unbanned', () => void channels.refresh()),
    c.on('key.needed', (d: any) => void channels.handleKeyNeeded(d)),
    c.on('key.granted', (d: any) => void channels.handleKeyGranted(d.channel_id)),
    c.on('ringtone.updated', (d: any) => {
      sounds.handleRingtoneUpdated(d)
      // Также показываем тост, если не Electron
      if (!isElectron()) toast.info('Мелодия звонка обновлена')
    }),
  )
}

onMounted(async () => {
  await settings.loadConfig().catch(() => undefined)
  // Electron: клик по системному уведомлению — фокус окна и переход к каналу
  if (isElectron()) {
    electronUnsub = onElectronNotificationClicked((tag) => {
      if (tag.startsWith('ch-')) {
        const id = parseInt(tag.slice(3), 10)
        if (id && channels.currentId !== id) {
          void channels.openChannel(id)
        }
      }
    })
  }
  // Токен живёт сутки: при 401 (истёк/сменили пароль) — на экран входа.
  settings.api.onUnauthorized = () => {
    auth.logout()
    if (!window.location.hash.startsWith('#/login')) window.location.hash = '#/login'
  }
  if (auth.token) {
    try {
      await auth.fetchMe()
      auth.connect()
      wireWs()
      // Короткоживущий файловый токен: в URL файлов не попадает основной JWT.
      settings.api.setToken(auth.token)
      settings.api.startFileTokenRefresh()
      // Загружаем кастомный рингтон сервера (если админ установил) и подписываемся на обновления
      void sounds.loadCustomRingtone()
      void subscribeRingtone()
    } catch {
      auth.logout()
      return
    }
    await channels.init().catch(() => undefined)
  }
})

watch(
  () => auth.connected,
  (connected) => {
    if (connected) wireWs()
  },
)

onUnmounted(() => {
  electronUnsub?.()
  unsubs.forEach((u) => u())
})
</script>

<template>
  <div class="app-root">
    <RouterView />
  </div>
  <!-- Toaster вне .app-root: его <section> в потоке документа, и правило
       .app-root > * { flex: 1 } сжимало бы интерфейс влево. -->
  <Toaster :theme="settings.theme" position="top-right" :close-button="true" rich-colors />
</template>
