// Корневой компонент: авторизация, WS-события, модальные уведомления.
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
  const ws = auth.ws
  unsubs.push(
    ws.on('presence', async (d: { user_id: number }) => {
      await channels.refresh()
      if (channels.currentId) {
        channels.members = await settings.api.listMembers(channels.currentId)
      }
      auth.refreshUsers()
      void d
    }),
    ws.on('message.new', (d: any) => void chat.handleNew(d)),
    ws.on('message.edited', (d: any) => void chat.handleEdited(d)),
    ws.on('message.deleted', (d: any) => chat.handleDeleted(d)),
    ws.on('invite.new', (d: any) => void channels.handleInviteEvent(d)),
    ws.on('invite.pending', (d: any) => void channels.handleInviteEvent(d)),
    ws.on('invite.updated', () => void channels.refreshInvites()),
    ws.on('call.invite', (d: any) => calls.handleCallInvite(d)),
    ws.on('call.started', (d: any) => calls.handleCallStarted(d.call_id)),
    ws.on('call.ended', (d: any) => {
      calls.handleCallEnded(d)
      // «Звонок завершён, время …» — в открытый канал.
      const dur = calls.callDurationText()
      if (dur && channels.currentId) {
        chat.pushSystem(channels.currentId, 'Звонок завершён, время звонка ' + dur)
      }
    }),
    ws.on('call.participants', (d: any) => {
      const c = calls.calls.find((x) => x.id === d.call_id)
      if (c) c.participants = d.participants
    }),
    ws.on('call.invite.timeout', (d: any) => {
      calls.stopIncoming(d.call_id)
      toast.info('Вызов не принят, звонок отклонён автоматически')
    }),
    ws.on('punch', (d: any) => calls.handlePunch(d)),
    ws.on('device.registered', () => void channels.syncAllKeys()),
    ws.on('kicked', (d: any) => {
      sounds.warning()
      toast.warning(`Вас кикнули из канала: ${d.reason || 'без причины'}`)
    }),
    ws.on('banned', (d: any) => {
      sounds.warning()
      toast.warning(`Вас забанили в канале: ${d.reason || 'без причины'}`)
      void channels.refresh()
    }),
    ws.on('server_banned', (d: any) => {
      sounds.warning()
      toast.warning(`Вы забанены на сервере: ${d.reason || 'без причины'}`)
      auth.logout()
    }),
    ws.on('channel.deleted', (d: any) => {
      calls.endAllInChannel(d.channel_id)
      void channels.refresh()
    }),
    ws.on('role.changed', () => void channels.refresh()),
    ws.on('member.banned', () => void channels.refresh()),
    ws.on('member.unbanned', () => void channels.refresh()),
    ws.on('key.needed', (d: any) => void channels.handleKeyNeeded(d)),
    ws.on('key.granted', (d: any) => void channels.handleKeyGranted(d.channel_id)),
  )
}

onMounted(async () => {
  await settings.loadConfig().catch(() => undefined)
  if (auth.token) {
    try {
      await auth.fetchMe()
      auth.connectWs()
      wireWs()
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
