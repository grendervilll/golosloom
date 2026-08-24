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
})
