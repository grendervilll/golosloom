// Глобальная подготовка тестов: localStorage и IndexedDB для jsdom.
import 'fake-indexeddb/auto'

class MemoryStorage {
  private data = new Map<string, string>()
  getItem(k: string): string | null {
    return this.data.has(k) ? this.data.get(k)! : null
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v)
  }
  removeItem(k: string): void {
    this.data.delete(k)
  }
  clear(): void {
    this.data.clear()
  }
}

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage() })
}
if (typeof globalThis.crypto === 'undefined') {
  Object.defineProperty(globalThis, 'crypto', { value: require('crypto').webcrypto })
}
