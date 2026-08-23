// Centrifugo client wrapper: replaces raw WebSocket with Centrifuge JS SDK.
// Uses connection JWT (no channel list) + subscription tokens (per-channel).
import { Centrifuge, type Subscription } from 'centrifuge'
import type { WSEvent } from './types'

export type EventHandler = (data: any) => void
// Callback to get a fresh subscription token for a channel (called on reconnect).
export type TokenProvider = (channel: string) => Promise<string | null>

export class CentrifugeClient {
  private centrifuge: Centrifuge | null = null
  private handlers = new Map<string, Set<EventHandler>>()
  private subscriptions = new Map<string, Subscription>()
  // Store channel names and token providers for re-subscription on reconnect.
  private channelTokens = new Map<string, TokenProvider>()
  private baseUrl = ''
  private connectionToken = ''
  private shouldReconnect = true
  private tokenProvider: TokenProvider | null = null

  connect(serverUrl: string, centrifugoUrl: string, connectionToken: string, tokenProvider?: TokenProvider) {
    // Already connected with the same token — skip.
    if (this.centrifuge && this.connectionToken === connectionToken) {
      console.log('[centrifuge] already connected, skipping')
      return
    }
    // Disconnect old connection before creating a new one.
    if (this.centrifuge) {
      this.shouldReconnect = false
      this.centrifuge.disconnect()
      this.centrifuge = null
      this.shouldReconnect = true
    }
    // centrifugoUrl from server is just the path (e.g. "/centrifugo").
    let origin = serverUrl
    if (!origin && typeof window !== 'undefined' && window.location && window.location.origin !== 'null' && !window.location.origin.startsWith('file')) {
      origin = window.location.origin
    }
    this.baseUrl = origin.replace(/\/$/, '') + centrifugoUrl
    this.connectionToken = connectionToken
    this.tokenProvider = tokenProvider || null
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
      const ev = ctx?.pub?.data || ctx?.data
      if (ev && typeof ev === 'object' && ev.type) {
        this.dispatch(ev.type, ev.data)
      }
    })

    this.centrifuge.on('subscribed', (ctx: any) => {
      console.log('[centrifuge] subscribed to:', ctx?.channel || 'unknown')
    })

    this.centrifuge.on('disconnected', (ctx: any) => {
      console.log('[centrifuge] disconnected', ctx?.code, ctx?.reason)
    })

    this.centrifuge.on('connected', () => {
      console.log('[centrifuge] connected — re-subscribing', this.channelTokens.size, 'channels')
      this.resubscribeAll()
    })

    this.centrifuge.connect()
  }

  disconnect() {
    this.shouldReconnect = false
    for (const [, sub] of this.subscriptions) {
      sub.unsubscribe()
    }
    this.subscriptions.clear()
    this.channelTokens.clear()
    this.centrifuge?.disconnect()
    this.centrifuge = null
  }

  on(type: string, handler: EventHandler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set())
    this.handlers.get(type)!.add(handler)
    return () => this.handlers.get(type)?.delete(handler)
  }

  // Subscribe to a Centrifugo channel using a subscription token.
  // tokenProvider is saved for re-subscription on reconnect.
  async subscribeChannel(channel: string, subscriptionToken: string, tokenProvider?: TokenProvider): Promise<void> {
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

    // Save for reconnection
    const provider = tokenProvider || this.tokenProvider
    if (provider) {
      this.channelTokens.set(channel, provider)
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

    sub.on('subscriptionError', (ctx: any) => {
      console.error('[centrifuge] subscriptionError on', channel, ctx)
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
    this.channelTokens.delete(channel)
  }

  // Re-subscribe all channels after reconnection with fresh tokens.
  private async resubscribeAll() {
    for (const [channel, provider] of this.channelTokens) {
      try {
        const freshToken = await provider(channel)
        if (!freshToken) {
          console.error('[centrifuge] resubscribeAll: no token for', channel)
          continue
        }
        // Remove old subscription
        const old = this.subscriptions.get(channel)
        if (old) {
          try { old.unsubscribe() } catch {}
          this.subscriptions.delete(channel)
        }
        // Subscribe with fresh token
        await this.subscribeChannel(channel, freshToken, provider)
        console.log('[centrifuge] resubscribed to', channel)
      } catch (e) {
        console.error('[centrifuge] resubscribeAll failed for', channel, e)
      }
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
