// Аутентификация и присутствие пользователя.
import { defineStore } from 'pinia'
import { useSettingsStore } from './settings'
import { WsClient } from '../api/ws'
import { CentrifugeClient } from '../api/centrifuge'
import type { User, PublicUser } from '../api/types'

const TOKEN_KEY = 'golosloom-token'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as User | null,
    token: localStorage.getItem(TOKEN_KEY) || '',
    password: '' as string,
    ws: new WsClient(),
    centrifuge: new CentrifugeClient(),
    connected: false,
    useCentrifuge: false as boolean,
    users: [] as PublicUser[],
  }),
  getters: {
    isServerAdmin: (s) => !!s.user?.is_server_admin,
  },
  actions: {
    async login(nick: string, password: string): Promise<void> {
      const settings = useSettingsStore()
      const res = await settings.api.login(nick, password)
      if (!res || typeof res.token !== 'string') {
        throw new Error('Некорректный ответ сервера — проверьте адрес сервера')
      }
      this.token = res.token
      this.password = password
      localStorage.setItem(TOKEN_KEY, this.token)
      settings.api.setToken(this.token)
      await this.fetchMe()
      this.connectWs()
    },
    async register(nick: string, password: string, invite?: string): Promise<void> {
      const settings = useSettingsStore()
      const res = await settings.api.register(nick, password, invite)
      if (!res || typeof res.token !== 'string') {
        throw new Error('Некорректный ответ сервера — проверьте адрес сервера')
      }
      this.token = res.token
      this.password = password
      localStorage.setItem(TOKEN_KEY, this.token)
      settings.api.setToken(this.token)
      await this.fetchMe()
      this.connectWs()
    },
    async fetchMe(): Promise<void> {
      const settings = useSettingsStore()
      settings.api.setToken(this.token)
      this.user = await settings.api.me()
    },
    async refreshUsers(): Promise<void> {
      const settings = useSettingsStore()
      this.users = await settings.api.listUsers()
    },
    async connectWs() {
      const settings = useSettingsStore()
      await settings.loadConfig()
      // Use Centrifugo if server supports it, otherwise fall back to WebSocket.
      if (settings.serverConfig?.centrifugo_url) {
        try {
          const tokenRes = await settings.api.centrifugoToken()
          if (tokenRes?.token) {
            this.centrifuge.connect(settings.serverConfig.centrifugo_url, tokenRes.token)
            this.useCentrifuge = true
            this.connected = true
            return
          }
        } catch {
          // Centrifugo not available, fall back to WebSocket
        }
      }
      this.ws.connect(settings.serverUrl, this.token)
      this.connected = true
    },
    logout() {
      this.ws.disconnect()
      this.centrifuge.disconnect()
      this.token = ''
      this.password = ''
      this.user = null
      this.useCentrifuge = false
      localStorage.removeItem(TOKEN_KEY)
    },
  },
})
