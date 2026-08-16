// Аутентификация и присутствие пользователя.
import { defineStore } from 'pinia'
import { useSettingsStore } from './settings'
import { WsClient } from '../api/ws'
import type { User, PublicUser } from '../api/types'

const TOKEN_KEY = 'golosloom-token'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as User | null,
    token: localStorage.getItem(TOKEN_KEY) || '',
    // Пароль запоминаем только в памяти (не localStorage): нужен для KEK
    // (парольные бэкапы ключей каналов). При перезагрузке страницы пароль
    // исчезает — KEK берётся из хранилища.
    password: '' as string,
    ws: new WsClient(),
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
    connectWs() {
      const settings = useSettingsStore()
      this.ws.connect(settings.serverUrl, this.token)
      this.connected = true
    },
    logout() {
      this.ws.disconnect()
      this.token = ''
      this.password = ''
      this.user = null
      localStorage.removeItem(TOKEN_KEY)
    },
  },
})
