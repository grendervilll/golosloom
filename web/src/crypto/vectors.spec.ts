// Генератор тестовых векторов для кросс-проверки крипты с Dart.
// Запуск: npx vitest run src/crypto/vectors.spec.ts
// Выходной JSON вставляется в test/crypto_vectors_test.dart (Flutter).
import { describe, it, expect } from 'vitest'
import {
  generateDeviceKeys,
  generateChannelKey,
  wrapChannelKey,
  unwrapChannelKey,
  encryptMessage,
  decryptMessage,
  bytesToB64,
  b64ToBytes,
} from './crypto'

describe('генерация векторов', () => {
  it('печатает JSON векторов', async () => {
    const device = generateDeviceKeys()
    const channelKey = generateChannelKey()
    const wrapped = await wrapChannelKey(channelKey, device.publicKey)
    const { ciphertext, iv } = await encryptMessage(channelKey, 'Привет, мир! Golosloom кросстест')
    // Обратное направление: распаковка должна сойтись.
    const unwrapped = await unwrapChannelKey(wrapped, device.privateKey)
    expect(unwrapped).toEqual(channelKey)
    const plain = await decryptMessage(channelKey, ciphertext, iv)
    expect(plain).toBe('Привет, мир! Golosloom кросстест')

    const vectors = {
      device_priv: bytesToB64(device.privateKey),
      device_pub: bytesToB64(device.publicKey),
      channel_key: bytesToB64(channelKey),
      wrapped: bytesToB64(wrapped),
      msg_iv: bytesToB64(iv),
      msg_ciphertext: bytesToB64(ciphertext),
      plaintext: 'Привет, мир! Golosloom кросстест',
    }
    // eslint-disable-next-line no-console
    console.log('VECTORS_JSON=' + JSON.stringify(vectors))
    expect(b64ToBytes(vectors.device_priv).length).toBe(32)
  })
})
