// Криптография клиента: X25519 (обмен ключами) + AES-256-GCM (шифрование).
// Протокол: общий ключ канала; при входе в канал ключ выдаётся участнику,
// обёрнутый его публичным ключом (эфимерный X25519 + AES-GCM).
import { x25519 } from '@noble/curves/ed25519'
import { sha256 } from '@noble/hashes/sha2'

const CHANNEL_KEY_LEN = 32
const IV_LEN = 12

export interface DeviceKeys {
  deviceId: string
  privateKey: Uint8Array
  publicKey: Uint8Array
}

export function generateDeviceId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'dev-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function generateDeviceKeys(): DeviceKeys {
  const privateKey = x25519.utils.randomPrivateKey()
  const publicKey = x25519.getPublicKey(privateKey)
  return { deviceId: generateDeviceId(), privateKey, publicKey }
}

export function generateChannelKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(CHANNEL_KEY_LEN))
}

async function deriveAesKey(sharedSecret: Uint8Array): Promise<CryptoKey> {
  const digest = sha256(sharedSecret)
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

// Обёртка ключа канала для устройства с публичным ключом peerPublicKey.
// Формат: ephemeralPublicKey(32) || iv(12) || ciphertext+tag.
export async function wrapChannelKey(
  channelKey: Uint8Array,
  peerPublicKey: Uint8Array,
): Promise<Uint8Array> {
  const ephemeralPrivate = x25519.utils.randomPrivateKey()
  const ephemeralPublic = x25519.getPublicKey(ephemeralPrivate)
  const shared = x25519.getSharedSecret(ephemeralPrivate, peerPublicKey)
  const aesKey = await deriveAesKey(shared)
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, channelKey))
  const out = new Uint8Array(ephemeralPublic.length + iv.length + ciphertext.length)
  out.set(ephemeralPublic, 0)
  out.set(iv, ephemeralPublic.length)
  out.set(ciphertext, ephemeralPublic.length + iv.length)
  return out
}

// Распаковка ключа канала своим приватным ключом.
export async function unwrapChannelKey(
  wrapped: Uint8Array,
  privateKey: Uint8Array,
): Promise<Uint8Array> {
  if (wrapped.length < 32 + IV_LEN + 16) throw new Error('Некорректный обёрнутый ключ')
  const ephemeralPublic = wrapped.slice(0, 32)
  const iv = wrapped.slice(32, 32 + IV_LEN)
  const ciphertext = wrapped.slice(32 + IV_LEN)
  const shared = x25519.getSharedSecret(privateKey, ephemeralPublic)
  const aesKey = await deriveAesKey(shared)
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ciphertext))
}

// Шифрование сообщения общим ключом канала.
export async function encryptMessage(
  channelKey: Uint8Array,
  plaintext: string,
): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
  const aesKey = await importChannelKey(channelKey)
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN))
  const data = new TextEncoder().encode(plaintext)
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, data))
  return { ciphertext, iv }
}

export async function decryptMessage(
  channelKey: Uint8Array,
  ciphertext: Uint8Array,
  iv: Uint8Array,
): Promise<string> {
  const aesKey = await importChannelKey(channelKey)
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ciphertext)
  return new TextDecoder().decode(data)
}

async function importChannelKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

// Ключ из пароля пользователя (KEK): расшифровывает парольные бэкапы
// ключей каналов на любом устройстве — достаточно пароля, онлайн-держатель
// ключа не нужен. Соль стабильна (от user_id), поэтому KEK воспроизводим
// на новом устройстве без данных с сервера.
export async function deriveKek(password: string, userId: number): Promise<Uint8Array> {
  const salt = new TextEncoder().encode('golosloom-kek-v1:' + userId)
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, material, 256)
  return new Uint8Array(bits)
}

// Шифрование ключа канала парольным KEK (AES-GCM, как в wrapChannelKey).
export async function wrapWithKek(kek: Uint8Array, channelKey: Uint8Array): Promise<Uint8Array> {
  const aes = await crypto.subtle.importKey('raw', kek, { name: 'AES-GCM' }, false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, channelKey))
  const out = new Uint8Array(12 + ct.length)
  out.set(iv, 0)
  out.set(ct, 12)
  return out
}

export async function unwrapWithKek(kek: Uint8Array, wrapped: Uint8Array): Promise<Uint8Array> {
  const aes = await crypto.subtle.importKey('raw', kek, { name: 'AES-GCM' }, false, ['decrypt'])
  const iv = wrapped.slice(0, 12)
  const ct = wrapped.slice(12)
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aes, ct))
}

export function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export { x25519 }
