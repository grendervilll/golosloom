// Системные пуши для Electron (Windows/macOS/Linux) — через main process Notification.
// В браузере используется Web Push (service worker), в Electron — нативные тосты.

export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.__ELECTRON__?.notify?.show
}

export async function showElectronNotification(title: string, body: string, tag?: string): Promise<boolean> {
  if (!isElectron()) return false
  try {
    const ok = await window.__ELECTRON__!.notify!.show({ title, body, tag })
    return !!ok
  } catch {
    return false
  }
}

export function shouldShowNotification(): boolean {
  // Не показываем, если окно в фокусе и вкладка видима — пользователь уже видит чат.
  // Показываем, если свернуто, в фоне или скрыто.
  try {
    if (typeof document === 'undefined') return true
    if (document.hasFocus && document.hasFocus()) {
      if (document.visibilityState === 'visible') return false
    }
    // Если вкладка скрыта — точно показываем
    if (document.visibilityState === 'hidden') return true
    // Если окно не в фокусе — показываем
    if (document.hasFocus && !document.hasFocus()) return true
  } catch {}
  return true
}

export function onElectronNotificationClicked(cb: (tag: string) => void): () => void {
  if (!isElectron()) return () => {}
  try {
    return window.__ELECTRON__!.notify!.onClicked(cb)
  } catch {
    return () => {}
  }
}
