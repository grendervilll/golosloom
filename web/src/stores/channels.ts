// Каналы: список, создание, приглашения, участники, права, ключи каналов.
import { defineStore } from 'pinia'
import { useSettingsStore } from './settings'
import { useAuthStore } from './auth'
import { useChatStore } from './chat'
import { useCallStore } from './calls'
import { useToasts } from './toasts'
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
    invites: [] as Invite[],
    deviceKeys: null as ReturnType<typeof generateDeviceKeys> | null,
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
      if (this.currentId) {
        try {
          await this.openChannel(this.currentId)
        } catch {
          // Канал откроется при клике на него; вход не должен падать.
        }
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
      // Создатель уже участник канала — «вход» по приглашению не нужен
      // (для приватного канала joinChannel вернул бы 403).
      await this.refresh()
      this.currentId = ch.id
      await this.initChannelKey(ch.id)
      await this.openChannel(ch.id)
      return ch
    },
    async enterChannel(channelId: number) {
      const settings = useSettingsStore()
      const ch = this.channels.find((c) => c.id === channelId)
      if (!ch?.is_member) {
        await settings.api.joinChannel(channelId)
      }
      this.currentId = channelId
      await this.refresh()
      await this.openChannel(channelId)
    },
    // Открытие канала: вступление в публичный канал при необходимости,
    // загрузка участников, истории, синхронизация ключей.
    async openChannel(channelId: number) {
      const settings = useSettingsStore()
      const chat = useChatStore()
      this.currentId = channelId
      const ch = this.channels.find((c) => c.id === channelId)
      // Публичный канал виден всем, но участником нужно стать явно.
      if (ch && !ch.is_member && !ch.private) {
        await settings.api.joinChannel(channelId)
        await this.refresh()
      }
      this.members = await settings.api.listMembers(channelId)
      await chat.loadHistory(channelId)
      await this.syncKeys(channelId)
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
    // Создание ключа канала (создатель) или получение своего обёрнутого ключа.
    async initChannelKey(channelId: number) {
      const storage = await getKeyStorage()
      const settings = useSettingsStore()
      const keys = this.ensureDevice()
      const existing = await storage.loadChannelKey(channelId)
      if (existing) return
      const key = generateChannelKey()
      const wrapped = await wrapChannelKey(key, keys.publicKey)
      await settings.api.uploadWrappedKey(channelId, Number(useAuthStore().user!.id), keys.deviceId, wrapped)
      await storage.saveChannelKey(channelId, key)
    },
    // Синхронизация ключей: получаем свой ключ, раздаём ключ новым устройствам.
    async syncKeys(channelId: number) {
      const storage = await getKeyStorage()
      const settings = useSettingsStore()
      const auth = useAuthStore()
      const keys = this.ensureDevice()
      if (auth.user && this.members.some((m) => m.user_id === auth.user!.id)) {
        const res = await settings.api.getMyWrappedKey(channelId, keys.deviceId)
        if (res.wrapped_key) {
          const key = await unwrapChannelKey(b64ToBytes(res.wrapped_key), keys.privateKey)
          await storage.saveChannelKey(channelId, key)
        }
      }
      const myKey = await storage.loadChannelKey(channelId)
      if (!myKey) return
      const targets: KeyTarget[] = await settings.api.pendingKeyTargets(channelId)
      for (const target of targets) {
        if (target.user_id === auth.user!.id && target.device_id === keys.deviceId) continue
        const wrapped = await wrapChannelKey(myKey, b64ToBytes(target.public_key))
        await settings.api.uploadWrappedKey(channelId, target.user_id, target.device_id, wrapped)
      }
    },
    async handleInviteEvent(invite: Invite) {
      const toasts = useToasts()
      toasts.push({
        kind: 'invite',
        text: `Приглашение в канал «${invite.channel_name}» от ${invite.invited_by_nick}`,
        inviteId: invite.id,
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
    async handleKeyNeeded(data: { channel_id: number; user_id: number; device_id: string; public_key: string }) {
      if (data.channel_id !== this.currentId) return
      const storage = await getKeyStorage()
      const myKey = await storage.loadChannelKey(data.channel_id)
      if (!myKey) return
      const settings = useSettingsStore()
      const wrapped = await wrapChannelKey(myKey, b64ToBytes(data.public_key))
      await settings.api.uploadWrappedKey(data.channel_id, data.user_id, data.device_id, wrapped)
    },
    async handleKeyGranted(channelId: number) {
      if (channelId === this.currentId) await this.syncKeys(channelId)
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
    },
    async kick(channelId: number, userId: number, reason: string) {
      const settings = useSettingsStore()
      await settings.api.kickMember(channelId, userId)
    },
  },
})
