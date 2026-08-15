// Аутентификация и присутствие пользователя.
import { defineStore } from 'pinia'
import { useSettingsStore } from './settings'
import { WsClient } from '../api/ws'
import { deriveKek } from '../crypto/crypto'
import { getKeyStorage } from '../crypto/storage'
import type { User, PublicUser } from '../api/types'

const TOKEN_KEY = 'golosloom-token'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as User | null,
    token: localStorage.getItem(TOKEN_KEY) || '',
    // Пароль хранится только в памяти (для парольных бэкапов ключей);
    // не персистится. При авто-входе по токену используется сохранённый KEK.
    password: '',
    ws: new WsClient(),
    connected: false,
    users: [] as PublicUser[],
  }),
  getters: {
    isServerAdmin: (s) => !!s.user?.is_server_admin,
  },
  actions: {
    // Сохранение ключа из пароля (KEK): он нужен для расшифровки
    // парольных бэкапов ключей на любом устройстве, в т.ч. после
    // перезагрузки/авто-входа по токену.
    async persistKek(password: string) {
      try {
        const k = await deriveKek(password, Number(this.user?.id || 0))
        const storage = await getKeyStorage()
        await storage.saveKek(k)
      } catch {
        /* не критично: KEK выведется позже из пароля в памяти */
      }
    },
    async login(nick: string, password: string): Promise<void> {
      const settings = useSettingsStore()
      this.password = password
      const res = await settings.api.login(nick, password)
      if (!res || typeof res.token !== 'string') {
        throw new Error('Некорректный ответ сервера — проверьте адрес сервера')
      }
      this.token = res.token
      localStorage.setItem(TOKEN_KEY, this.token)
      settings.api.setToken(this.token)
      await this.fetchMe()
      await this.persistKek(password)
      this.connectWs()
    },
    async register(nick: string, password: string, invite?: string): Promise<void> {
      const settings = useSettingsStore()
      this.password = password
      const res = await settings.api.register(nick, password, invite)
      if (!res || typeof res.token !== 'string') {
        throw new Error('Некорректный ответ сервера — проверьте адрес сервера')
      }
      this.token = res.token
      localStorage.setItem(TOKEN_KEY, this.token)
      settings.api.setToken(this.token)
      await this.fetchMe()
      await this.persistKek(password)
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
      this.user = null
      this.password = ''
      localStorage.removeItem(TOKEN_KEY)
    },
  },
})
