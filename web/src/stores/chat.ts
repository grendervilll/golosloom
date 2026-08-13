// Чат: зашифрованные сообщения канала, редактирование, удаление, оригиналы.
import { defineStore } from 'pinia'
import { useSettingsStore } from './settings'
import { useAuthStore } from './auth'
import { useChannelsStore } from './channels'
import { sounds } from '../audio/sounds'
import type { Message } from '../api/types'
import { getKeyStorage } from '../crypto/storage'
import { encryptMessage, decryptMessage, b64ToBytes } from '../crypto/crypto'

export interface ChatMessage {
  id: number
  channelId: number
  senderId: number
  senderNick: string
  text: string
  system?: boolean // системное сообщение («Звонок завершён…»)
  encrypted: boolean
  deleted: boolean
  deletedBy?: number
  edited: boolean
  createdAt: string
  editedAt?: string
  original?: string // оригинал до изменения (для модераторов)
  pending?: boolean
}

export const useChatStore = defineStore('chat', {
  state: () => ({
    messages: new Map<number, ChatMessage[]>(),
    draft: '' as string,
    editingId: 0 as number,
    // Непрочитанные сообщения по каналам (локальный счётчик, сбрасывается
    // при открытии канала).
    unread: new Map<number, number>(),
    // «Печатает…»: channel_id → user_id → { nick, until }. Устаревают по таймеру.
    typers: new Map<number, Map<number, { nick: string; until: number }>>(),
    // Троттлинг отправки собственного события typing (ms).
    typingLastSent: 0 as number,
  }),
  getters: {
    unreadCount: (state) => (channelId: number) => state.unread.get(channelId) || 0,
    // Список печатающих в канале (актуальные, без себя): user_id → nick.
    typingUsers: (state) => {
      return (channelId: number): { userId: number; nick: string }[] => {
        const now = Date.now()
        const map = state.typers.get(channelId)
        if (!map) return []
        const out: { userId: number; nick: string }[] = []
        for (const [userId, t] of map) {
          if (t.until > now) out.push({ userId, nick: t.nick })
        }
        return out.sort((a, b) => a.nick.localeCompare(b.nick))
      }
    },
  },
  actions: {
    async loadHistory(channelId: number) {
      const settings = useSettingsStore()
      const auth = useAuthStore()
      const storage = await getKeyStorage()
      const key = await storage.loadChannelKey(channelId)
      const msgs: Message[] = await settings.api.listMessages(channelId)
      const decrypted: ChatMessage[] = []
      for (const m of msgs) {
        decrypted.push(await this.toChatMessage(m, channelId, key, auth.user?.id || 0))
      }
      this.messages.set(channelId, decrypted)
    },
    // Открытие канала: прочитанными считаются все сообщения в нём.
    markRead(channelId: number) {
      if (this.unread.get(channelId)) {
        this.unread.set(channelId, 0)
      }
    },
    // Сообщить серверу, что печатаем (не чаще раза в 2.5 сек).
    typing(channelId: number) {
      const now = Date.now()
      if (now - this.typingLastSent < 2500) return
      this.typingLastSent = now
      const auth = useAuthStore()
      auth.ws.send('typing', { channel_id: channelId })
    },
    // Событие «печатает…» от другого пользователя.
    handleTyping(data: { channel_id: number; user_id: number; nick: string }) {
      const auth = useAuthStore()
      if (data.user_id === auth.user?.id) return
      const byChannel = this.typers.get(data.channel_id) || new Map()
      const until = Date.now() + 5000
      const prev = byChannel.get(data.user_id)
      // Обновление не двигает пользователя в конец списка (сортировка по нику).
      byChannel.set(data.user_id, { nick: data.nick, until: prev && prev.until > until ? prev.until : until })
      this.typers.set(data.channel_id, new Map(byChannel))
      // Авто-удаление по истечении срока.
      setTimeout(() => {
        const m = this.typers.get(data.channel_id)
        if (!m) return
        if ((m.get(data.user_id)?.until || 0) <= Date.now()) {
          m.delete(data.user_id)
          this.typers.set(data.channel_id, new Map(m))
        }
      }, 5100)
    },
    // Оптимистичная отправка: своё сообщение появляется сразу (pending),
    // затем заменяется ответом сервера; история НЕ перечитывается целиком.
    async send(channelId: number, text: string): Promise<boolean> {
      const settings = useSettingsStore()
      const storage = await getKeyStorage()
      const key = await storage.loadChannelKey(channelId)
      if (!key) return false
      const { ciphertext, iv } = await encryptMessage(key, text)
      const auth = useAuthStore()
      const tempId = -Date.now()
      const pending: ChatMessage = {
        id: tempId,
        channelId,
        senderId: auth.user?.id || 0,
        senderNick: auth.user?.nick || '',
        text,
        encrypted: false,
        deleted: false,
        edited: false,
        createdAt: new Date().toISOString(),
        pending: true,
      }
      const list = this.messages.get(channelId) || []
      this.messages.set(channelId, [...list, pending])
      try {
        const res: Message = await settings.api.sendMessage(channelId, ciphertext, iv)
        const real = await this.toChatMessage(res, channelId, key, auth.user?.id || 0)
        const cur = this.messages.get(channelId) || []
        const idx = cur.findIndex((x) => x.id === tempId)
        const exists = cur.some((x) => x.id === res.id)
        if (exists) {
          // Копия уже пришла по WS (message.new) — убираем только временную.
          if (idx >= 0) cur.splice(idx, 1)
        } else if (idx >= 0) {
          cur[idx] = real
        } else {
          cur.push(real)
        }
        this.messages.set(channelId, [...cur])
      } catch (e) {
        const cur = this.messages.get(channelId) || []
        this.messages.set(channelId, cur.filter((x) => x.id !== tempId))
        // Пробрасываем реальную ошибку (например, «сообщение слишком длинное»),
        // чтобы UI показал её, а не общее «ключ канала не получен».
        throw e
      }
      return true
    },
    async edit(channelId: number, messageId: number, text: string) {
      const settings = useSettingsStore()
      const storage = await getKeyStorage()
      const key = await storage.loadChannelKey(channelId)
      if (!key) return
      const { ciphertext, iv } = await encryptMessage(key, text)
      await settings.api.editMessage(channelId, messageId, ciphertext, iv)
      this.editingId = 0
      this.draft = ''
    },
    // Системное сообщение от клиента (не из истории сервера).
    pushSystem(channelId: number, text: string) {
      const list = this.messages.get(channelId) || []
      const msg: ChatMessage = {
        id: -Date.now(),
        channelId,
        senderId: 0,
        senderNick: '',
        text,
        encrypted: false,
        deleted: false,
        edited: false,
        createdAt: new Date().toISOString(),
        system: true,
      }
      this.messages.set(channelId, [...list, msg])
    },
    async remove(channelId: number, messageId: number) {
      const settings = useSettingsStore()
      await settings.api.deleteMessage(channelId, messageId)
    },
    async handleNew(data: Message) {
      const chat = this
      const list = chat.messages.get(data.channel_id) || []
      const storage = await getKeyStorage()
      const key = await storage.loadChannelKey(data.channel_id)
      const auth = useAuthStore()
      const m = await this.toChatMessage(data, data.channel_id, key, auth.user?.id || 0)
      // Дубликат (своё сообщение после оптимистичной отправки) — заменяем,
      // а не добавляем второй раз.
      const idx = list.findIndex((x) => x.id === data.id)
      if (idx >= 0) list[idx] = m
      else {
        // Оптимистичное сообщение ещё ждёт ответа HTTP — заменяем его,
        // чтобы не было дубля (своё сообщение, тот же текст).
        const pendIdx = list.findIndex(
          (x) => x.id < 0 && x.senderId === data.sender_id && x.text === m.text,
        )
        if (pendIdx >= 0) list[pendIdx] = m
        else list.push(m)
      }
      this.messages.set(data.channel_id, [...list])
      // Непрочитанное: чужие сообщения в каналы, которые не открыты.
      const channels = useChannelsStore()
      if (data.sender_id !== auth.user?.id && data.channel_id !== channels.currentId) {
        this.unread.set(data.channel_id, (this.unread.get(data.channel_id) || 0) + 1)
      }
      if (data.sender_id !== auth.user?.id && !m.encrypted) {
        sounds.message()
      }
    },
    async handleEdited(data: Message) {
      const storage = await getKeyStorage()
      const key = await storage.loadChannelKey(data.channel_id)
      const auth = useAuthStore()
      const m = await this.toChatMessage(data, data.channel_id, key, auth.user?.id || 0)
      const list = this.messages.get(data.channel_id) || []
      const idx = list.findIndex((x) => x.id === data.id)
      if (idx >= 0) list[idx] = m
      else list.push(m)
      this.messages.set(data.channel_id, [...list])
    },
    handleDeleted(data: { channel_id: number; message_id: number; deleted_by: number }) {
      const list = this.messages.get(data.channel_id) || []
      if (this.canSeeDeleted()) {
        // Модераторы/админы видят удалённое сообщение с оригиналом.
        const idx = list.findIndex((x) => x.id === data.message_id)
        if (idx >= 0) {
          list[idx] = { ...list[idx], deleted: true, deletedBy: data.deleted_by }
          this.messages.set(data.channel_id, [...list])
        }
      } else {
        // Обычные пользователи не видят удалённое сообщение вовсе.
        this.messages.set(
          data.channel_id,
          list.filter((x) => x.id !== data.message_id),
        )
      }
    },
    async toChatMessage(
      m: Message,
      channelId: number,
      key: Uint8Array | null,
      myId: number,
    ): Promise<ChatMessage> {
      const base: ChatMessage = {
        id: m.id,
        channelId,
        senderId: m.sender_id,
        senderNick: m.sender_nick || '',
        text: '',
        encrypted: false,
        deleted: m.deleted,
        deletedBy: m.deleted_by,
        edited: !!m.edited_at,
        createdAt: m.created_at,
        editedAt: m.edited_at,
      }
      // Удалённые сообщения скрываются у простых пользователей.
      if (m.deleted && !this.canSeeDeleted()) {
        return base
      }
      try {
        if (key) {
          base.text = await decryptMessage(key, b64ToBytes(m.ciphertext), b64ToBytes(m.iv))
          // Оригинал для модераторов/админов.
          if (this.canSeeDeleted() && m.history && m.history.length > 0) {
            base.original = await decryptMessage(
              key,
              b64ToBytes(m.history[m.history.length - 1].ciphertext),
              b64ToBytes(m.history[m.history.length - 1].iv),
            )
          }
        } else {
          base.encrypted = true
        }
      } catch {
        base.encrypted = true
      }
      return base
    },
    canSeeDeleted(): boolean {
      const channels = useChannelsStore()
      const auth = useAuthStore()
      const role = channels.currentRole
      return auth.isServerAdmin || role === 'channel_admin' || role === 'channel_moderator'
    },
  },
})
