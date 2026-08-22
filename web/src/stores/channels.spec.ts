// Тесты списка каналов, участников, приглашений.
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useChannelsStore } from './channels'
import { useAuthStore } from './auth'
import { useSettingsStore } from './settings'

function mockApi() {
  return {
    listChannels: vi.fn(async () => [{ id: 10, name: 'ch', private: false, creator_id: 1, created_at: '', is_member: true, role: 'channel_admin' }]),
    listInvites: vi.fn(async () => []),
    listUsers: vi.fn(async () => []),
    listMessages: vi.fn(async () => []),
    listMembers: vi.fn(async () => [{ user_id: 1, nick: 'me', role: 'channel_admin', online: true, joined_at: '' }]),
    listBannedMembers: vi.fn(async () => []),
    joinChannel: vi.fn(async () => ({})),
    createChannel: vi.fn(async () => ({ id: 11, name: 'new', private: false, creator_id: 1, created_at: '', is_member: true })),
    deleteChannel: vi.fn(async () => ({})),
    acceptInvite: vi.fn(async () => ({})),
    declineInvite: vi.fn(async () => ({})),
    setRole: vi.fn(async () => ({})),
    banMember: vi.fn(async () => ({})),
    unbanMember: vi.fn(async () => ({})),
    kickMember: vi.fn(async () => ({})),
    centrifugoSubscribe: vi.fn(async () => ({ token: 'sub-tok' })),
    config: vi.fn(async () => ({ centrifugo_url: '/centrifugo', livekit_url: 'ws://lk', max_message_len: 2000, turn: {} })),
  }
}

describe('каналы', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
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
  })

  it('открытие приватного канала не пытается вступить', async () => {
    setup()
    const channels = useChannelsStore()
    channels.channels = [
      { id: 10, name: 'секрет', private: true, creator_id: 1, created_at: '', is_member: true, role: 'user' },
    ] as any
    channels.currentId = 10
    await channels.openChannel(10)
  })

  it('инициализация не падает, если открыть канал нельзя', async () => {
    const { api } = setup()
    api.listMembers.mockRejectedValue({ status: 403, message: 'нет доступа к каналу' })
    const channels = useChannelsStore()
    await expect(channels.init()).resolves.toBeUndefined()
  })

  it('кик передаёт причину на сервер', async () => {
    const { api } = setup()
    const channels = useChannelsStore()
    await channels.kick(10, 2, 'плохое поведение')
    expect(api.kickMember).toHaveBeenCalledWith(10, 2, 'плохое поведение')
  })

  it('при открытии канала загружается список забаненных', async () => {
    const { api } = setup()
    api.listBannedMembers = vi.fn(async () => [{ user_id: 3, nick: 'bad', ban_reason: 'спам' }])
    const channels = useChannelsStore()
    channels.currentId = 10
    await channels.openChannel(10)
    expect(channels.banned).toHaveLength(1)
    expect(channels.banned[0].ban_reason).toBe('спам')
  })

  it('разбан снимает бан и перезагружает канал', async () => {
    const { api } = setup()
    const channels = useChannelsStore()
    channels.currentId = 10
    api.listBannedMembers = vi.fn(async () => [{ user_id: 3, nick: 'bad', ban_reason: 'спам' }])
    await channels.openChannel(10)
    expect(channels.banned).toHaveLength(1)
    await channels.unban(10, 3)
    expect(api.unbanMember).toHaveBeenCalledWith(10, 3)
  })

  it('создание канала', async () => {
    setup()
    const channels = useChannelsStore()
    const ch = await channels.createChannel('новый', false)
    expect(ch.id).toBe(11)
  })
})
