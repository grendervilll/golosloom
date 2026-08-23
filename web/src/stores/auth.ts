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
      console.log('[auth] connect: centrifugo_url =', settings.serverConfig?.centrifugo_url)
      if (settings.serverConfig?.centrifugo_url) {
        try {
          const tokenRes = await settings.api.centrifugoToken()
          console.log('[auth] centrifugo token:', tokenRes?.token ? 'OK' : 'FAIL')
          if (tokenRes?.token) {
            // Token provider: gets a fresh subscription token for any channel on reconnect.
            const tokenProvider = async (channel: string): Promise<string | null> => {
              try {
                const res = await settings.api.centrifugoSubscribe(channel)
                return res?.token || null
              } catch { return null }
            }
            try {
              this.centrifuge.connect(settings.serverUrl, settings.serverConfig.centrifugo_url, tokenRes.token, tokenProvider)
            } catch { /* Centrifuge SDK error */ }
            this.connected = true
            // Подписываемся на личный канал user:{id} для звонков и приглашений
            if (this.user) {
              console.log('[auth] subscribing to user:' + this.user.id)
              for (let i = 0; i < 10; i++) {
                try {
                  const subRes = await settings.api.centrifugoSubscribe('user:' + this.user!.id)
                  if (subRes?.token) {
                    this.centrifuge.subscribeChannel('user:' + this.user!.id, subRes.token, tokenProvider)
                    console.log('[auth] user channel subscribed')
                    break
                  }
                } catch (e) { console.log('[auth] subscribe error:', e) }
                await new Promise(r => setTimeout(r, 1000))
              }
            } else {
              console.log('[auth] user is null, cannot subscribe')
            }
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
