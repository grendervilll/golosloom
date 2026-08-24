import { app, BrowserWindow, ipcMain, safeStorage, nativeTheme, Menu, Tray, nativeImage, Notification } from 'electron'
import * as path from 'path'
import * as fs from 'fs'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

const isDev = !app.isPackaged

// Windows: нужен AppUserModelID для системных тостов
if (process.platform === 'win32') {
  app.setAppUserModelId('com.golosloom.golosloom')
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Golosloom',
    width: 1280,
    height: 800,
    minWidth: 420,
    minHeight: 320,
    frame: true,
    autoHideMenuBar: false,
    backgroundColor: '#1e1f22',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: path.join(__dirname, '..', 'resources', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 12, y: 12 } : undefined,
    show: false,
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'app', 'index.html'))
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

// ---- IPC: системные пуши (Windows/macOS/Linux) ----

ipcMain.handle('notify:show', async (_event, opts: { title: string; body: string; tag?: string }) => {
  const title = (opts.title || 'Golosloom').slice(0, 128)
  const body = (opts.body || '').slice(0, 256)
  // Не спамим, если окно в фокусе — решает рендерер, но на всякий случай
  // показываем всегда, когда пришло событие из main (вызов уже отфильтрован)
  if (!Notification.isSupported()) return false
  const iconPath = path.join(__dirname, '..', 'resources', process.platform === 'win32' ? 'icon.ico' : 'icon.png')
  const n = new Notification({
    title,
    body,
    icon: fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined,
    urgency: 'normal',
    // tag для группировки (Windows/macOS схлопывают по tag)
    ...(opts.tag ? { tag: opts.tag } as any : {}),
  })
  n.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      if (!mainWindow.isVisible()) mainWindow.show()
      mainWindow.focus()
      mainWindow.webContents.send('notify:clicked', opts.tag || '')
    } else {
      createWindow()
    }
  })
  n.show()
  // На Windows/Linux — мигание таскбара, на macOS — бейдж
  if (process.platform === 'win32' && mainWindow && !mainWindow.isFocused()) {
    mainWindow.flashFrame(true)
    n.on('close', () => mainWindow?.flashFrame(false))
  }
  return true
})

ipcMain.handle('notify:focus', async () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    if (!mainWindow.isVisible()) mainWindow.show()
    mainWindow.focus()
  }
  return true
})

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
