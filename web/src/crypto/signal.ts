import { x25519 } from '@noble/curves/ed25519'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha2'

const IV_LEN = 12
function buf(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes as unknown as Uint8Array<ArrayBuffer>
}
function toBytes(v: Uint8Array): Uint8Array {
  return new Uint8Array(v)
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
function concat(...arrays: Uint8Array[]): Uint8Array {
  let total = 0
  for (const a of arrays) total += a.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) { out.set(a, offset); offset += a.length }
  return out
}

function hkdfDerive(ikm: Uint8Array, salt1: Uint8Array, salt2: Uint8Array): Uint8Array {
  const salt = sha256(concat(salt1, salt2))
  return hkdf(sha256, ikm, salt, new Uint8Array(0), 32)
}
function chainKeyDerive(rootKey: Uint8Array, dhOutput: Uint8Array): [Uint8Array, Uint8Array] {
  const d = hkdf(sha256, dhOutput, rootKey, new Uint8Array(0), 64)
  return [d.slice(0, 32), d.slice(32, 64)]
}
function advanceChainKey(ck: Uint8Array): Uint8Array { return new Uint8Array(sha256(ck)) }
function messageKeyDerive(ck: Uint8Array): Uint8Array {
  return new Uint8Array(sha256(concat(ck, new Uint8Array([0x01]))))
}
function msgKeyToAesKey(mk: Uint8Array): Uint8Array {
  return new Uint8Array(hkdf(sha256, mk, new Uint8Array(32), new Uint8Array(0), 32))
}

export interface IdentityKeyPair { publicKey: Uint8Array; privateKey: Uint8Array }
export function generateIdentityKeyPair(): IdentityKeyPair {
  const privateKey = x25519.utils.randomPrivateKey()
  return { publicKey: toBytes(x25519.getPublicKey(privateKey)), privateKey }
}
export function generateDeviceId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'dev-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}
export interface SignedPreKey { publicKey: Uint8Array; privateKey: Uint8Array }
export function generateSignedPreKey(): SignedPreKey {
  const privateKey = x25519.utils.randomPrivateKey()
  return { publicKey: toBytes(x25519.getPublicKey(privateKey)), privateKey }
}
export function generateOneTimePreKeys(count: number): { publicKey: Uint8Array; privateKey: Uint8Array }[] {
  const keys: { publicKey: Uint8Array; privateKey: Uint8Array }[] = []
  for (let i = 0; i < count; i++) {
    const privateKey = x25519.utils.randomPrivateKey()
    keys.push({ publicKey: toBytes(x25519.getPublicKey(privateKey)), privateKey })
  }
  return keys
}

export async function aesEncrypt(key: Uint8Array, plaintext: string): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
  const aesKey = await crypto.subtle.importKey('raw', buf(key), { name: 'AES-GCM' }, false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, buf(new TextEncoder().encode(plaintext))))
  return { ciphertext: ct, iv }
}
export async function aesDecrypt(key: Uint8Array, ciphertext: Uint8Array, iv: Uint8Array): Promise<string> {
  const aesKey = await crypto.subtle.importKey('raw', buf(key), { name: 'AES-GCM' }, false, ['decrypt'])
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(iv) }, aesKey, buf(ciphertext))
  return new TextDecoder().decode(plain)
}

export interface X3DHInitMessage { identityKey: Uint8Array; ephemeralPublicKey: Uint8Array; oneTimePreKey?: Uint8Array }
export function x3dhInit(aliceIdentity: IdentityKeyPair, bobIdentityKey: Uint8Array, bobSignedPreKey: Uint8Array, bobOneTimePreKey?: Uint8Array) {
  const ek = x25519.utils.randomPrivateKey()
  const ekPub = toBytes(x25519.getPublicKey(ek))
  let ikm = concat(
    x25519.getSharedSecret(aliceIdentity.privateKey, bobSignedPreKey),
    x25519.getSharedSecret(ek, bobIdentityKey),
    x25519.getSharedSecret(ek, bobSignedPreKey),
  )
  if (bobOneTimePreKey) ikm = concat(ikm, x25519.getSharedSecret(ek, bobOneTimePreKey))
  return { sharedSecret: hkdfDerive(ikm, aliceIdentity.publicKey, bobIdentityKey), message: { identityKey: aliceIdentity.publicKey, ephemeralPublicKey: ekPub, oneTimePreKey: bobOneTimePreKey } }
}
export function x3dhRespond(bobIdentity: IdentityKeyPair, bobSPKPriv: Uint8Array, bobOPKPriv: Uint8Array | undefined, msg: X3DHInitMessage): Uint8Array {
  let ikm = concat(
    x25519.getSharedSecret(bobSPKPriv, msg.identityKey),
    x25519.getSharedSecret(bobIdentity.privateKey, msg.ephemeralPublicKey),
    x25519.getSharedSecret(bobSPKPriv, msg.ephemeralPublicKey),
  )
  if (bobOPKPriv) ikm = concat(ikm, x25519.getSharedSecret(bobOPKPriv, msg.ephemeralPublicKey))
  return hkdfDerive(ikm, msg.identityKey, bobIdentity.publicKey)
}

