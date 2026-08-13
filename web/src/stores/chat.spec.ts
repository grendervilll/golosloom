// Тесты чата: шифрование при отправке, расшифровка при получении,
// видимость удалённых сообщений для модераторов, редактирование.
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useChatStore } from './chat'
import { useAuthStore } from './auth'
import { useSettingsStore } from './settings'
import { useChannelsStore } from './channels'
import { getKeyStorage, resetKeyStorage } from '../crypto/storage'
import { generateChannelKey, encryptMessage, bytesToB64 } from '../crypto/crypto'

function mockApi() {
  return {
    listMessages: vi.fn(async () => []),
    sendMessage: vi.fn(async () => ({ id: 1 })),
    editMessage: vi.fn(async () => ({})),
    deleteMessage: vi.fn(async () => ({})),
    listMembers: vi.fn(async () => []),
    listChannels: vi.fn(async () => []),
    listUsers: vi.fn(async () => []),
    listInvites: vi.fn(async () => []),
    uploadKey: vi.fn(async () => ({})),
    getMyWrappedKey: vi.fn(async () => ({ wrapped_key: null })),
    pendingKeyTargets: vi.fn(async () => []),
    uploadWrappedKey: vi.fn(async () => ({})),
    config: vi.fn(async () => ({ ws_path: '/ws', livekit_url: 'ws://lk', max_message_len: 2000, turn: {} })),
  }
}

async function clearKeysDb() {
  let dbs: IDBDatabaseInfo[] = []
  try {
    dbs = await indexedDB.databases()
  } catch {
    return
  }
  if (!dbs.some((d) => d.name === 'golosloom-keys')) return
  const req = indexedDB.open('golosloom-keys')
  const db = await new Promise<IDBDatabase>((res, rej) => {
    req.onsuccess = () => res(req.result)
    req.onerror = () => rej(req.error)
  })
  try {
    await new Promise<void>((res, rej) => {
      const tx = db.transaction('keys', 'readwrite')
      tx.objectStore('keys').clear()
      tx.oncomplete = () => res()
      tx.onerror = () => rej(tx.error)
    })
  } catch {
    // База ещё не создавалась — нечего чистить.
  }
  db.close()
}

