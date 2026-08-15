// Каналы: список, создание, приглашения, участники, права, ключи каналов.
// Плюс: личные чаты (dm), сообщества (community), закрепление чатов.
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

// Закреплённые чаты: порядок = порядок отображения (localStorage).
const PINNED_KEY = 'golosloom-pinned'

function loadPinned(): number[] {
  try {
    const raw = localStorage.getItem(PINNED_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    /* ignore */
  }
  return []
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
    // Хендлер фокуса окна (раздача ключей при возврате на вкладку).
    _focusHandler: null as (() => void) | null,
    // Закреплённые чаты/каналы/сообщества в порядке отображения.
    pinned: loadPinned() as number[],
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
    // Можно ли писать в текущем канале (сообщества readonly для подписчиков).
    canPost(): boolean {
      const c = this.current
      if (!c) return true
      if (c.kind === 'community' && c.readonly) {
        const auth = useAuthStore()
        if (auth.isServerAdmin) return true
        if (this.currentRole === 'channel_admin') return true
        return c.creator_id === auth.user?.id
      }
      return true
    },
    // Видимые закреплённые чаты (в порядке закрепления).
    pinnedChannels(): Channel[] {
      const map = new Map(this.channels.map((c) => [c.id, c]))
      return this.pinned.map((id) => map.get(id)).filter((c): c is Channel => !!c)
    },
    // Остальные (незакреплённые) чаты.
    unpinnedChannels(): Channel[] {
      const pinnedSet = new Set(this.pinned)
      return this.channels.filter((c) => !pinnedSet.has(c.id))
    },
  },
  actions: {
    // --- Закрепление ---
    pinChannel(channelId: number) {
      if (this.pinned.includes(channelId)) return
      this.pinned.push(channelId)
      this.persistPinned()
    },
    unpinChannel(channelId: number) {
      this.pinned = this.pinned.filter((id) => id !== channelId)
      this.persistPinned()
    },
    // Перемещение закреплённого чата: from → to (индексы в списке закреплённых).
    movePinned(from: number, to: number) {
      if (from < 0 || to < 0 || from >= this.pinned.length || to >= this.pinned.length) return
      const arr = [...this.pinned]
      const [id] = arr.splice(from, 1)
      arr.splice(to, 0, id)
      this.pinned = arr
      this.persistPinned()
    },
    persistPinned() {
      try {
        localStorage.setItem(PINNED_KEY, JSON.stringify(this.pinned))
      } catch {
        /* ignore */
      }
    },
    // Устройство (ключевая пара) сохраняется в хранилище: при каждом запуске
    // (особенно в Tauri) не создаётся новое устройство, а переиспользуется
    // старое — иначе ключи личных чатов/сообществ приходится раздавать
    // заново, пока держатель ключа не в сети.
    async ensureDevice(): Promise<ReturnType<typeof generateDeviceKeys>> {
      if (!this.deviceKeys) {
        const storage = await getKeyStorage()
        const saved = await storage.loadDevice()
        if (saved) {
          try {
            const d = JSON.parse(saved)
            if (d.deviceId && d.privateKey && d.publicKey) {
              this.deviceKeys = {
                deviceId: d.deviceId,
                privateKey: b64ToBytes(d.privateKey),
                publicKey: b64ToBytes(d.publicKey),
              }
              return this.deviceKeys
            }
          } catch {
            /* повреждены — генерируем новые */
          }
        }
        const keys = generateDeviceKeys()
        this.deviceKeys = keys
        try {
          await storage.saveDevice(
            JSON.stringify({
              deviceId: keys.deviceId,
              privateKey: bytesToB64(keys.privateKey),
              publicKey: bytesToB64(keys.publicKey),
            }),
          )
        } catch {
          /* не критично: устройство пересоздастся */
        }
      }
      return this.deviceKeys
    },
    async init() {
      const settings = useSettingsStore()
      const auth = useAuthStore()
      const keys = await this.ensureDevice()
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
    // Личный чат с пользователем (создаёт при первом обращении).
    async openDM(userId: number) {
      const settings = useSettingsStore()
      const res = await settings.api.createDM(userId)
      const ch = res.channel as Channel
      await this.refresh()
      if (res.created) {
        // Новый личный чат: инициатор создаёт ключ канала.
        this.currentId = ch.id
        await this.initChannelKey(ch.id)
      }
      await this.enterChannel(ch.id)
      return ch
    },
    // Создание сообщества: владелец публикует, подписчики читают.
    async createCommunity(name: string): Promise<Channel> {
      const settings = useSettingsStore()
      const res = await settings.api.createCommunity(name)
      const ch = res.channel as Channel
      await this.refresh()
      this.currentId = ch.id
      await this.initChannelKey(ch.id)
      await this.openChannel(ch.id)
      return ch
    },
    // Подписка на сообщество (найдено по названию/id).
    async subscribeCommunity(channelId: number) {
      const settings = useSettingsStore()
      await settings.api.joinChannel(channelId)
      await this.refresh()
      await this.enterChannel(channelId)
    },
    // Отписка от сообщества.
    async unsubscribeCommunity(channelId: number) {
      const settings = useSettingsStore()
      const chat = useChatStore()
      const calls = useCallStore()
      await settings.api.leaveChannel(channelId)
      if (this.currentId === channelId) this.currentId = 0
      chat.messages.delete(channelId)
      calls.endAllInChannel(channelId)
      this.unpinChannel(channelId)
      await this.refresh()
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
      const keys = await this.ensureDevice()
      const existing = await storage.loadChannelKey(channelId)
      if (existing) return
      const key = generateChannelKey()
      const wrapped = await wrapChannelKey(key, keys.publicKey)
      await settings.api.uploadWrappedKey(channelId, Number(useAuthStore().user!.id), keys.deviceId, wrapped)
      await storage.saveChannelKey(channelId, key)
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
        const keys = await this.ensureDevice()
        const ch = this.channels.find((c) => c.id === channelId)
        const isMember = ch ? ch.is_member : this.members.some((m) => m.user_id === auth.user?.id)
        if (auth.user && isMember) {
          const res = await settings.api.getMyWrappedKey(channelId, keys.deviceId)
          if (res.wrapped_key) {
            const key = await unwrapChannelKey(b64ToBytes(res.wrapped_key), keys.privateKey)
            const hadKey = await storage.loadChannelKey(channelId)
            await storage.saveChannelKey(channelId, key)
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
          // Одна неисправная цель (битый публичный ключ устройства и т.п.)
          // не должна блокировать раздачу ключа остальным участникам.
          try {
            const wrapped = await wrapChannelKey(myKey, b64ToBytes(target.public_key))
            await settings.api.uploadWrappedKey(channelId, target.user_id, target.device_id, wrapped)
          } catch {
            /* пропускаем — остальные цели обработаются */
          }
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
    // Фоновая раздача ключей: обходим ВСЕ каналы, а не только открытый.
    // Иначе ключ личного чата застревает, если держатель ключа сидит
    // в другом канале (а у собеседника — «Ключ канала ещё не получен»).
    startKeyPoll() {
      if (this.keyPollTimer) return
      this.keyPollTimer = window.setInterval(() => {
        for (const ch of this.channels) {
          void this.syncKeys(ch.id)
        }
      }, 7000)
      // Возврат на вкладку после долгого отсутствия: сразу раздаём ключи.
      this._focusHandler = () => {
        void this.syncAllKeys()
      }
      window.addEventListener('focus', this._focusHandler)
    },
    stopKeyPoll() {
      if (this.keyPollTimer) {
        clearInterval(this.keyPollTimer)
        this.keyPollTimer = 0
      }
      if (this._focusHandler) {
        window.removeEventListener('focus', this._focusHandler)
        this._focusHandler = null
      }
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
