// Безопасное хранение ключей шифрования.
// Веб: IndexedDB, мастер-ключ WebCrypto (non-extractable), ключи каналов
// хранятся зашифрованными мастер-ключом.
// Tauri: системная Keychain через Rust-команды.

export interface KeyStorage {
  init(): Promise<void>
  saveChannelKey(channelId: number, keyBytes: Uint8Array): Promise<void>
  loadChannelKey(channelId: number): Promise<Uint8Array | null>
  // Ключи устройства (identity): сохраняются, чтобы при каждом запуске
  // (особенно в Tauri) не регистрировать новое устройство — иначе ключи
  // личных чатов/сообществ нужно раздавать заново при каждом запуске.
  saveDevice(deviceJson: string): Promise<void>
  loadDevice(): Promise<string | null>
}

const DB_NAME = 'golosloom-keys'
const STORE = 'keys'
const MASTER = 'master'
const PREFIX = 'ch:'
const DEVICE = 'device'

export function isTauri(): boolean {
  return typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__
}

class IndexedDBStorage implements KeyStorage {
  private db: IDBDatabase | null = null
  private master: CryptoKey | null = null

  init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE)
      }
      req.onsuccess = () => {
        this.db = req.result
        resolve()
      }
      req.onerror = () => reject(req.error)
    })
  }

  private async getMaster(): Promise<CryptoKey | null> {
    if (this.master) return this.master
    const raw = await this.get(STORE, MASTER)
    if (raw) {
      this.master = raw as CryptoKey
      return this.master
    }
    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
    await this.put(STORE, MASTER, key)
    this.master = key
    return key
  }

  async saveChannelKey(channelId: number, keyBytes: Uint8Array): Promise<void> {
    const master = await this.getMaster()
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, master, keyBytes)
    const blob = new Uint8Array(iv.length + ciphertext.byteLength)
    blob.set(iv, 0)
    blob.set(new Uint8Array(ciphertext), iv.length)
    await this.put(STORE, PREFIX + channelId, blob)
  }

  async loadChannelKey(channelId: number): Promise<Uint8Array | null> {
    const master = await this.getMaster()
    const blob = await this.get(STORE, PREFIX + channelId)
    if (!blob) return null
    const data = blob as Uint8Array
    const iv = data.slice(0, 12)
    const ciphertext = data.slice(12)
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, master, ciphertext)
    return new Uint8Array(plain)
  }

  // Устройство хранится зашифрованным мастер-ключом (как ключи каналов).
  async saveDevice(deviceJson: string): Promise<void> {
    const master = await this.getMaster()
    const bytes = new TextEncoder().encode(deviceJson)
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, master, bytes)
    const blob = new Uint8Array(iv.length + ciphertext.byteLength)
    blob.set(iv, 0)
    blob.set(new Uint8Array(ciphertext), iv.length)
    await this.put(STORE, DEVICE, blob)
  }

  async loadDevice(): Promise<string | null> {
    const master = await this.getMaster()
    const blob = await this.get(STORE, DEVICE)
    if (!blob) return null
    const data = blob as Uint8Array
    const iv = data.slice(0, 12)
    const ciphertext = data.slice(12)
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, master, ciphertext)
      return new TextDecoder().decode(plain)
    } catch {
      return null
    }
  }

  private get(store: string, key: IDBValidKey): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(store, 'readonly')
      const req = tx.objectStore(store).get(key)
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => reject(req.error)
    })
  }

  // Прямой доступ по имени ключа без шифрования мастер-ключом —
  // используется как фолбэк для Tauri, когда Keychain недоступна.
  async rawGet(key: string): Promise<Uint8Array | null> {
    return (await this.get(STORE, key)) as Uint8Array | null
  }

  async rawSet(key: string, value: Uint8Array): Promise<void> {
    await this.put(STORE, key, value)
  }

  private put(store: string, key: IDBValidKey, value: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(store, 'readwrite')
      tx.objectStore(store).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }
}

// Tauri: Rust-команды secure_set / secure_get работают с системной Keychain.
// Если Keychain недоступна (сбой macOS Keychain, проблема с правами) —
// автоматически переключаемся на IndexedDB, чтобы чат и звонки продолжали
// работать (вебвью-хранилище приложения изолировано от других программ).
class TauriKeychainStorage implements KeyStorage {
  private masterKey: Uint8Array | null = null
  private idb: IndexedDBStorage | null = null

  async init(): Promise<void> {
    await this.ensureIdb()
    const raw = await this.safeGet(MASTER)
    if (raw) {
      this.masterKey = raw
    } else {
      this.masterKey = crypto.getRandomValues(new Uint8Array(32))
      await this.safeSet(MASTER, this.masterKey)
    }
  }

  async saveChannelKey(channelId: number, keyBytes: Uint8Array): Promise<void> {
    const wrapped = await wrapWithMaster(keyBytes, this.masterKey!)
    await this.safeSet(PREFIX + channelId, wrapped)
  }

  async loadChannelKey(channelId: number): Promise<Uint8Array | null> {
    const wrapped = await this.safeGet(PREFIX + channelId)
    if (!wrapped) return null
    return unwrapWithMaster(wrapped, this.masterKey!)
  }

  // Устройство в Keychain хранится открытым текстом (Keychain шифрует сама),
  // при фолбэке на IndexedDB — тоже (внутри изолированного хранилища вебвью).
  async saveDevice(deviceJson: string): Promise<void> {
    await this.safeSet(DEVICE, new TextEncoder().encode(deviceJson))
  }

  async loadDevice(): Promise<string | null> {
    const raw = await this.safeGet(DEVICE)
    if (!raw) return null
    return new TextDecoder().decode(raw)
  }

  private async ensureIdb() {
    if (!this.idb) {
      this.idb = new IndexedDBStorage()
      await this.idb.init()
    }
  }

  // Чтение: Keychain, при ошибке — IndexedDB.
  private async safeGet(key: string): Promise<Uint8Array | null> {
    try {
      const b64: string | null = await window.__TAURI__.core.invoke('secure_get', { key })
      if (b64) return bytesFromB64(b64)
    } catch {
      /* Keychain недоступна — фолбэк ниже */
    }
    return (this.idb as any).rawGet(key)
  }

  // Запись: Keychain, при ошибке — IndexedDB.
  private async safeSet(key: string, value: Uint8Array): Promise<void> {
    try {
      await window.__TAURI__.core.invoke('secure_set', { key, value: bytesToB64(value) })
      return
    } catch {
      /* Keychain недоступна — фолбэк ниже */
    }
    await (this.idb as any).rawSet(key, value)
  }
}

async function wrapWithMaster(key: Uint8Array, master: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const imported = await crypto.subtle.importKey('raw', master, { name: 'AES-GCM' }, false, ['encrypt'])
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, imported, key))
  const out = new Uint8Array(12 + ct.length)
  out.set(iv, 0)
  out.set(ct, 12)
  return out
}

async function unwrapWithMaster(wrapped: Uint8Array, master: Uint8Array): Promise<Uint8Array> {
  const iv = wrapped.slice(0, 12)
  const ct = wrapped.slice(12)
  const imported = await crypto.subtle.importKey('raw', master, { name: 'AES-GCM' }, false, ['decrypt'])
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, imported, ct))
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function bytesFromB64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

let instance: KeyStorage | null = null

export async function getKeyStorage(): Promise<KeyStorage> {
  if (!instance) {
    instance = isTauri() ? new TauriKeychainStorage() : new IndexedDBStorage()
  }
  await instance.init()
  return instance
}

// Сброс хранилища (используется в тестах для изоляции).
export function resetKeyStorage(): void {
  instance = null
}
