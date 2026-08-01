// WebSocket-клиент: подписка на события сервера.
import type { WSEvent } from './types'

export type EventHandler = (data: any) => void

export class WsClient {
  private ws: WebSocket | null = null
  private handlers = new Map<string, Set<EventHandler>>()
  private baseUrl = ''
  private token = ''
  private shouldReconnect = true
  private reconnectDelay = 2000

  connect(baseUrl: string, token: string) {
    this.baseUrl = baseUrl
    this.token = token
    this.shouldReconnect = true
    this.open()
  }

  private open() {
    if (!this.baseUrl || !this.token) return
    const url = this.baseUrl.replace(/^http/, 'ws') + '/ws?token=' + encodeURIComponent(this.token)
    this.ws = new WebSocket(url)
    this.ws.onmessage = (ev) => this.dispatch(ev.data)
    this.ws.onclose = () => {
      if (this.shouldReconnect) {
        setTimeout(() => this.open(), this.reconnectDelay)
      }
    }
  }

  disconnect() {
    this.shouldReconnect = false
    this.ws?.close()
    this.ws = null
  }

  on(type: string, handler: EventHandler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set())
    this.handlers.get(type)!.add(handler)
    return () => this.handlers.get(type)?.delete(handler)
  }

  send(type: string, data?: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data }))
    }
  }

  private dispatch(raw: string) {
    let ev: WSEvent
    try {
      ev = JSON.parse(raw)
    } catch {
      return
    }
    const set = this.handlers.get(ev.type)
    if (set) for (const h of [...set]) h(ev.data)
  }
}
