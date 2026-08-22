import { describe, it, expect } from 'vitest'
import { x25519 } from '@noble/curves/ed25519'
import {
  generateIdentityKeyPair,
  generateSignedPreKey,
  generateOneTimePreKeys,
  x3dhInit,
  x3dhRespond,
  bytesToB64,
  b64ToBytes,
} from './signal'

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
  }
  return bytes
}

describe('Signal Protocol cross-platform vectors', () => {
  it('X3DH: shared secret matches between Alice and Bob', async () => {
    const alice = generateIdentityKeyPair()
    const bob = generateIdentityKeyPair()
    const bobSPK = generateSignedPreKey()
    const bobOPKs = generateOneTimePreKeys(1)

    const { sharedSecret: aliceSS, message: x3dhMsg } = x3dhInit(
      alice, bob.publicKey, bobSPK.publicKey, bobOPKs[0].publicKey,
    )
    const bobSS = x3dhRespond(bob, bobSPK.privateKey, bobOPKs[0].privateKey, x3dhMsg)

    expect(aliceSS).toEqual(bobSS)
    expect(aliceSS.length).toBe(32)
  })

  it('X3DH: deterministic vectors with fixed keys', async () => {
    const ALICE_PRIV = fromHex('0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20')
    const BOB_ID_PRIV = fromHex('2122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f40')
    const BOB_SPK_PRIV = fromHex('4142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f60')
    const BOB_OPK_PRIV = fromHex('6162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f80')

    const aliceIdentity = { privateKey: ALICE_PRIV, publicKey: new Uint8Array(x25519.getPublicKey(ALICE_PRIV)) }
    const bobIdentityPub = new Uint8Array(x25519.getPublicKey(BOB_ID_PRIV))
    const bobSPKPub = new Uint8Array(x25519.getPublicKey(BOB_SPK_PRIV))
    const bobOPKPub = new Uint8Array(x25519.getPublicKey(BOB_OPK_PRIV))

    const { sharedSecret: aliceSS, message: x3dhMsg } = x3dhInit(
      aliceIdentity, bobIdentityPub, bobSPKPub, bobOPKPub,
    )
    const bobSS = x3dhRespond(
      { publicKey: bobIdentityPub, privateKey: BOB_ID_PRIV },
      BOB_SPK_PRIV, BOB_OPK_PRIV, x3dhMsg,
    )

    expect(aliceSS).toEqual(bobSS)

    const vectors = {
      alice_identity_priv: bytesToB64(ALICE_PRIV),
      alice_identity_pub: bytesToB64(aliceIdentity.publicKey),
      bob_identity_pub: bytesToB64(bobIdentityPub),
      bob_spk_pub: bytesToB64(bobSPKPub),
      bob_opk_pub: bytesToB64(bobOPKPub),
      x3dh_shared_secret: bytesToB64(aliceSS),
      x3dh_identity_key: bytesToB64(x3dhMsg.identityKey),
      x3dh_ephemeral_public_key: bytesToB64(x3dhMsg.ephemeralPublicKey),
      x3dh_one_time_pre_key: x3dhMsg.oneTimePreKey ? bytesToB64(x3dhMsg.oneTimePreKey) : null,
    }
    // eslint-disable-next-line no-console
    console.log('X3DH_VECTORS=' + JSON.stringify(vectors))
    expect(vectors.x3dh_shared_secret.length).toBeGreaterThan(0)
  })
})
