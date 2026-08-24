import { app, dialog, shell, BrowserWindow, net } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import Store from 'electron-store'

const REPO = 'grendervilll/golosloom'
const DISMISSED_KEY = 'dismissedUpdateVersion'

type StoreType = {
  dismissedVersion?: string
}

const store = new Store<StoreType>()

interface ReleaseAsset {
  name: string
  browser_download_url: string
}

interface ReleaseInfo {
  tag_name: string
  html_url: string
  assets: ReleaseAsset[]
}

function parseVersion(v: string): number[] {
  const m = v.trim().replace(/^v/, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
  if (!m) return [0, 0, 0]
  return [1, 2, 3].map((i) => parseInt(m[i] || '0', 10))
}

export function isNewer(latest: string, current: string): boolean {
  const l = parseVersion(latest)
  const c = parseVersion(current)
  for (let i = 0; i < 3; i++) {
    if (l[i] !== c[i]) return l[i] > c[i]
  }
  return false
}

async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  return new Promise((resolve) => {
    const req = net.request({
      method: 'GET',
      url: `https://api.github.com/repos/${REPO}/releases/latest`,
      headers: { 'User-Agent': 'golosloom-desktop', Accept: 'application/vnd.github+json' },
    })
    let data = ''
    req.on('response', (res) => {
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) return resolve(null)
          const j = JSON.parse(data)
          resolve(j as ReleaseInfo)
        } catch {
          resolve(null)
        }
      })
    })
    req.on('error', () => resolve(null))
    req.end()
  })
}

function pickAsset(assets: ReleaseAsset[]): ReleaseAsset | null {
  const platform = process.platform // win32, darwin, linux
  const arch = process.arch // x64, arm64, etc.

  // Фильтруем по платформе
  let candidates = assets.filter((a) => {
    const n = a.name.toLowerCase()
    if (platform === 'win32') return n.includes('win') || n.endsWith('.exe')
    if (platform === 'darwin') return n.includes('mac') || n.includes('darwin') || n.endsWith('.dmg') || n.endsWith('.zip')
    if (platform === 'linux') return n.includes('linux') || n.endsWith('.appimage') || n.endsWith('.deb')
    return true
  })

  if (candidates.length === 0) candidates = assets

  // Фильтруем по архитектуре — process.arch уже даёт метку, доп. теги не нужны.
  // Доступные arch: x64, arm64, ia32, etc.
  // Ищем asset, содержащий arch в имени, иначе берём универсальный.
  const archCandidates = candidates.filter((a) => a.name.toLowerCase().includes(arch))
  if (archCandidates.length > 0) {
    // Предпочитаем dmg для mac, nsis для win, AppImage для linux
    const preferred = archCandidates.find((a) => {
      const n = a.name.toLowerCase()
      if (platform === 'darwin') return n.endsWith('.dmg')
      if (platform === 'win32') return n.endsWith('.exe') || n.includes('nsis')
      if (platform === 'linux') return n.endsWith('.appimage')
      return true
    })
    return preferred || archCandidates[0]
  }

  // Универсальные (без arch в имени) — часто x64 по умолчанию
  // Для macOS arm64 может использовать универсальный dmg, если нет arch-специфичного
  const universal = candidates.find((a) => {
    const n = a.name.toLowerCase()
    if (platform === 'darwin') return n.endsWith('.dmg')
    if (platform === 'win32') return n.endsWith('.exe')
    if (platform === 'linux') return n.endsWith('.appimage')
    return true
  })
  return universal || candidates[0] || null
}

async function downloadToDownloads(url: string, fileName: string, win: BrowserWindow | null, onProgress?: (pct: number) => void): Promise<string> {
  const downloadsPath = app.getPath('downloads')
  const dest = path.join(downloadsPath, fileName)

  // Если файл уже есть — перезапишем
  if (fs.existsSync(dest)) {
    try {
      fs.unlinkSync(dest)
    } catch {}
  }

  return new Promise((resolve, reject) => {
    const req = net.request({ method: 'GET', url })
    req.on('response', (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }
      const total = parseInt((res.headers['content-length'] as string) || '0', 10) || 0
      let received = 0
      const file = fs.createWriteStream(dest)
      res.on('data', (chunk: Buffer) => {
        received += chunk.length
        if (total && onProgress && win && !win.isDestroyed()) {
          const pct = Math.round((received / total) * 100)
          win.webContents.send('update:progress', pct)
        }
      })
      ;(res as any).pipe(file)
      file.on('finish', () => {
        file.close(() => resolve(dest))
      })
      file.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
}

let pendingUpdate: { version: string; asset: ReleaseAsset } | null = null

export function getPendingUpdate(): { version: string; asset: ReleaseAsset } | null {
  return pendingUpdate
}

export async function checkForUpdates(win: BrowserWindow | null): Promise<{ version: string; asset: ReleaseAsset } | null> {
  const current = app.getVersion()
  const release = await fetchLatestRelease()
  if (!release || !release.tag_name) return null

  const latest = release.tag_name.replace(/^v/, '')
  if (!isNewer(latest, current)) return null

  const dismissed = store.get('dismissedVersion')
  if (dismissed === latest) return null

  const asset = pickAsset(release.assets)
  if (!asset) return null

  pendingUpdate = { version: latest, asset }
  return pendingUpdate
}

export function dismissVersion(version: string) {
  store.set('dismissedVersion', version)
  if (pendingUpdate?.version === version) pendingUpdate = null
}

export async function downloadAndInstall(win: BrowserWindow | null, asset: ReleaseAsset): Promise<void> {
  if (!win || win.isDestroyed()) {
    const all = BrowserWindow.getAllWindows()
    win = all[0] || null
  }

  const fileName = asset.name
  const url = asset.browser_download_url

  if (win && !win.isDestroyed()) {
    win.webContents.send('update:progress', 0)
  }

  const dest = await downloadToDownloads(url, fileName, win, (pct) => {
    if (win && !win.isDestroyed()) win.webContents.send('update:progress', pct)
  })

  if (win && !win.isDestroyed()) {
    win.webContents.send('update:progress', 100)
  }

  // Открываем файл — ОС сама запустит установщик / смонтирует dmg / откроет deb
  // Для AppImage — просто сохраняем в Загрузки, пользователь запустит вручную
  const opened = await shell.openPath(dest)
  if (opened) {
    // shell.openPath возвращает ошибку как строку, если не удалось
    throw new Error(opened)
  }
}

// Для IPC — проверка и диалог
export async function handleUpdateCheck(win: BrowserWindow | null): Promise<{ version: string; assetName: string } | null> {
  const res = await checkForUpdates(win)
  if (!res) return null
  return { version: res.version, assetName: res.asset.name }
}
