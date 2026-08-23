// Каналы: список, создание, приглашения, участники, права, ключи каналов.
import { defineStore } from 'pinia'
import { useSettingsStore } from './settings'
import { toast } from 'vue-sonner'
import { useAuthStore } from './auth'
import { useChatStore } from './chat'
import { useCallStore } from './calls'
import type { Channel, ChannelMember, Invite, Role } from '../api/types'
import { getKeyStorage } from '../crypto/storage'
import { generateChannelKey, wrapChannelKey, unwrapChannelKey, generateDeviceKeys, bytesToB64, b64ToBytes } from '../crypto/crypto'

export interface KeyTarget {
  user_id: number
  device_id: string
  public_key: string
}

export const useChannelsStore = defineStore('channels', {
  state: () => ({
    channels: [] as Channel[],
    currentId: 0,
    members: [] as ChannelMember[],
    banned: [] as { user_id: number; nick: string; ban_reason: string }[],
    invites: [] as Invite[],
    deviceKeys: null as ReturnType<typeof generateDeviceKeys> | null,
    keyPollTimer: 0 as number,
  }),
  getters: {
    current(): Channel | undefined {
      return this.channels.find((c) => c.id === this.currentId)
    },
    currentRole(): Role {
      const c = this.current
      const auth = useAuthStore()
      if (auth.isServerAdmin) return 'server_admin'
      return c?.role || 'user'
    },
  },
  actions: {
    ensureDevice(): ReturnType<typeof generateDeviceKeys> {
      if (!this.deviceKeys) {
        this.deviceKeys = generateDeviceKeys()
      }
      return this.deviceKeys
    },
    async init() {
      const settings = useSettingsStore()
      const auth = useAuthStore()
      const keys = this.ensureDevice()
      await settings.api.uploadKey(keys.deviceId, bytesToB64(keys.publicKey))
      await this.refresh()
      await this.refreshInvites()
      auth.refreshUsers()
      this.startKeyPoll()
      await this.syncAllKeys()
      if (this.currentId) {
        try {
          await this.openChannel(this.currentId)
        } catch { /* канал откроется при клике */ }
      }
    },
    async refresh() {
      const settings = useSettingsStore()
      this.channels = await settings.api.listChannels()
      if (!this.currentId && this.channels.length > 0) {
        this.currentId = this.channels[0].id
      }
    },
    async refreshInvites() {
      const settings = useSettingsStore()
      this.invites = await settings.api.listInvites()
    },
    async createChannel(name: string, isPrivate: boolean): Promise<Channel> {
      const settings = useSettingsStore()
      const ch = await settings.api.createChannel(name, isPrivate)
      await this.refresh()
      this.currentId = ch.id
      await this.initChannelKey(ch.id)
      await this.openChannel(ch.id)
      return ch
    },
    async enterChannel(channelId: number) {
      const settings = useSettingsStore()
      const auth = useAuthStore()
      const ch = this.channels.find((c) => c.id === channelId)
      if (this.currentId && this.currentId !== channelId) {
        auth.centrifuge.unsubscribeChannel('channel:' + this.currentId)
      }
      if (!ch?.is_member) {
        await settings.api.joinChannel(channelId)
      }
      this.currentId = channelId
      try {
        const subRes = await settings.api.centrifugoSubscribe('channel:' + channelId)
        if (subRes?.token) {
          auth.centrifuge.subscribeChannel('channel:' + channelId, subRes.token)
        }
      } catch { /* channel subscription failed */ }
      await this.refresh()
      await this.openChannel(channelId)
    },
    async openChannel(channelId: number) {
      console.log('[channels] openChannel START', channelId)
      const settings = useSettingsStore()
      const auth = useAuthStore()
      const chat = useChatStore()
      this.currentId = channelId
      const ch = this.channels.find((c) => c.id === channelId)
      if (ch && !ch.is_member && !ch.private) {
        await settings.api.joinChannel(channelId)
        await this.refresh()
      }
      try {
        const subRes = await settings.api.centrifugoSubscribe('channel:' + channelId)
        if (subRes?.token) {
          auth.centrifuge.subscribeChannel('channel:' + channelId, subRes.token)
        }
      } catch { /* channel subscription failed */ }
      this.members = await settings.api.listMembers(channelId)
      await this.loadBanned(channelId)
      // Сначала синхронизируем ключи, потом загружаем историю —
      // иначе loadHistory не сможет расшифровать сообщения.
      try { await this.syncKeys(channelId) } catch (e) { console.error('[channels] syncKeys error:', e) }
      console.log(`[channels] openChannel ${channelId}: loading history...`)
      try { await chat.loadHistory(channelId) } catch (e) { console.error('[channels] loadHistory error:', e) }
      this.startKeyPoll()
      // Повторяем через 1 сек для быстрого распределения ключей новым участникам
      setTimeout(() => { if (this.currentId === channelId) void this.syncKeys(channelId) }, 1000)
      try {
        const calls = useCallStore()
        console.log('[channels] refreshing calls for channel', channelId)
        await calls.refresh(channelId)
        console.log('[channels] starting call poll for channel', channelId)
        calls.startCallPoll(channelId)
      } catch (e) { console.error('[channels] call error:', e) }
    },
    async loadBanned(channelId: number) {
      const settings = useSettingsStore()
      try {
        this.banned = await settings.api.listBannedMembers(channelId)
      } catch {
        this.banned = []
      }
    },
    async deleteChannel(channelId: number) {
      const settings = useSettingsStore()
      await settings.api.deleteChannel(channelId)
      const chat = useChatStore()
      const calls = useCallStore()
      chat.messages.delete(channelId)
      calls.endAllInChannel(channelId)
      await this.refresh()
    },
    async initChannelKey(channelId: number) {
      const storage = await getKeyStorage()
      const settings = useSettingsStore()
      const keys = this.ensureDevice()
      const existing = await storage.loadChannelKey(channelId)
      if (existing) return
      const key = generateChannelKey()
      await storage.saveChannelKey(channelId, key)
      try {
        const wrapped = await wrapChannelKey(key, keys.publicKey)
        await settings.api.uploadWrappedKey(channelId, Number(useAuthStore().user!.id), keys.deviceId, wrapped)
      } catch { /* ключ сохранён локально, загрузка повторится через syncKeys */ }
    },
    async syncKeys(channelId: number) {
      try {
        const storage = await getKeyStorage()
        const settings = useSettingsStore()
        const auth = useAuthStore()
        const keys = this.ensureDevice()
        const ch = this.channels.find((c) => c.id === channelId)
        const isMember = ch ? ch.is_member : this.members.some((m) => m.user_id === auth.user?.id)
        if (auth.user && isMember) {
          const res = await settings.api.getMyWrappedKey(channelId, keys.deviceId)
          if (res.wrapped_key) {
            const key = await unwrapChannelKey(b64ToBytes(res.wrapped_key), keys.privateKey)
            const hadKey = await storage.loadChannelKey(channelId)
            await storage.saveChannelKey(channelId, key)
            if (!hadKey) {
              const chat = useChatStore()
              try { await chat.loadHistory(channelId) } catch { /* ignore */ }
            }
          }
        }
        const myKey = await storage.loadChannelKey(channelId)
        if (!myKey) {
          // Ключа нет — запрашиваем у сервера, чтобы держатели ключа обернули его для нас.
          try { await settings.api.requestKey(channelId) } catch { /* ignore */ }
          return
        }
        const targets: KeyTarget[] = await settings.api.pendingKeyTargets(channelId)
        for (const target of targets) {
          if (target.user_id === auth.user?.id && target.device_id === keys.deviceId) continue
          try {
            const pub = b64ToBytes(target.public_key)
            if (pub.length !== 32) continue
            const wrapped = await wrapChannelKey(myKey, pub)
            await settings.api.uploadWrappedKey(channelId, target.user_id, target.device_id, wrapped)
          } catch (e) {
            console.error('[channels] syncKeys upload error for target', target.user_id, target.device_id, e)
          }
        }
      } catch { /* не критично */ }
    },
    async syncAllKeys() {
      for (const ch of this.channels) {
        const id = (ch.id as number)
        if (id) await this.syncKeys(id)
      }
    },
    startKeyPoll() {
      if (this.keyPollTimer) return
      this.keyPollTimer = window.setInterval(() => {
        void this.syncAllKeys()
      }, 2000)
    },
    async handleKeyNeeded(data: { channel_id: number; user_id: number; device_id: string; public_key: string }) {
      try {
        const storage = await getKeyStorage()
        const myKey = await storage.loadChannelKey(data.channel_id)
        if (!myKey) return
        const settings = useSettingsStore()
        const wrapped = await wrapChannelKey(myKey, b64ToBytes(data.public_key))
        await settings.api.uploadWrappedKey(data.channel_id, data.user_id, data.device_id, wrapped)
      } catch (e) {
        console.error('[channels] handleKeyNeeded error:', e)
      }
    },
    async handleKeyGranted(channelId: number) {
      await this.syncKeys(channelId)
    },
    async handleInviteEvent(invite: Invite) {
      const toastId = toast(`Приглашение в канал «${invite.channel_name}» от ${invite.invited_by_nick}`, {
        duration: 15000,
        action: {
          label: 'Принять',
          onClick: () => {
            void this.acceptInvite(invite.id)
            toast.dismiss(toastId)
          },
        },
      })
      await this.refreshInvites()
    },
    async acceptInvite(id: number) {
      const settings = useSettingsStore()
      await settings.api.acceptInvite(id)
      await this.refreshInvites()
      await this.refresh()
    },
    async declineInvite(id: number) {
      const settings = useSettingsStore()
      await settings.api.declineInvite(id)
      await this.refreshInvites()
    },
    async setRole(channelId: number, userId: number, role: string) {
      const settings = useSettingsStore()
      await settings.api.setRole(channelId, userId, role)
      await this.openChannel(channelId)
    },
    async ban(channelId: number, userId: number, reason: string) {
      const settings = useSettingsStore()
      await settings.api.banMember(channelId, userId, reason)
    },
    async unban(channelId: number, userId: number) {
      const settings = useSettingsStore()
      await settings.api.unbanMember(channelId, userId)
      await this.openChannel(channelId)
    },
    async kick(channelId: number, userId: number, reason: string) {
      const settings = useSettingsStore()
      await settings.api.kickMember(channelId, userId, reason)
    },
  },
})
