/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: DefineComponent<{}, {}, any>
  export default component
}

// Electron (десктоп): безопасное хранилище + системные пуши.
interface Window {
  __ELECTRON__?: {
    secureStorage: {
      get(key: string): Promise<string | null>
      set(key: string, value: string): Promise<void>
      delete(key: string): Promise<void>
    }
    notify?: {
      show: (opts: { title: string; body: string; tag?: string }) => Promise<boolean>
      focus: () => Promise<boolean>
      onClicked: (cb: (tag: string) => void) => () => void
    }
  }
}
