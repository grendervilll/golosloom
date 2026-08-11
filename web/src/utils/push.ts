// Web Push: регистрация подписки браузера на сервере Golosloom.
// Требует https, service worker и PushManager; VAPID-ключ приходит
// с /api/config (если на сервере пуши настроены).
import type { ApiClient } from '../api/http'

// Pinia разворачивает класс в структурный тип, поэтому принимаем только
// нужный метод, а не весь ApiClient.
type PushApi = Pick<ApiClient, 'pushSubscribe'>

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function registerSubscription(api: PushApi, reg: ServiceWorkerRegistration): Promise<void> {
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  const key = sub.toJSON()
  if (!key.endpoint || !key.keys?.p256dh || !key.keys.auth) return
  await api.pushSubscribe(key.endpoint, key.keys.p256dh, key.keys.auth)
}

// initPush вызывается после входа: создаёт подписку (если нужно) и
// регистрирует её на сервере. При смене ключей (переустановка SW) —
// переподписывается. Ошибки молча пропускаются: пуши не критичны.
export async function initPush(api: PushApi, vapidPublicKey: string | undefined): Promise<void> {
  try {
    if (!vapidPublicKey) return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    const reg = await navigator.serviceWorker.ready
    if (!reg.pushManager) return

    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      if (Notification.permission === 'denied') return
      if (Notification.permission === 'default') {
        const perm = await Notification.requestPermission()
        if (perm !== 'granted') return
      }
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      })
    }
    await registerSubscription(api, reg)
  } catch {
    /* пуши недоступны — не критично */
  }
}
