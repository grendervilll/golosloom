/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: DefineComponent<{}, {}, any>
  export default component
}

// Tauri (десктоп): глобальный __TAURI__ для Keychain-хранилища.
interface Window {
  __TAURI__?: {
    core?: {
      invoke(command: string, args?: Record<string, unknown>): Promise<unknown>
    }
  }
}
