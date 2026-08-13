// Настройки клиента: адрес сервера (вводится при первом запуске в Tauri),
// громкость, шумоподавление и прочие предпочтения.
import { defineStore } from 'pinia'
import { ApiClient } from '../api/http'
import type { ServerConfigShape } from '../api/http'

const SETTINGS_KEY = 'golosloom-settings'

export interface ClientSettings {
  serverUrl: string
  chatHidden: boolean
  noiseSuppression: 'off' | 'low' | 'medium' | 'high'
  mutedOthers: boolean
  screenQuality: string
  volumes: Record<number, number>
  theme: 'light' | 'dark'
}

function defaultTheme(): 'light' | 'dark' {
  if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

function defaultSettings(): ClientSettings {
  return {
    serverUrl: defaultServerUrl(),
    chatHidden: false,
    noiseSuppression: 'low',
    mutedOthers: false,
    screenQuality: '1080p60',
    volumes: {},
    theme: defaultTheme(),
  }
}

function defaultServerUrl(): string {
  // В Tauri origin вебвью — tauri://localhost, это не адрес сервера:
  // оставляем пустым, чтобы при первом запуске показать окно настройки.
  if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
    return ''
  }
  if (typeof window !== 'undefined' && window.location && window.location.origin !== 'null') {
    return window.location.origin
  }
  return 'http://localhost:8080'
}

function load(): ClientSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return { ...defaultSettings(), ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return defaultSettings()
}

export const useSettingsStore = defineStore('settings', {
  state: (): ClientSettings & { serverConfig: ServerConfigShape | null; api: ApiClient } => ({
    ...load(),
    serverConfig: null,
    api: new ApiClient(load().serverUrl),
  }),
  getters: {
    hasServer: (s) => !!s.serverUrl,
  },
  actions: {
    persist() {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({
          serverUrl: this.serverUrl,
          chatHidden: this.chatHidden,
          noiseSuppression: this.noiseSuppression,
          mutedOthers: this.mutedOthers,
          screenQuality: this.screenQuality,
          volumes: this.volumes,
          theme: this.theme,
        }),
      )
    },
    // Применение темы к документу (CSS: :root[data-theme='dark']).
    applyTheme() {
      document.documentElement.dataset.theme = this.theme
    },
    setTheme(theme: 'light' | 'dark') {
      this.theme = theme
      this.persist()
      this.applyTheme()
    },
    setServerUrl(url: string) {
      this.serverUrl = url.replace(/\/+$/, '')
      this.api = new ApiClient(this.serverUrl)
      this.persist()
    },
    async loadConfig(): Promise<ServerConfigShape> {
      this.serverConfig = await this.api.config()
      return this.serverConfig
    },
    setChatHidden(hidden: boolean) {
      this.chatHidden = hidden
      this.persist()
    },
    setNoiseSuppression(v: ClientSettings['noiseSuppression']) {
      this.noiseSuppression = v
      this.persist()
    },
    setMutedOthers(muted: boolean) {
      this.mutedOthers = muted
      this.persist()
    },
    setScreenQuality(q: string) {
      this.screenQuality = q
      this.persist()
    },
    setVolume(userId: number, volume: number) {
      this.volumes[userId] = volume
      this.persist()
    },
  },
})
