"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
let mainWindow = null;
let tray = null;
const isDev = !electron_1.app.isPackaged;
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        title: 'Golosloom',
        width: 1280,
        height: 800,
        minWidth: 420,
        minHeight: 320,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
        icon: path.join(__dirname, '..', 'resources', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        show: false,
    });
    mainWindow.once('ready-to-show', () => {
        mainWindow?.show();
    });
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
    else {
        mainWindow.loadFile(path.join(__dirname, '..', 'app', 'index.html'));
    }
    mainWindow.on('close', (e) => {
        if (tray) {
            e.preventDefault();
            mainWindow?.hide();
        }
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
    // Minimize to tray on close (when tray is active)
    mainWindow.on('minimize', () => {
        if (tray)
            mainWindow?.hide();
    });
}
function createTray() {
    const iconPath = path.join(__dirname, '..', 'resources', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
    if (!fs.existsSync(iconPath))
        return;
    const icon = electron_1.nativeImage.createFromPath(iconPath);
    tray = new electron_1.Tray(icon);
    const contextMenu = electron_1.Menu.buildFromTemplate([
        { label: 'Открыть Golosloom', click: () => mainWindow?.show() },
        { type: 'separator' },
        { label: 'Выход', click: () => { tray?.destroy(); electron_1.app.quit(); } },
    ]);
    tray.setToolTip('Golosloom');
    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => mainWindow?.show());
}
// ---- IPC: secureStorage (safeStorage from Electron) ----
electron_1.ipcMain.handle('secure:get', async (_event, key) => {
    try {
        const encrypted = fs.readFileSync(getSecurePath(key));
        return electron_1.safeStorage.decryptString(encrypted);
    }
    catch {
        return null;
    }
});
electron_1.ipcMain.handle('secure:set', async (_event, key, value) => {
    const encrypted = electron_1.safeStorage.encryptString(value);
    fs.writeFileSync(getSecurePath(key), encrypted);
});
electron_1.ipcMain.handle('secure:delete', async (_event, key) => {
    try {
        fs.unlinkSync(getSecurePath(key));
    }
    catch {
        // ignore
    }
});
function getSecurePath(key) {
    const dir = path.join(electron_1.app.getPath('userData'), 'secure');
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, Buffer.from(key).toString('hex'));
}
// ---- App lifecycle ----
electron_1.app.whenReady().then(() => {
    createWindow();
    if (process.platform !== 'darwin')
        createTray();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
        else
            mainWindow?.show();
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
electron_1.app.on('before-quit', () => {
    if (tray) {
        tray.destroy();
        tray = null;
    }
    mainWindow?.removeAllListeners('close');
    mainWindow?.close();
});