export interface RatchetState {
  rootKey: Uint8Array; sendingChainKey: Uint8Array; receivingChainKey: Uint8Array
  sendingRatchetKeyPair: { publicKey: Uint8Array<any>; privateKey: Uint8Array<any> }
  receivingRatchetPublic: Uint8Array; sendingMessageNumber: number; receivingMessageNumber: number
}
export function initRatchetAsAlice(sharedSecret: Uint8Array, bobRatchetPublic: Uint8Array): RatchetState {
  const kp = { privateKey: x25519.utils.randomPrivateKey(), publicKey: new Uint8Array(0) as Uint8Array }
  kp.publicKey = toBytes(x25519.getPublicKey(kp.privateKey))
  const [rootKey, sendingChainKey] = chainKeyDerive(sharedSecret, toBytes(x25519.getSharedSecret(kp.privateKey, bobRatchetPublic)))
  return { rootKey, sendingChainKey, receivingChainKey: new Uint8Array(32), sendingRatchetKeyPair: kp, receivingRatchetPublic: bobRatchetPublic, sendingMessageNumber: 0, receivingMessageNumber: 0 }
}
export function initRatchetAsBob(sharedSecret: Uint8Array, aliceRatchetPublic: Uint8Array, bobRatchetPrivate: Uint8Array): RatchetState {
  const bobRatchetPublic = toBytes(x25519.getPublicKey(bobRatchetPrivate))
  const kp = { privateKey: bobRatchetPrivate, publicKey: bobRatchetPublic }
  const [rootKey, receivingChainKey] = chainKeyDerive(sharedSecret, toBytes(x25519.getSharedSecret(bobRatchetPrivate, aliceRatchetPublic)))
  return { rootKey, sendingChainKey: new Uint8Array(32), receivingChainKey, sendingRatchetKeyPair: kp, receivingRatchetPublic: aliceRatchetPublic, sendingMessageNumber: 0, receivingMessageNumber: 0 }
}
export async function ratchetEncrypt(state: RatchetState, plaintext: string): Promise<{ ciphertext: Uint8Array; iv: Uint8Array; msgNumber: number; ratchetPublic: Uint8Array }> {
  const mk = messageKeyDerive(state.sendingChainKey)
  const { ciphertext, iv } = await aesEncrypt(msgKeyToAesKey(mk), plaintext)
  const result = { ciphertext, iv, msgNumber: state.sendingMessageNumber, ratchetPublic: state.sendingRatchetKeyPair.publicKey }
  state.sendingChainKey = advanceChainKey(state.sendingChainKey)
  state.sendingMessageNumber++
  return result
}
export async function ratchetDecrypt(state: RatchetState, ciphertext: Uint8Array, iv: Uint8Array, _msgNumber: number, senderRatchetPublic: Uint8Array): Promise<string> {
  const sameRatchet = state.receivingRatchetPublic.length === senderRatchetPublic.length && state.receivingRatchetPublic.every((b, i) => b === senderRatchetPublic[i])
  if (!sameRatchet) {
    const dh = toBytes(x25519.getSharedSecret(state.sendingRatchetKeyPair.privateKey, senderRatchetPublic))
    const [newRK, receivingChainKey] = chainKeyDerive(state.rootKey, dh)
    state.rootKey = newRK
    state.receivingChainKey = receivingChainKey
    state.receivingRatchetPublic = senderRatchetPublic
    state.receivingMessageNumber = 0
    const newKp = { privateKey: x25519.utils.randomPrivateKey(), publicKey: new Uint8Array(0) as Uint8Array }
    newKp.publicKey = toBytes(x25519.getPublicKey(newKp.privateKey))
    const dh2 = toBytes(x25519.getSharedSecret(newKp.privateKey, senderRatchetPublic))
    const [rk2, sendingChainKey] = chainKeyDerive(state.rootKey, dh2)
    state.rootKey = rk2
    state.sendingChainKey = sendingChainKey
    state.sendingRatchetKeyPair = newKp
    state.sendingMessageNumber = 0
  }
  const mk = messageKeyDerive(state.receivingChainKey)
  const text = await aesDecrypt(msgKeyToAesKey(mk), ciphertext, iv)
  state.receivingChainKey = advanceChainKey(state.receivingChainKey)
  state.receivingMessageNumber++
  return text
}

export interface SenderKeyState { chainKey: Uint8Array; messageNumber: number }
export function generateSenderKey(): Uint8Array { return crypto.getRandomValues(new Uint8Array(32)) }
export async function encryptSenderKeyMessage(sk: SenderKeyState, plaintext: string): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
  const mk = messageKeyDerive(sk.chainKey)
  const { ciphertext, iv } = await aesEncrypt(msgKeyToAesKey(mk), plaintext)
  sk.chainKey = advanceChainKey(sk.chainKey)
  sk.messageNumber++
  return { ciphertext, iv }
}
export async function decryptSenderKeyMessage(chainKey: Uint8Array, ciphertext: Uint8Array, iv: Uint8Array, msgNumber: number): Promise<string> {
  let mk = chainKey
  for (let i = 0; i < msgNumber; i++) mk = advanceChainKey(mk)
  return aesDecrypt(msgKeyToAesKey(messageKeyDerive(mk)), ciphertext, iv)
}
