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

  connect(centrifugoUrl: string, connectionToken: string) {
    // centrifugoUrl from server is just the path (e.g. "/centrifugo").
    // We need the full WebSocket URL with the current origin.
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    this.baseUrl = origin + centrifugoUrl
    this.connectionToken = connectionToken
    this.shouldReconnect = true
    this.open()
  }

  private open() {
    if (!this.baseUrl || !this.connectionToken) return
    // Centrifuge JS connects via WebSocket to the Centrifugo endpoint.
    // The URL must be ws(s)://host/centrifugo for WebSocket transport.
    const wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/connection/websocket'
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
      // Channel subscribed successfully
    })

    this.centrifuge.on('disconnected', () => {
      if (this.shouldReconnect) {
        // Centrifuge SDK handles reconnection automatically
      }
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
    if (this.subscriptions.has(channel)) return
    if (!this.centrifuge) return

    const sub = this.centrifuge.newSubscription(channel, {
      token: subscriptionToken,
    })

    sub.on('publication', (ctx: any) => {
      const ev = ctx?.data || ctx?.pub?.data
      if (ev && typeof ev === 'object' && ev.type) {
        this.dispatch(ev.type, ev.data)
      }
    })

    sub.on('subscribed', () => {
      // Channel subscription confirmed
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
