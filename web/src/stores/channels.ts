// Каналы: список, создание, приглашения, участники, права.
import { defineStore } from 'pinia'
import { useSettingsStore } from './settings'
import { toast } from 'vue-sonner'
import { useAuthStore } from './auth'
import { useChatStore } from './chat'
import { useCallStore } from './calls'
import type { Channel, ChannelMember, Invite, Role } from '../api/types'

export const useChannelsStore = defineStore('channels', {
  state: () => ({
    channels: [] as Channel[],
    currentId: 0,
    members: [] as ChannelMember[],
    banned: [] as { user_id: number; nick: string; ban_reason: string }[],
    invites: [] as Invite[],
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
    async init() {
      const settings = useSettingsStore()
      const auth = useAuthStore()
      await this.refresh()
      await this.refreshInvites()
      auth.refreshUsers()
      if (this.currentId) {
        try {
          await this.openChannel(this.currentId)
        } catch {
          /* канал откроется при клике */
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
      await this.refresh()
      this.currentId = ch.id
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
      await chat.loadHistory(channelId)
      try {
        await useCallStore().refresh(channelId)
      } catch { /* ignore */ }
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
