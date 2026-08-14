// Длительность медиа-записей. Chrome пишет MediaRecorder-webm с длительностью
// Infinity (в mp4 — с нормальной). Для таких файлов зондируем: seek к огромному
// времени упирается в конец файла, и currentTime показывает реальную
// длительность. После зондирования позиция сбрасывается на 0.

export function refreshMediaDuration(el: HTMLMediaElement, duration: { value: number }): void {
  if (Number.isFinite(el.duration) && el.duration > 0) duration.value = el.duration
}

export function probeMediaDuration(el: HTMLMediaElement, duration: { value: number }): Promise<void> {
  if (Number.isFinite(el.duration) && el.duration > 0) {
    duration.value = el.duration
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    let settled = false
    const finish = (d?: number) => {
      if (settled) return
      settled = true
      el.removeEventListener('seeked', onSeeked)
      window.clearTimeout(timer)
      if (d !== undefined && Number.isFinite(d) && d > 0) duration.value = d
      try {
        el.currentTime = 0
      } catch {
        /* ignore */
      }
      resolve()
    }
    const onSeeked = () => finish(el.currentTime)
    el.addEventListener('seeked', onSeeked)
    const timer = window.setTimeout(() => finish(), 2500)
    try {
      el.currentTime = 1e9
    } catch {
      finish()
    }
  })
}
