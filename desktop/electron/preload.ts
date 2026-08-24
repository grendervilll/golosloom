import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('__ELECTRON__', {
  secureStorage: {
    get: (key: string): Promise<string | null> => ipcRenderer.invoke('secure:get', key),
    set: (key: string, value: string): Promise<void> => ipcRenderer.invoke('secure:set', key, value),
    delete: (key: string): Promise<void> => ipcRenderer.invoke('secure:delete', key),
  },
  notify: {
    show: (opts: { title: string; body: string; tag?: string }): Promise<boolean> =>
      ipcRenderer.invoke('notify:show', opts),
    focus: (): Promise<boolean> => ipcRenderer.invoke('notify:focus'),
    onClicked: (cb: (tag: string) => void) => {
      const handler = (_e: unknown, tag: string) => cb(tag)
      ipcRenderer.on('notify:clicked', handler)
      return () => ipcRenderer.removeListener('notify:clicked', handler)
    },
  },
  updater: {
    check: (): Promise<{ version: string; assetName: string } | null> => ipcRenderer.invoke('update:check'),
    dismiss: (version: string): Promise<boolean> => ipcRenderer.invoke('update:dismiss', version),
    download: (): Promise<boolean> => ipcRenderer.invoke('update:download'),
    onAvailable: (cb: (version: string, assetName?: string) => void) => {
      const handler = (_e: unknown, v: string, a?: string) => cb(v, a)
      ipcRenderer.on('update:available', handler)
      return () => ipcRenderer.removeListener('update:available', handler)
    },
    onProgress: (cb: (pct: number) => void) => {
      const handler = (_e: unknown, pct: number) => cb(pct)
      ipcRenderer.on('update:progress', handler)
      return () => ipcRenderer.removeListener('update:progress', handler)
    },
    onError: (cb: (msg: string) => void) => {
      const handler = (_e: unknown, msg: string) => cb(msg)
      ipcRenderer.on('update:error', handler)
      return () => ipcRenderer.removeListener('update:error', handler)
    },
  },
})
