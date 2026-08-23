// Centrifugo client wrapper: replaces raw WebSocket with Centrifuge JS SDK.
// Uses connection JWT (no channel list) + subscription tokens (per-channel).
import { Centrifuge, type Subscription } from 'centrifuge'
import type { WSEvent } from './types'

export type EventHandler = (data: any) => void

export class CentrifugeClient {
  private centrifuge: Centrifuge | null = null
  private handlers = new Map<string, Set<EventHandler>>()
  private subscriptions = new Map<string, Subscription>()
  private baseUrl = ''
  private connectionToken = ''
  private shouldReconnect = true

  connect(serverUrl: string, centrifugoUrl: string, connectionToken: string) {
    // centrifugoUrl from server is just the path (e.g. "/centrifugo").
    // We need the full WebSocket URL with the server origin.
    // In Electron, window.location.origin is file:// — use the configured server URL instead.
    let origin = serverUrl
    if (!origin && typeof window !== 'undefined' && window.location && window.location.origin !== 'null' && !window.location.origin.startsWith('file')) {
      origin = window.location.origin
    }
    this.baseUrl = origin.replace(/\/$/, '') + centrifugoUrl
    this.connectionToken = connectionToken
    this.shouldReconnect = true
    this.open()
  }

  private open() {
    if (!this.baseUrl || !this.connectionToken) return
    const wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/connection/websocket'
    console.log('[centrifuge] connecting to:', wsUrl)
    this.centrifuge = new Centrifuge(wsUrl, {
      token: this.connectionToken,
      getToken: () => Promise.resolve(this.connectionToken),
    })

    this.centrifuge.on('publication', (ctx: any) => {
      const ev = ctx?.data || ctx?.pub?.data
      if (ev && typeof ev === 'object' && ev.type) {
        this.dispatch(ev.type, ev.data)
      }
    })

    this.centrifuge.on('subscribed', (ctx: any) => {
      console.log('[centrifuge] subscribed to:', ctx?.channel || 'unknown')
    })

    this.centrifuge.on('disconnected', () => {
      console.log('[centrifuge] disconnected')
    })

    this.centrifuge.on('connected', () => {
      console.log('[centrifuge] connected')
    })

    this.centrifuge.connect()
  }

  disconnect() {
    this.shouldReconnect = false
    for (const [, sub] of this.subscriptions) {
      sub.unsubscribe()
    }
    this.subscriptions.clear()
    this.centrifuge?.disconnect()
    this.centrifuge = null
  }

  on(type: string, handler: EventHandler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set())
    this.handlers.get(type)!.add(handler)
    return () => this.handlers.get(type)?.delete(handler)
  }

  // Subscribe to a Centrifugo channel using a subscription token.
  async subscribeChannel(channel: string, subscriptionToken: string): Promise<void> {
    if (this.subscriptions.has(channel)) {
      console.log('[centrifuge] subscribeChannel: already subscribed to', channel)
      return
    }
    if (!this.centrifuge) {
      console.log('[centrifuge] subscribeChannel: centrifuge not ready, retrying in 2s')
      await new Promise(r => setTimeout(r, 2000))
      if (!this.centrifuge) {
        console.log('[centrifuge] subscribeChannel: still not ready, giving up')
        return
      }
    }

    console.log('[centrifuge] subscribeChannel:', channel)
    const sub = this.centrifuge.newSubscription(channel, {
      token: subscriptionToken,
    })

    sub.on('publication', (ctx: any) => {
      const ev = ctx?.pub?.data || ctx?.data
      if (ev && typeof ev === 'object' && ev.type) {
        this.dispatch(ev.type, ev.data)
      } else if (typeof ev === 'string') {
        try { const parsed = JSON.parse(ev); if (parsed.type) this.dispatch(parsed.type, parsed.data) } catch {}
      }
    })

    sub.on('subscribed', (ctx) => {
      console.log('[centrifuge] SUBSCRIBED to', channel, ctx)
    })

    sub.subscribe()
    this.subscriptions.set(channel, sub)
  }

  // Unsubscribe from a channel.
  unsubscribeChannel(channel: string): void {
    const sub = this.subscriptions.get(channel)
    if (sub) {
      sub.unsubscribe()
      this.subscriptions.delete(channel)
    }
  }

  // Publish to a channel (not allowed in normal mode — server publishes only).
  // Kept for backward compatibility; Centrifugo denies client publish.
  send(type: string, data?: unknown) {
    // In the new architecture, clients don't publish directly.
    // All events go through the REST API -> server publishes to Centrifugo.
    // This method is kept as a no-op for backward compatibility.
    void type
    void data
  }

  private dispatch(type: string, data: any) {
    const set = this.handlers.get(type)
    if (set) for (const h of [...set]) h(data)
  }
}
