// Тесты HTTP-клиента: корректные ответы, пустые/не-JSON ответы (Electron),
// ошибки сервера, сетевые сбои.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClient } from './http'

function mockFetch(status: number, body: string | null, ok = status < 400) {
  globalThis.fetch = vi.fn(async () => ({
    ok,
    status,
    text: async () => body ?? '',
  })) as any
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ApiClient', () => {
  it('возвращает данные при успешном JSON-ответе', async () => {
    mockFetch(200, JSON.stringify({ token: 'abc' }))
    const api = new ApiClient('https://srv.example.com')
    await expect(api.login('a', 'b')).resolves.toEqual({ token: 'abc' })
  })

  it('пустой ответ с кодом 200 — понятная ошибка (не null crash)', async () => {
    mockFetch(200, '')
    const api = new ApiClient('https://srv.example.com')
    await expect(api.login('a', 'b')).rejects.toThrow('Пустой ответ сервера')
  })

  it('не-JSON ответ с кодом 200 — понятная ошибка', async () => {
    mockFetch(200, '<html>index</html>')
    const api = new ApiClient('https://srv.example.com')
    await expect(api.login('a', 'b')).rejects.toThrow('Некорректный ответ сервера')
  })

  it('ошибка сервера пробрасывается со статусом и текстом', async () => {
    mockFetch(403, JSON.stringify({ error: 'нет доступа' }))
    const api = new ApiClient('https://srv.example.com')
    await expect(api.login('a', 'b')).rejects.toMatchObject({ status: 403, message: 'нет доступа' })
  })

  it('сетевой сбой — понятная ошибка с адресом', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Network request failed')
    })
    const api = new ApiClient('https://srv.example.com')
    await expect(api.get('/api/me')).rejects.toThrow('Не удалось подключиться к серверу')
  })

  it('GET/POST/PATCH/DELETE используют правильные методы и заголовки', async () => {
    const calls: any[] = []
    globalThis.fetch = vi.fn(async (url: string, init: any) => {
      calls.push({ url, init })
      return { ok: true, status: 200, text: async () => '{}' }
    }) as any
    const api = new ApiClient('https://srv.example.com')
    api.setToken('tok')
    await api.get('/api/me')
    await api.post('/api/channels', { name: 'x' })
    await api.patch('/api/channels/1/messages/2', { a: 1 })
    await api.delete('/api/channels/1')
    expect(calls.map((c) => c.init.method)).toEqual(['GET', 'POST', 'PATCH', 'DELETE'])
    expect(calls[1].init.body).toBe(JSON.stringify({ name: 'x' }))
    expect(calls[0].init.headers.Authorization).toBe('Bearer tok')
    expect(calls[0].url).toBe('https://srv.example.com/api/me')
  })

  it('адрес без завершающего слеша нормализуется', () => {
    const api = new ApiClient('https://srv.example.com///')
    expect((api as any).baseUrl).toBe('https://srv.example.com')
  })
})
