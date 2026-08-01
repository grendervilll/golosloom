// Звуки клиента на Web Audio API (без файлов-ассетов).
// Правила: звук вызова длится 20 секунд, одновременно играет только один
// звук вызова; звук сообщения тихий и только на чужие сообщения.

class SoundManager {
  private ctx: AudioContext | null = null
  private ringTimer: number | null = null
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
  // Контекст разблокируется на каждом тике, чтобы звук не обрывался
  // из-за политики автозапуска браузера.
  playRing(): void {
    if (this.ringTimer !== null) return // не даём двум вызовам звучать одновременно
    const schedule = () => {
      if (this.ringTimer === null) return
      this.unlock()
      this.beep(800, 0.3, 0.08, 'sine')
      window.setTimeout(() => this.beep(1000, 0.3, 0.08, 'sine'), 350)
    }
    schedule()
    this.ringTimer = window.setInterval(schedule, 850)
    window.setTimeout(() => this.stopRing(), 20000)
  }

  stopRing(): void {
    if (this.ringTimer !== null) {
      clearInterval(this.ringTimer)
      this.ringTimer = null
    }
  }

  // Звук дозвона у звонящего — пока звонок не принят.
  playDialTone(): void {
    if (this.dialTimer !== null) return
    const schedule = () => {
      if (this.dialTimer === null) return
      this.unlock()
      this.beep(425, 0.5, 0.05, 'sine')
    }
    schedule()
    this.dialTimer = window.setInterval(schedule, 850)
  }

  stopDialTone(): void {
    if (this.dialTimer !== null) {
      clearInterval(this.dialTimer)
      this.dialTimer = null
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
    this.beep(120, 0.25, 0.08, 'square', 0.12)
  }

  // Предупреждение о кике/бане.
  warning(): void {
    this.beep(600, 0.2, 0.06)
    this.beep(400, 0.3, 0.06, 'sine', 0.25)
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
