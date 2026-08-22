/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: DefineComponent<{}, {}, any>
  export default component
}

// Electron (десктоп): безопасное хранилище ключей через safeStorage.
interface Window {
  __ELECTRON__?: {
    secureStorage: {
      get(key: string): Promise<string | null>
      set(key: string, value: string): Promise<void>
      delete(key: string): Promise<void>
    }
  }
}
