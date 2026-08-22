// Аутентификация и присутствие пользователя.
import { defineStore } from 'pinia'
import { useSettingsStore } from './settings'
import { CentrifugeClient } from '../api/centrifuge'
import type { User, PublicUser } from '../api/types'

const TOKEN_KEY = 'golosloom-token'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as User | null,
    token: localStorage.getItem(TOKEN_KEY) || '',
    password: '' as string,
    centrifuge: new CentrifugeClient(),
    connected: false,
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
      this.connect()
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
      this.connect()
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
    async connect() {
      const settings = useSettingsStore()
      await settings.loadConfig()
      if (settings.serverConfig?.centrifugo_url) {
        try {
          const tokenRes = await settings.api.centrifugoToken()
          if (tokenRes?.token) {
            this.centrifuge.connect(settings.serverConfig.centrifugo_url, tokenRes.token)
            this.connected = true
            return
          }
        } catch {
          /* Centrifugo unavailable */
        }
      }
    },
    logout() {
      this.centrifuge.disconnect()
      this.token = ''
      this.password = ''
      this.user = null
      localStorage.removeItem(TOKEN_KEY)
    },
  },
})
