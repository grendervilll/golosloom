// Звуки клиента. Звонок — файл zvonok.mp3 (web/public/sounds), остальные
// звуки генерируются на Web Audio API.
// Правила: звук вызова длится 20 секунд, одновременно играет только один
// звук вызова; звук сообщения тихий и только на чужие сообщения.

class SoundManager {
  private ctx: AudioContext | null = null
  private ringTimer: number | null = null
  private ringStopTimer: number | null = null
  private ringAudio: HTMLAudioElement | null = null
  private ringBeepTimer: number | null = null
  private dialTimer: number | null = null
  private ringNodes: { osc: OscillatorNode; gain: GainNode }[] = []
  private muted = false

  private getCtx(): AudioContext | null {
    if (typeof window === 'undefined') return null
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext
      if (!AC) return null
      this.ctx = new AC()
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  // Браузер блокирует аудио без жеста пользователя: вызывается при первом
  // клике/нажатии клавиши, чтобы звук входящего звонка мог заиграть по WS.
  unlock(): void {
    const ctx = this.getCtx()
    if (ctx && ctx.state === 'suspended') void ctx.resume()
  }

  private beep(freq: number, duration: number, gain = 0.05, type: OscillatorType = 'sine'): void {
    const ctx = this.getCtx()
    if (!ctx || ctx.state === 'suspended') return
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = type
    osc.frequency.value = freq
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration)
    osc.connect(g).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + duration + 0.05)
  }

  // Звук входящего вызова (повторяющийся), максимум 20 секунд.
  // Играет файл zvonok.mp3 по кругу; если файл не загрузился —
  // фолбэк на гудки Web Audio API.
  playRing(): void {
    if (this.ringTimer !== null) return // не даём двум вызовам звучать одновременно
    this.ringTimer = 1 // guard: звонок активен
    if (typeof window !== 'undefined') {
      // В Electron file:// protocol нужен абсолютный URL.
      const base = window.location.origin !== 'null' ? window.location.origin : ''
      const src = base ? base + '/sounds/zvonok.mp3' : 'sounds/zvonok.mp3'
      const audio = new Audio(src)
      audio.loop = true
      audio.volume = 0.8
      audio.preload = 'auto'
      audio.onerror = () => this.ringFallback()
      this.ringAudio = audio
      const p = audio.play()
      if (p) p.catch(() => this.ringFallback())
    } else {
      this.ringFallback()
    }
    // Звонок длится максимум 20 секунд, дальше — автоматически гаснет.
    this.ringStopTimer = window.setTimeout(() => this.stopRing(), 20000)
  }

  // Фолбэк-гудки, если аудиофайл звонка недоступен.
  private ringFallback(): void {
    this.stopRingAudio()
    if (this.ringTimer === null || this.ringBeepTimer !== null) return
    const schedule = () => {
      this.unlock()
      this.beep(800, 0.3, 0.08, 'sine')
      window.setTimeout(() => this.beep(1000, 0.3, 0.08, 'sine'), 350)
    }
    this.ringBeepTimer = window.setInterval(schedule, 850)
    schedule()
  }

  private stopRingAudio(): void {
    if (this.ringAudio) {
      this.ringAudio.pause()
      this.ringAudio.src = ''
      this.ringAudio = null
    }
    if (this.ringBeepTimer !== null) {
      clearInterval(this.ringBeepTimer)
      this.ringBeepTimer = null
    }
  }

  stopRing(): void {
    if (this.ringTimer !== null) {
      this.ringTimer = null
      if (this.ringStopTimer !== null) {
        clearTimeout(this.ringStopTimer)
        this.ringStopTimer = null
      }
      this.stopRingAudio()
    }
  }

  // Звук дозвона у звонящего — пока звонок не принят, максимум 20 секунд.
  private dialStopTimer: number | null = null
  playDialTone(): void {
    if (this.dialTimer !== null) return
    const schedule = () => {
      this.unlock()
      this.beep(425, 0.5, 0.05, 'sine')
    }
    this.dialTimer = window.setInterval(schedule, 850)
    schedule()
    // Авто-остановка через 20 секунд (RingTimeout), как и у входящего звонка.
    if (this.dialStopTimer !== null) clearTimeout(this.dialStopTimer)
    this.dialStopTimer = window.setTimeout(() => this.stopDialTone(), 20000)
  }

  stopDialTone(): void {
    if (this.dialTimer !== null) {
      clearInterval(this.dialTimer)
      this.dialTimer = null
    }
    if (this.dialStopTimer !== null) {
      clearTimeout(this.dialStopTimer)
      this.dialStopTimer = null
    }
  }

  // Тихий звук нового чужого сообщения.
  message(): void {
    if (this.muted) return
    this.beep(880, 0.06, 0.02)
  }

  // "Пнули": короткий средний по громкости звук.
  punched(): void {
    this.beep(180, 0.18, 0.08, 'square')
    window.setTimeout(() => this.beep(120, 0.25, 0.08, 'square'), 120)
  }

  // Микрофон выключен, а пользователь пытается говорить: тройной сигнал.
  micOff(): void {
    this.beep(880, 0.12, 0.06)
    window.setTimeout(() => this.beep(660, 0.12, 0.06), 150)
    window.setTimeout(() => this.beep(880, 0.12, 0.06), 300)
  }

  // Предупреждение о кике/бане.
  warning(): void {
    this.beep(600, 0.2, 0.06)
    window.setTimeout(() => this.beep(400, 0.3, 0.06, 'sine'), 250)
  }

  setMuted(muted: boolean): void {
    this.muted = muted
  }

  stopAll(): void {
    this.stopRing()
    this.stopDialTone()
  }
}

export const sounds = new SoundManager()
