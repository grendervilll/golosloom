// Тесты WebSocket-клиента: подключение, обработка событий, подписки.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WsClient } from './ws'

class FakeWebSocket {
  static OPEN = 1
  static CLOSED = 3
  static instances: FakeWebSocket[] = []
  readyState = 0
  url = ''
  onmessage: ((ev: any) => void) | null = null
  onclose: (() => void) | null = null
  sent: string[] = []
  close = vi.fn(() => {
    this.readyState = FakeWebSocket.CLOSED
  })

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }
  send(data: string) {
    this.sent.push(data)
  }
}

describe('WsClient', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    ;(globalThis as any).WebSocket = FakeWebSocket
  })

  it('подключается с токеном в URL', () => {
    const ws = new WsClient()
    ws.connect('https://srv.example.com', 'tok-123')
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.instances[0].url).toBe('wss://srv.example.com/ws?token=tok-123')
  })

  it('диспетчеризует события подписчикам', () => {
    const ws = new WsClient()
    ws.connect('https://srv.example.com', 't')
    const handler = vi.fn()
    ws.on('message.new', handler)
    const inst = FakeWebSocket.instances[0]
    inst.onmessage!({ data: JSON.stringify({ type: 'message.new', data: { id: 1 } }) })
    expect(handler).toHaveBeenCalledWith({ id: 1 })
  })

  it('не вызывает обработчики для незнакомых типов и битого JSON', () => {
    const ws = new WsClient()
    ws.connect('https://srv.example.com', 't')
    const handler = vi.fn()
    ws.on('x', handler)
    const inst = FakeWebSocket.instances[0]
    inst.onmessage!({ data: '{broken' })
    inst.onmessage!({ data: JSON.stringify({ type: 'other' }) })
    expect(handler).not.toHaveBeenCalled()
  })

  it('подписку можно отменить', () => {
    const ws = new WsClient()
    ws.connect('https://srv.example.com', 't')
    const handler = vi.fn()
    const off = ws.on('x', handler)
    off()
    FakeWebSocket.instances[0].onmessage!({ data: JSON.stringify({ type: 'x' }) })
    expect(handler).not.toHaveBeenCalled()
  })

  it('отправляет сообщения в формате {type, data}', () => {
    const ws = new WsClient()
    ws.connect('https://srv.example.com', 't')
    const inst = FakeWebSocket.instances[0]
    inst.readyState = 1
    ws.send('call.punch', { call_id: 5, target_user_id: 7 })
    expect(JSON.parse(inst.sent[0])).toEqual({ type: 'call.punch', data: { call_id: 5, target_user_id: 7 } })
  })

  it('не отправляет, пока соединение не открыто', () => {
    const ws = new WsClient()
    ws.connect('https://srv.example.com', 't')
    ws.send('ping')
    expect(FakeWebSocket.instances[0].sent).toHaveLength(0)
  })

  it('disconnect закрывает соединение без переподключения', () => {
    const ws = new WsClient()
    ws.connect('https://srv.example.com', 't')
    const inst = FakeWebSocket.instances[0]
    ws.disconnect()
    expect(inst.close).toHaveBeenCalled()
  })
})
