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

const auth = useAuthStore()
const settings = useSettingsStore()
const channels = useChannelsStore()
const chat = useChatStore()
const calls = useCallStore()

let unsubs: (() => void)[] = []

// Применяем тему сразу (до первого рендера) и следим за переключением.
settings.applyTheme()
watch(
  () => settings.theme,
  () => settings.applyTheme(),
)

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
    c.on('message.new', (d: any) => void chat.handleNew(d)),
    c.on('message.edited', (d: any) => void chat.handleEdited(d)),
    c.on('message.deleted', (d: any) => chat.handleDeleted(d)),
    c.on('attachment.deleted', (d: any) => chat.handleAttachmentDeleted(d)),
    c.on('typing', (d: any) => chat.handleTyping(d)),
    c.on('invite.new', (d: any) => void channels.handleInviteEvent(d)),
    c.on('invite.pending', (d: any) => void channels.handleInviteEvent(d)),
    c.on('invite.updated', () => void channels.refreshInvites()),
    c.on('call.invite', (d: any) => calls.handleCallInvite(d)),
    c.on('call.started', (d: any) => calls.handleCallStarted(d.call_id)),
    c.on('call.ended', (d: any) => {
      calls.handleCallEnded(d)
      const dur = calls.callDurationText()
      if (dur && channels.currentId) {
        chat.pushSystem(channels.currentId, 'Звонок завершён, время звонка ' + dur)
      }
    }),
    c.on('call.participants', (d: any) => {
      const c2 = calls.calls.find((x) => x.id === d.call_id)
      if (c2) c2.participants = d.participants
    }),
    c.on('call.invite.timeout', (d: any) => {
      calls.stopIncoming(d.call_id)
      toast.info('Вызов не принят, звонок отклонён автоматически')
    }),
    c.on('punch', (d: any) => calls.handlePunch(d)),
    c.on('kicked', (d: any) => {
      sounds.warning()
      toast.warning(`Вас кикнули из канала: ${d.reason || 'без причины'}`)
    }),
    c.on('banned', (d: any) => {
      sounds.warning()
      toast.warning(`Вас забанили в канале: ${d.reason || 'без причины'}`)
      void channels.refresh()
    }),
    c.on('server_banned', (d: any) => {
      sounds.warning()
      toast.warning(`Вы забанены на сервере: ${d.reason || 'без причины'}`)
      auth.logout()
    }),
    c.on('channel.deleted', (d: any) => {
      calls.endAllInChannel(d.channel_id)
      void channels.refresh()
    }),
    c.on('role.changed', () => void channels.refresh()),
    c.on('member.banned', () => void channels.refresh()),
    c.on('member.unbanned', () => void channels.refresh()),
  )
}

onMounted(async () => {
  await settings.loadConfig().catch(() => undefined)
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