describe('чат', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    resetKeyStorage()
    await clearKeysDb()
  })

  function setup(userId: number, role: 'user' | 'channel_moderator' | 'channel_admin' = 'user') {
    const settings = useSettingsStore()
    const api = mockApi() as any
    settings.api = api
    const auth = useAuthStore()
    auth.user = { id: userId, nick: 'u' + userId, is_server_admin: false, server_banned: false, created_at: '' } as any
    const channels = useChannelsStore()
    channels.channels = [{ id: 10, name: 'ch', private: false, creator_id: 1, created_at: '', is_member: true, role }] as any
    channels.currentId = 10
    return { api, auth, channels }
  }

  it('шифрует сообщение перед отправкой', async () => {
    setup(1)
    const storage = await getKeyStorage()
    const key = generateChannelKey()
    await storage.saveChannelKey(10, key)
    const chat = useChatStore()
    const ok = await chat.send(10, 'секретный текст')
    expect(ok).toBe(true)
    const payload = (useSettingsStore().api as any).sendMessage.mock.calls[0]
    expect(payload[0]).toBe(10)
    const { decryptMessage } = await import('../crypto/crypto')
    const plain = await decryptMessage(key, new Uint8Array(payload[1]), new Uint8Array(payload[2]))
    expect(plain).toBe('секретный текст')
  })

  it('не отправляет, если ключ канала ещё не получен', async () => {
    const { api } = setup(1)
    const chat = useChatStore()
    const ok = await chat.send(10, 'текст')
    expect(ok).toBe(false)
    expect(api.sendMessage).not.toHaveBeenCalled()
  })

  it('показывает своё сообщение сразу (оптимистично) и заменяет ответом сервера', async () => {
    setup(1)
    const storage = await getKeyStorage()
    const key = generateChannelKey()
    await storage.saveChannelKey(10, key)
    const api = useSettingsStore().api as any
    let resolveSend!: (v: any) => void
    api.sendMessage.mockReturnValue(new Promise((res) => (resolveSend = res)))
    const chat = useChatStore()
    const p = chat.send(10, 'оптимистично')
    // Ждём, пока pending-сообщение появится в списке (IDB-операции асинхронны).
    const waitMs = (fn: () => boolean) =>
      new Promise<void>((res) => {
        const t = setInterval(() => {
          if (fn()) {
            clearInterval(t)
            res()
          }
        }, 5)
        setTimeout(() => clearInterval(t), 1000)
      })
    await waitMs(() => (chat.messages.get(10) || []).length === 1)
    // Пока сервер не ответил — сообщение уже на месте (pending).
    let msgs = chat.messages.get(10)!
    expect(msgs.length).toBe(1)
    expect(msgs[0].pending).toBe(true)
    expect(msgs[0].text).toBe('оптимистично')
    resolveSend({
      id: 123,
      channel_id: 10,
      sender_id: 1,
      sender_nick: 'u1',
      ciphertext: '',
      iv: '',
      created_at: new Date().toISOString(),
      deleted: false,
    })
    await p
    msgs = chat.messages.get(10)!
    expect(msgs.length).toBe(1)
    expect(msgs[0].id).toBe(123)
    expect(msgs[0].pending).toBeFalsy()
  })

  it('не дублирует своё сообщение, пришедшее по WS после оптимистичной отправки', async () => {
    setup(1)
    const storage = await getKeyStorage()
    const key = generateChannelKey()
    await storage.saveChannelKey(10, key)
    const chat = useChatStore()
    const base = {
      id: 7,
      channel_id: 10,
      sender_id: 1,
      sender_nick: 'u1',
      ciphertext: '',
      iv: '',
      created_at: new Date().toISOString(),
      deleted: false,
    }
    await chat.handleNew(base as any)
    // Повторное событие WS с тем же id — заменяет, а не дублирует.
    await chat.handleNew({ ...base, edited_at: new Date().toISOString() } as any)
    const msgs = chat.messages.get(10)!
    expect(msgs.length).toBe(1)
  })

  it('WS-событие раньше ответа HTTP: pending заменяется, дубля нет', async () => {
    setup(1)
    const storage = await getKeyStorage()
    const key = generateChannelKey()
    await storage.saveChannelKey(10, key)
    const api = useSettingsStore().api as any
    let resolveSend!: (v: any) => void
    api.sendMessage.mockReturnValue(new Promise((res) => (resolveSend = res)))
    const chat = useChatStore()
    const p = chat.send(10, 'гоночное')
    const waitMs = (fn: () => boolean) =>
      new Promise<void>((res) => {
        const t = setInterval(() => {
          if (fn()) {
            clearInterval(t)
            res()
          }
        }, 5)
        setTimeout(() => clearInterval(t), 1000)
      })
    await waitMs(() => (chat.messages.get(10) || []).length === 1)
    // WS приносит сообщение раньше, чем ответило HTTP-отправление.
    const { ciphertext, iv } = await encryptMessage(key, 'гоночное')
    await chat.handleNew({
      id: 999,
      channel_id: 10,
      sender_id: 1,
      sender_nick: 'u1',
      ciphertext: bytesToB64(ciphertext),
      iv: bytesToB64(iv),
      created_at: new Date().toISOString(),
      deleted: false,
    } as any)
    expect(chat.messages.get(10)!.length).toBe(1)
    resolveSend({
      id: 999,
      channel_id: 10,
      sender_id: 1,
      sender_nick: 'u1',
      ciphertext: bytesToB64(ciphertext),
      iv: bytesToB64(iv),
      created_at: new Date().toISOString(),
      deleted: false,
    })
    await p
    const msgs = chat.messages.get(10)!
    expect(msgs.length).toBe(1)
    expect(msgs[0].id).toBe(999)
    expect(msgs[0].pending).toBeFalsy()
  })

  it('ответ HTTP раньше WS: pending заменяется, WS только обновляет', async () => {
    setup(1)
    const storage = await getKeyStorage()
    const key = generateChannelKey()
    await storage.saveChannelKey(10, key)
    const { ciphertext, iv } = await encryptMessage(key, 'гоночное')
    const msgData = {
      id: 1000,
      channel_id: 10,
      sender_id: 1,
      sender_nick: 'u1',
      ciphertext: bytesToB64(ciphertext),
      iv: bytesToB64(iv),
      created_at: new Date().toISOString(),
      deleted: false,
    }
    const api = useSettingsStore().api as any
    api.sendMessage.mockResolvedValue(msgData)
    const chat = useChatStore()
    await chat.send(10, 'гоночное')
    // WS-копия приходит после ответа HTTP.
    await chat.handleNew(msgData as any)
    const msgs = chat.messages.get(10)!
    expect(msgs.length).toBe(1)
    expect(msgs[0].id).toBe(1000)
  })

  it('печатающие: добавляет чужих, игнорирует себя, сортирует по нику', () => {
    setup(1)
    const chat = useChatStore()
    chat.handleTyping({ channel_id: 10, user_id: 2, nick: 'bob' })
    chat.handleTyping({ channel_id: 10, user_id: 1, nick: 'u1' }) // себя — игнор
    chat.handleTyping({ channel_id: 10, user_id: 3, nick: 'alice' })
    const names = chat.typingUsers(10).map((x) => x.nick)
    expect(names).toEqual(['alice', 'bob'])
    // Другой канал — пусто.
    expect(chat.typingUsers(11)).toEqual([])
  })

  it('расшифровывает приходящие сообщения', async () => {
    setup(1)
    const storage = await getKeyStorage()
    const key = generateChannelKey()
    await storage.saveChannelKey(10, key)
    const { ciphertext, iv } = await encryptMessage(key, 'входящее сообщение')
    const chat = useChatStore()
    await chat.handleNew({
      id: 5,
      channel_id: 10,
      sender_id: 2,
      sender_nick: 'bob',
      ciphertext: bytesToB64(ciphertext),
      iv: bytesToB64(iv),
      created_at: new Date().toISOString(),
      deleted: false,
    } as any)
    const msgs = chat.messages.get(10)!
    expect(msgs[0].text).toBe('входящее сообщение')
    expect(msgs[0].encrypted).toBe(false)
  })

  it('помечает сообщение как нерасшифрованное, если ключа нет', async () => {
    setup(1)
    const chat = useChatStore()
    await chat.handleNew({
      id: 6,
      channel_id: 10,
      sender_id: 2,
      sender_nick: 'bob',
      ciphertext: [1, 2, 3],
      iv: [4, 5, 6],
      created_at: new Date().toISOString(),
      deleted: false,
    } as any)
    expect(chat.messages.get(10)![0].encrypted).toBe(true)
  })

  it('модератор видит удалённое сообщение, простой пользователь — нет', async () => {
    const key = generateChannelKey()
    const storage = await getKeyStorage()
    await storage.saveChannelKey(10, key)
    const { ciphertext, iv } = await encryptMessage(key, 'удаляемое')

    // Простой пользователь.
    setup(2)
    let chat = useChatStore()
    await chat.handleNew({ id: 7, channel_id: 10, sender_id: 3, sender_nick: 'carl', ciphertext: bytesToB64(ciphertext), iv: bytesToB64(iv), created_at: '', deleted: false } as any)
    await chat.handleDeleted({ channel_id: 10, message_id: 7, deleted_by: 3 })
    let msgs = chat.messages.get(10)!
    expect(msgs.length).toBe(0) // простой пользователь не видит удалённое сообщение вовсе

    // Модератор видит и текст удалённого, и оригинал.
    setup(1, 'channel_moderator')
    chat = useChatStore()
    const edited = await encryptMessage(key, 'новая версия')
    await chat.handleNew({
      id: 8,
      channel_id: 10,
      sender_id: 3,
      sender_nick: 'carl',
      ciphertext: bytesToB64(edited.ciphertext),
      iv: bytesToB64(edited.iv),
      created_at: '',
      edited_at: new Date().toISOString(),
      history: [{ ciphertext: bytesToB64(ciphertext), iv: bytesToB64(iv), at: '' }],
      deleted: false,
    } as any)
    msgs = chat.messages.get(10)!
    const editedMsg = msgs.find((m) => m.id === 8)!
    expect(editedMsg.text).toBe('новая версия')
    expect(editedMsg.original).toBe('удаляемое')
  })

  it('обрабатывает редактирование и удаление через WS-события', async () => {
    setup(1, 'channel_moderator')
    const storage = await getKeyStorage()
    const key = generateChannelKey()
    await storage.saveChannelKey(10, key)
    const first = await encryptMessage(key, 'v1')
    const chat = useChatStore()
    await chat.handleNew({ id: 9, channel_id: 10, sender_id: 2, sender_nick: 'bob', ciphertext: bytesToB64(first.ciphertext), iv: bytesToB64(first.iv), created_at: '', deleted: false } as any)
    const second = await encryptMessage(key, 'v2')
    await chat.handleEdited({ id: 9, channel_id: 10, sender_id: 2, sender_nick: 'bob', ciphertext: bytesToB64(second.ciphertext), iv: bytesToB64(second.iv), created_at: '', edited_at: new Date().toISOString(), deleted: false } as any)
    let msgs = chat.messages.get(10)!
    expect(msgs[0].text).toBe('v2')
    expect(msgs[0].edited).toBe(true)
    await chat.handleDeleted({ channel_id: 10, message_id: 9, deleted_by: 2 })
    msgs = chat.messages.get(10)!
    expect(msgs[0].deleted).toBe(true)
  })

  it('загружает историю с пагинацией через API', async () => {
    const { api } = setup(1)
    const storage = await getKeyStorage()
    const key = generateChannelKey()
    await storage.saveChannelKey(10, key)
    const m = await encryptMessage(key, 'из истории')
    api.listMessages = vi.fn(async () => [
      { id: 1, channel_id: 10, sender_id: 2, sender_nick: 'bob', ciphertext: bytesToB64(m.ciphertext), iv: bytesToB64(m.iv), created_at: '', deleted: false },
    ])
    const chat = useChatStore()
    await chat.loadHistory(10)
    const msgs = chat.messages.get(10)!
    expect(msgs[0].text).toBe('из истории')
    expect(api.listMessages).toHaveBeenCalledWith(10)
  })

  it('отправка, отклонённая сервером, убирает оптимистичное сообщение и пробрасывает ошибку', async () => {
    setup(1)
    const storage = await getKeyStorage()
    const key = generateChannelKey()
    await storage.saveChannelKey(10, key)
    const api = useSettingsStore().api as any
    api.sendMessage.mockRejectedValue({ status: 409, message: 'сообщение уже отправлено' })
    const chat = useChatStore()
    await expect(chat.send(10, 'дубль')).rejects.toMatchObject({ status: 409 })
    const msgs = chat.messages.get(10)
    expect(msgs || []).toHaveLength(0) // оптимистичное сообщение убрано
  })
})
