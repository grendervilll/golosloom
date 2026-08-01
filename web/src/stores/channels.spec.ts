// Тесты синхронизации ключей каналов и списка каналов.
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useChannelsStore } from './channels'
import { useAuthStore } from './auth'
import { useSettingsStore } from './settings'
import { getKeyStorage, resetKeyStorage } from '../crypto/storage'
import { generateChannelKey, generateDeviceKeys, wrapChannelKey, bytesToB64 } from '../crypto/crypto'

function mockApi() {
  return {
    uploadKey: vi.fn(async () => ({})),
    listChannels: vi.fn(async () => [{ id: 10, name: 'ch', private: false, creator_id: 1, created_at: '', is_member: true, role: 'channel_admin' }]),
    listInvites: vi.fn(async () => []),
    listUsers: vi.fn(async () => []),
    listMessages: vi.fn(async () => []),
    listMembers: vi.fn(async () => [{ user_id: 1, nick: 'me', role: 'channel_admin', online: true, joined_at: '' }]),
    joinChannel: vi.fn(async () => ({})),
    createChannel: vi.fn(async () => ({ id: 11, name: 'new', private: false, creator_id: 1, created_at: '', is_member: true })),
    uploadWrappedKey: vi.fn(async () => ({})),
    getMyWrappedKey: vi.fn(async () => ({ wrapped_key: null })),
    pendingKeyTargets: vi.fn(async () => []),
    deleteChannel: vi.fn(async () => ({})),
    acceptInvite: vi.fn(async () => ({})),
    declineInvite: vi.fn(async () => ({})),
    setRole: vi.fn(async () => ({})),
    banMember: vi.fn(async () => ({})),
    unbanMember: vi.fn(async () => ({})),
    kickMember: vi.fn(async () => ({})),
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
  if (!dbs.some((d) => d.name === "golosloom-keys")) return
  const req = indexedDB.open("golosloom-keys")
  const db = await new Promise<IDBDatabase>((res, rej) => {
    req.onsuccess = () => res(req.result)
    req.onerror = () => rej(req.error)
  })
  try {
    await new Promise<void>((res, rej) => {
      const tx = db.transaction("keys", "readwrite")
      tx.objectStore("keys").clear()
      tx.oncomplete = () => res()
      tx.onerror = () => rej(tx.error)
    })
  } catch {
    // База ещё не создавалась
  }
  db.close()
}

describe('каналы и ключи', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    resetKeyStorage()
    await clearKeysDb()
  })

  function setup() {
    const settings = useSettingsStore()
    const api = mockApi() as any
    settings.api = api
    const auth = useAuthStore()
    auth.user = { id: 1, nick: 'me', is_server_admin: false, server_banned: false, created_at: '' } as any
    return { api, auth }
  }

  it('проверяет список каналов', async () => {
    setup()
    const channels = useChannelsStore()
    await channels.refresh()
    expect(channels.channels).toHaveLength(1)
    expect(channels.currentId).toBe(10)
  })

  it('открытие публичного канала автоматически вступает в него', async () => {
    const { api } = setup()
    api.listChannels.mockResolvedValue([
      { id: 10, name: 'общий', private: false, creator_id: 1, created_at: '', is_member: false, role: 'user' },
    ])
    const channels = useChannelsStore()
    channels.currentId = 0
    await channels.refresh()
    expect(channels.currentId).toBe(10)
    await channels.openChannel(10)
    expect(api.joinChannel).toHaveBeenCalledWith(10)
    expect(api.listMembers).toHaveBeenCalledWith(10)
    expect(api.listMessages).toHaveBeenCalledWith(10)
  })

  it('открытие приватного канала не пытается вступить (участник уже есть)', async () => {
    const { api } = setup()
    const channels = useChannelsStore()
    channels.channels = [
      { id: 10, name: 'секрет', private: true, creator_id: 1, created_at: '', is_member: true, role: 'user' },
    ] as any
    channels.currentId = 10
    await channels.openChannel(10)
    expect(api.joinChannel).not.toHaveBeenCalled()
  })

  it('инициализация не падает, если открыть канал нельзя', async () => {
    const { api } = setup()
    api.listMembers.mockRejectedValue({ status: 403, message: 'нет доступа к каналу' })
    const channels = useChannelsStore()
    await expect(channels.init()).resolves.toBeUndefined()
  })

  it('создатель канала создаёт и сохраняет ключ канала', async () => {
    setup()
    const channels = useChannelsStore()
    await channels.createChannel('новый', false)
    const storage = await getKeyStorage()
    const key = await storage.loadChannelKey(11)
    expect(key).toHaveLength(32)
    const { api } = useSettingsStore() as any
    expect(api.uploadWrappedKey).toHaveBeenCalled()
  })

  it('получает свой обёрнутый ключ и раздаёт его новым устройствам', async () => {
    setup()
    const channels = useChannelsStore()
    const myKeys = generateDeviceKeys()
    const storage = await getKeyStorage()
    const channelKey = generateChannelKey()
    await storage.saveChannelKey(10, channelKey)
    // Чужое устройство без ключа.
    const other = generateDeviceKeys()
    const api = useSettingsStore().api as any
    api.pendingKeyTargets = vi.fn(async () => [{ user_id: 2, device_id: other.deviceId, public_key: bytesToB64(other.publicKey) }])
    channels.ensureDevice()
    channels.deviceKeys = myKeys
    channels.members = [
      { user_id: 1, nick: 'me', role: 'channel_admin', online: true, joined_at: '' },
      { user_id: 2, nick: 'bob', role: 'user', online: true, joined_at: '' },
    ]
    await channels.syncKeys(10)
    // Мы обернули ключ для чужого устройства и загрузили его на сервер.
    const call = api.uploadWrappedKey.mock.calls[0]
    expect(call[0]).toBe(10)
    expect(call[1]).toBe(2)
    expect(call[2]).toBe(other.deviceId)
    // Чужое устройство может распаковать этот ключ.
    const unwrapped = await unwrapForTest(call[3], other.privateKey)
    expect(Array.from(unwrapped)).toEqual(Array.from(channelKey))
  })

  it('обрабатывает событие key.needed — оборачивает ключ для нового участника', async () => {
    setup()
    const channels = useChannelsStore()
    channels.currentId = 10
    const storage = await getKeyStorage()
    const channelKey = generateChannelKey()
    await storage.saveChannelKey(10, channelKey)
    const other = generateDeviceKeys()
    const api = useSettingsStore().api as any
    await channels.handleKeyNeeded({ channel_id: 10, user_id: 2, device_id: other.deviceId, public_key: bytesToB64(other.publicKey) })
    expect(api.uploadWrappedKey).toHaveBeenCalledWith(10, 2, other.deviceId, expect.any(Uint8Array))
  })

  it('не раздаёт ключ, если у меня его нет', async () => {
    setup()
    const channels = useChannelsStore()
    const other = generateDeviceKeys()
    const api = useSettingsStore().api as any
    await channels.handleKeyNeeded({ channel_id: 10, user_id: 2, device_id: other.deviceId, public_key: bytesToB64(other.publicKey) })
    expect(api.uploadWrappedKey).not.toHaveBeenCalled()
  })
})

async function unwrapForTest(wrapped: Uint8Array, privateKey: Uint8Array): Promise<Uint8Array> {
  const { unwrapChannelKey } = await import('../crypto/crypto')
  return unwrapChannelKey(wrapped, privateKey)
}
