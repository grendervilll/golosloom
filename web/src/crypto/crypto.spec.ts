// Тесты криптографии: X25519, обёртка/распаковка ключа канала, шифрование сообщений.
import { describe, expect, it } from 'vitest'
import {
  generateChannelKey,
  generateDeviceKeys,
  generateDeviceId,
  wrapChannelKey,
  unwrapChannelKey,
  encryptMessage,
  decryptMessage,
  bytesToB64,
  b64ToBytes,
} from '../crypto/crypto'

describe('криптография', () => {
  it('генерирует ключи устройства (X25519)', () => {
    const a = generateDeviceKeys()
    const b = generateDeviceKeys()
    expect(a.privateKey).toHaveLength(32)
    expect(a.publicKey).toHaveLength(32)
    expect(a.deviceId).toBeTruthy()
    expect(a.publicKey).not.toEqual(b.publicKey)
  })

  it('оборачивает ключ канала для устройства, и устройство его распаковывает', async () => {
    const alice = generateDeviceKeys()
    const bob = generateDeviceKeys()
    const channelKey = generateChannelKey()
    expect(channelKey).toHaveLength(32)

    const wrapped = await wrapChannelKey(channelKey, bob.publicKey)
    // Формат: ephemeralPub(32) || iv(12) || ct+tag
    expect(wrapped.length).toBeGreaterThan(32 + 12)

    const unwrapped = await unwrapChannelKey(wrapped, bob.privateKey)
    expect(Array.from(unwrapped)).toEqual(Array.from(channelKey))
    void alice
  })

  it('не может распаковать ключ тот, кому он не предназначался', async () => {
    const bob = generateDeviceKeys()
    const eve = generateDeviceKeys()
    const channelKey = generateChannelKey()
    const wrapped = await wrapChannelKey(channelKey, bob.publicKey)
    await expect(unwrapChannelKey(wrapped, eve.privateKey)).rejects.toThrow()
  })

  it('отклоняет повреждённый обёрнутый ключ', async () => {
    const bob = generateDeviceKeys()
    const wrapped = await wrapChannelKey(generateChannelKey(), bob.publicKey)
    wrapped[0] ^= 0xff
    await expect(unwrapChannelKey(wrapped, bob.privateKey)).rejects.toThrow()
  })

  it('отклоняет слишком короткий обёрнутый ключ', async () => {
    const bob = generateDeviceKeys()
    await expect(unwrapChannelKey(new Uint8Array(10), bob.privateKey)).rejects.toThrow()
  })

  it('шифрует и расшифровывает сообщения общим ключом канала', async () => {
    const key = generateChannelKey()
    const { ciphertext, iv } = await encryptMessage(key, 'Привет, это секретное сообщение! 123')
    expect(ciphertext.length).toBeGreaterThan(0)
    const plain = await decryptMessage(key, ciphertext, iv)
    expect(plain).toBe('Привет, это секретное сообщение! 123')
  })

  it('не расшифровывает чужим ключом', async () => {
    const keyA = generateChannelKey()
    const keyB = generateChannelKey()
    const { ciphertext, iv } = await encryptMessage(keyA, 'секрет')
    await expect(decryptMessage(keyB, ciphertext, iv)).rejects.toThrow()
  })

  it('не расшифровывает сообщение с изменённым iv', async () => {
    const key = generateChannelKey()
    const { ciphertext, iv } = await encryptMessage(key, 'секрет')
    iv[0] ^= 0xff
    await expect(decryptMessage(key, ciphertext, iv)).rejects.toThrow()
  })

  it('два сообщения с одним текстом имеют разные шифротексты (случайный iv)', async () => {
    const key = generateChannelKey()
    const m1 = await encryptMessage(key, 'одинаково')
    const m2 = await encryptMessage(key, 'одинаково')
    expect(m1.iv).not.toEqual(m2.iv)
    expect(m1.ciphertext).not.toEqual(m2.ciphertext)
  })

  it('base64 конвертация обратима', () => {
    const bytes = new Uint8Array([0, 1, 2, 255, 128])
    expect(Array.from(b64ToBytes(bytesToB64(bytes)))).toEqual(Array.from(bytes))
  })

  it('генератор ID устройства уникален', () => {
    const a = generateDeviceId()
    const b = generateDeviceId()
    expect(a).not.toEqual(b)
  })
})
