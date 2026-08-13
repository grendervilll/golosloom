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
  }),
  getters: {
    unreadCount: (state) => (channelId: number) => state.unread.get(channelId) || 0,
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
        if (idx >= 0) cur[idx] = real
        else cur.push(real)
        this.messages.set(channelId, [...cur])
      } catch {
        const cur = this.messages.get(channelId) || []
        this.messages.set(channelId, cur.filter((x) => x.id !== tempId))
        return false
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
      else list.push(m)
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
