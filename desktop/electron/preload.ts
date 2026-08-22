import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('__ELECTRON__', {
  secureStorage: {
    get: (key: string): Promise<string | null> => ipcRenderer.invoke('secure:get', key),
    set: (key: string, value: string): Promise<void> => ipcRenderer.invoke('secure:set', key, value),
    delete: (key: string): Promise<void> => ipcRenderer.invoke('secure:delete', key),
  },
})
