// Каналы: список, создание, приглашения, участники, права, ключи каналов.
import { defineStore } from 'pinia'
import { useSettingsStore } from './settings'
import { toast } from 'vue-sonner'
import { useAuthStore } from './auth'
import { useChatStore } from './chat'
import { useCallStore } from './calls'
import type { Channel, ChannelMember, Invite, Role } from '../api/types'
import { getKeyStorage } from '../crypto/storage'
import {
  generateChannelKey,
  wrapChannelKey,
  unwrapChannelKey,
  generateDeviceKeys,
  bytesToB64,
  b64ToBytes,
  deriveKek,
  wrapWithKek,
  unwrapWithKek,
} from '../crypto/crypto'

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
      // Ключи для всех каналов: раздаём их новым устройствам, забираем свой
      // (первое устройство может быть выключено — таймер повторит позже).
      this.startKeyPoll()
      await this.syncAllKeys()
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
      const auth = useAuthStore()
      const ch = this.channels.find((c) => c.id === channelId)
      // Покидаем предыдущий канал в подписке WS (иначе будем получать
      // события всех каналов, которые когда-либо открывали).
      if (this.currentId && this.currentId !== channelId) {
        auth.ws.send('channel.leave', { channel_id: this.currentId })
      }
      if (!ch?.is_member) {
        await settings.api.joinChannel(channelId)
      }
      this.currentId = channelId
      // Подписываемся на события канала (message.new/deleted, presence
      // участников и т.д.) — без этого клиент не получает ничего.
      auth.ws.send('channel.join', { channel_id: channelId })
      await this.refresh()
      await this.openChannel(channelId)
    },
    // Открытие канала: вступление в публичный канал при необходимости,
    // загрузка участников, истории, синхронизация ключей.
    async openChannel(channelId: number) {
      const settings = useSettingsStore()
      const auth = useAuthStore()
      const chat = useChatStore()
      this.currentId = channelId
      const ch = this.channels.find((c) => c.id === channelId)
      // Публичный канал виден всем, но участником нужно стать явно.
      if (ch && !ch.is_member && !ch.private) {
        await settings.api.joinChannel(channelId)
        await this.refresh()
      }
      // Подписка на события канала (вызывается и при init(), когда канал
      // открывается автоматически).
      auth.ws.send('channel.join', { channel_id: channelId })
      this.members = await settings.api.listMembers(channelId)
      await this.loadBanned(channelId)
      await chat.loadHistory(channelId)
      await this.syncKeys(channelId)
      this.startKeyPoll()
      // Обновляем список звонков канала (кнопка «Войти в звонок» и пр.).
      try {
        await useCallStore().refresh(channelId)
      } catch {
        /* ignore */
      }
    },
    // Забаненные участники канала (для разбана).
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
      await this.uploadBackup(channelId, key)
    },
    // Ключ из пароля (KEK): из хранилища или новый (создаётся из пароля).
    async getKek(): Promise<Uint8Array | null> {
      try {
        const storage = await getKeyStorage()
        const kek = await storage.loadKek()
        if (kek) return kek
        const auth = useAuthStore()
        if (auth.password && auth.user) {
          const k = await deriveKek(auth.password, Number(auth.user.id))
          try {
            await storage.saveKek(k)
          } catch {
            /* ignore */
          }
          return k
        }
      } catch {
        /* ignore */
      }
      return null
    },
    // Парольный бэкап ключа канала (зашифрован ключом из пароля).
    // Новое устройство получит ключ без онлайн-держателя — достаточно пароля.
    async uploadBackup(channelId: number, key: Uint8Array) {
      try {
        const kek = await this.getKek()
        if (!kek) return
        const wrapped = await wrapWithKek(kek, key)
        await useSettingsStore().api.uploadKeyBackup(channelId, wrapped)
      } catch {
        /* не критично: ключ раздастся через обёртки */
      }
    },
    // Синхронизация ключей: получаем свой ключ, раздаём ключ новым устройствам.
    // ВАЖНО: сервер хранит ключ канала только в обёрнутом виде и не может сам
    // выдать его новому устройству — ключ для нового устройства оборачивает
    // другой клиент, у которого есть ключ. Поэтому синхронизация повторяется:
    // таймером (пока канал открыт), при старте и при регистрации устройства.
    async syncKeys(channelId: number) {
      try {
        const storage = await getKeyStorage()
        const settings = useSettingsStore()
        const auth = useAuthStore()
        const keys = this.ensureDevice()
        const ch = this.channels.find((c) => c.id === channelId)
        const isMember = ch ? ch.is_member : this.members.some((m) => m.user_id === auth.user?.id)
        if (auth.user && isMember) {
          // 1) Парольный бэкап: ключ канала, зашифрованный ключом из пароля.
          //    Доступен на любом устройстве с паролем — онлайн-держатель
          //    ключа не нужен (новое устройство/переустановка и т.п.).
          const kek = await this.getKek()
          if (kek) {
            try {
              const backup = await settings.api.getKeyBackup(channelId)
              if (backup?.wrapped_key) {
                const bkey = await unwrapWithKek(kek, b64ToBytes(backup.wrapped_key))
                const hadKey = await storage.loadChannelKey(channelId)
                await storage.saveChannelKey(channelId, bkey)
                // Своя обёртка для сервера: устройство становится держателем
                // (иначе ниже сработает сброс «устаревшего» локального ключа).
                try {
                  const wrapped = await wrapChannelKey(bkey, keys.publicKey)
                  await settings.api.uploadWrappedKey(channelId, auth.user!.id, keys.deviceId, wrapped)
                } catch {
                  /* ignore */
                }
                if (!hadKey) {
                  const chat = useChatStore()
                  try {
                    await chat.loadHistory(channelId)
                  } catch {
                    /* ignore */
                  }
                }
              }
            } catch {
              /* бэкапа нет или пароль не подходит — обычный поток ниже */
            }
          }
          const res = await settings.api.getMyWrappedKey(channelId, keys.deviceId)
          if (res.wrapped_key) {
            const key = await unwrapChannelKey(b64ToBytes(res.wrapped_key), keys.privateKey)
            const hadKey = await storage.loadChannelKey(channelId)
            await storage.saveChannelKey(channelId, key)
            await this.uploadBackup(channelId, key)
            if (!hadKey) {
              // Ключ только что получен — перечитываем историю, чтобы
              // расшифровать сообщения канала.
              const chat = useChatStore()
              try {
                await chat.loadHistory(channelId)
              } catch {
                /* ignore */
              }
            }
          }
        }
        const myKey = await storage.loadChannelKey(channelId)
        if (!myKey) return
        const targets: KeyTarget[] = await settings.api.pendingKeyTargets(channelId)
        for (const target of targets) {
          if (target.user_id === auth.user?.id && target.device_id === keys.deviceId) continue
          const wrapped = await wrapChannelKey(myKey, b64ToBytes(target.public_key))
          await settings.api.uploadWrappedKey(channelId, target.user_id, target.device_id, wrapped)
        }
      } catch {
        // Не критично: синхронизация повторится таймером.
      }
    },
    // Раздача/получение ключей для всех каналов (при старте и при появлении
    // нового устройства у того же пользователя).
    async syncAllKeys() {
      for (const ch of this.channels) {
        await this.syncKeys(ch.id)
      }
    },
    startKeyPoll() {
      if (this.keyPollTimer) return
      this.keyPollTimer = window.setInterval(() => {
        if (this.currentId) void this.syncKeys(this.currentId)
      }, 7000)
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
      await this.openChannel(channelId)
    },
    async kick(channelId: number, userId: number, reason: string) {
      const settings = useSettingsStore()
      await settings.api.kickMember(channelId, userId, reason)
    },
  },
})
