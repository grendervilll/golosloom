// Тесты аутентификации: сохранение токена, защита от пустого ответа.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from './auth'
import { useSettingsStore } from './settings'

function mockApi() {
  return {
    setToken: vi.fn(),
    login: vi.fn(async () => ({ token: 'tok-123' })),
    register: vi.fn(async () => ({ token: 'tok-456' })),
    me: vi.fn(async () => ({ id: 1, nick: 'alice', is_server_admin: true, server_banned: false, created_at: '' })),
    config: vi.fn(async () => ({ ws_path: '/ws', livekit_url: 'ws://lk', max_message_len: 2000, turn: {} })),
    listChannels: vi.fn(async () => []),
    listInvites: vi.fn(async () => []),
    listUsers: vi.fn(async () => []),
  }
}

describe('auth', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('сохраняет токен и пользователя после входа', async () => {
    const settings = useSettingsStore()
    settings.api = mockApi() as any
    const auth = useAuthStore()
    await auth.login('alice', 'Secret123!')
    expect(auth.token).toBe('tok-123')
    expect(localStorage.getItem('golosloom-token')).toBe('tok-123')
    expect(auth.user?.nick).toBe('alice')
  })

  it('пустой ответ сервера — понятная ошибка, а не null crash', async () => {
    const settings = useSettingsStore()
    settings.api = { ...mockApi(), login: vi.fn(async () => null) } as any
    const auth = useAuthStore()
    await expect(auth.login('alice', 'Secret123!')).rejects.toThrow('Некорректный ответ сервера')
  })

  it('ответ без token — понятная ошибка', async () => {
    const settings = useSettingsStore()
    settings.api = { ...mockApi(), login: vi.fn(async () => ({})) } as any
    const auth = useAuthStore()
    await expect(auth.login('alice', 'Secret123!')).rejects.toThrow('Некорректный ответ сервера')
  })

  it('регистрация сохраняет токен', async () => {
    const settings = useSettingsStore()
    settings.api = mockApi() as any
    const auth = useAuthStore()
    await auth.register('bob', 'Secret123!')
    expect(auth.token).toBe('tok-456')
  })

  it('logout очищает токен и пользователя', async () => {
    const settings = useSettingsStore()
    settings.api = mockApi() as any
    const auth = useAuthStore()
    await auth.login('alice', 'Secret123!')
    auth.logout()
    expect(auth.token).toBe('')
    expect(auth.user).toBeNull()
    expect(localStorage.getItem('golosloom-token')).toBeNull()
  })
})
