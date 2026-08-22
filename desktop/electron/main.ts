import { app, BrowserWindow, ipcMain, safeStorage, nativeTheme, Menu, Tray, nativeImage } from 'electron'
import * as path from 'path'
import * as fs from 'fs'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

const isDev = !app.isPackaged

function createWindow() {
  mainWindow = new BrowserWindow({
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
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.on('close', (e) => {
    if (tray) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Minimize to tray on close (when tray is active)
  mainWindow.on('minimize', () => {
    if (tray) mainWindow?.hide()
  })
}

function createTray() {
  const iconPath = path.join(__dirname, '..', 'resources', process.platform === 'win32' ? 'icon.ico' : 'icon.png')
  if (!fs.existsSync(iconPath)) return
  const icon = nativeImage.createFromPath(iconPath)
  tray = new Tray(icon)
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Открыть Golosloom', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Выход', click: () => { tray?.destroy(); app.quit() } },
  ])
  tray.setToolTip('Golosloom')
  tray.setContextMenu(contextMenu)
  tray.on('double-click', () => mainWindow?.show())
}

// ---- IPC: secureStorage (safeStorage from Electron) ----

ipcMain.handle('secure:get', async (_event, key: string) => {
  try {
    const encrypted = fs.readFileSync(getSecurePath(key))
    return safeStorage.decryptString(encrypted)
  } catch {
    return null
  }
})

ipcMain.handle('secure:set', async (_event, key: string, value: string) => {
  const encrypted = safeStorage.encryptString(value)
  fs.writeFileSync(getSecurePath(key), encrypted)
})

ipcMain.handle('secure:delete', async (_event, key: string) => {
  try {
    fs.unlinkSync(getSecurePath(key))
  } catch {
    // ignore
  }
})

function getSecurePath(key: string): string {
  const dir = path.join(app.getPath('userData'), 'secure')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, Buffer.from(key).toString('hex'))
}

// ---- App lifecycle ----

app.whenReady().then(() => {
  createWindow()
  if (process.platform !== 'darwin') createTray()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else mainWindow?.show()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (tray) { tray.destroy(); tray = null }
  mainWindow?.removeAllListeners('close')
  mainWindow?.close()
})
