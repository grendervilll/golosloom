"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('__ELECTRON__', {
    secureStorage: {
        get: (key) => electron_1.ipcRenderer.invoke('secure:get', key),
        set: (key, value) => electron_1.ipcRenderer.invoke('secure:set', key, value),
        delete: (key) => electron_1.ipcRenderer.invoke('secure:delete', key),
    },
});
