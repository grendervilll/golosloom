// Звонки: инициация, приём/отклонение, LiveKit-комната, участники, пинок.
import { defineStore } from 'pinia'
import { markRaw } from 'vue'
import { useSettingsStore } from './settings'
import { toast } from 'vue-sonner'
import { useAuthStore } from './auth'
import { useChannelsStore } from './channels'
import { sounds } from '../audio/sounds'
import type { Call } from '../api/types'
import { AudioPresets, Room, RoomEvent, Track } from 'livekit-client'

export interface ActiveCall extends Call {
  incoming: boolean // мне звонят
  ringing: boolean // я звоню
  inCall: boolean // я в звонке
}

export const useCallStore = defineStore('calls', {
  state: () => ({
    calls: [] as ActiveCall[],
    room: null as Room | null,
    connectedCallId: 0,
    // Время начала звонка (для таймера на плашке) и говорящие в данный момент.
    connectedAt: 0 as number,
    speakers: [] as { identity: string; level: number }[],
    // Есть ли активные видео (камеры/демонстрации) — управляет раскладкой.
    videoCount: 0 as number,
    micOn: false,
    camOn: false,
    screenOn: false,
    punchCooldown: 0 as number,
    lastPunch: 0,
    audioScanTimer: null as number | null,
    // Слежение за выключенным микрофоном: чтобы предупреждать пользователя,
    // когда он пытается говорить, но микрофон выключен.
    micMonitor: null as { stream: MediaStream; ctx: AudioContext; analyser: AnalyserNode; warned: boolean } | null,
    micMonitorTimer: null as number | null,
  }),
  getters: {
    inCall: (s) => s.connectedCallId > 0,
    // Участники звонка (для плашки и подсветки говорящих).
    remoteParticipants(s) {
      return s.room ? [...s.room.remoteParticipants.values()] : []
    },
    currentCall(): ActiveCall | undefined {
      return this.calls.find((c) => c.id === this.connectedCallId)
    },
    ringingCall(): ActiveCall | undefined {
      return this.calls.find((c) => c.incoming)
    },
    canJoinCall(): boolean {
      return this.calls.some((c) => c.status !== 'ended' && !c.inCall && !c.incoming)
    },
  },
  actions: {
    async refresh(channelId: number) {
      const settings = useSettingsStore()
      const auth = useAuthStore()
      const calls: Call[] = await settings.api.listCalls(channelId)
      const merged: ActiveCall[] = []
      for (const c of calls) {
        const prev = this.calls.find((x) => x.id === c.id)
        merged.push({
          ...c,
          incoming: prev?.incoming ?? false,
          ringing: prev?.ringing ?? false,
          inCall: c.participants.includes(auth.user!.id),
        })
      }
      this.calls = merged
    },
    async initiate(channelId: number, targetIds: number[]) {
      const settings = useSettingsStore()
      const auth = useAuthStore()
      const channels = useChannelsStore()
      const deviceId = channels.ensureDevice().deviceId
      const res = await settings.api.createCall(channelId, targetIds, deviceId)
      const call = res.call as Call
      this.calls.push({
        ...call,
        incoming: false,
        ringing: true,
        inCall: true,
      })
      sounds.playDialTone()
      try {
        await this.connectRoom(call.id, res.token, targetIds)
      } catch (e) {
        // Не удалось подключиться к LiveKit — отменяем звонок на сервере,
        // иначе он останется «активным» и заблокирует новый вызов.
        await this.abortCall(call.id)
        throw e
      }
    },
    async accept(call: Call) {
      const settings = useSettingsStore()
      const channels = useChannelsStore()
      const deviceId = channels.ensureDevice().deviceId
      // Звук звонка гасим сразу, ДО запроса к серверу: если accept упадёт
      // (сеть, "звонок завершён") — гудков уже не будет.
      this.stopIncoming(call.id)
      sounds.stopAll()
      let res
      try {
        res = await settings.api.acceptCall(call.id, deviceId)
      } catch (e) {
        this.calls = this.calls.filter((c) => c.id !== call.id)
        throw e
      }
      const c = this.calls.find((x) => x.id === call.id)
      if (c) c.inCall = true
      try {
        await this.connectRoom(call.id, res.token)
      } catch (e) {
        await this.abortCall(call.id)
        throw e
      }
    },
    async decline(call: Call) {
      const settings = useSettingsStore()
      this.stopIncoming(call.id)
      sounds.stopAll()
      try {
        await settings.api.declineCall(call.id)
      } catch {
        /* ignore */
      }
    },
    async join(callId: number) {
      const settings = useSettingsStore()
      const channels = useChannelsStore()
      const deviceId = channels.ensureDevice().deviceId
      this.stopIncoming(callId)
      sounds.stopAll()
      const res = await settings.api.joinCall(callId, deviceId)
      const c = this.calls.find((x) => x.id === callId)
      if (c) c.inCall = true
      try {
        await this.connectRoom(callId, res.token)
      } catch (e) {
        await this.abortCall(callId)
        throw e
      }
    },
    // Отмена звонка: выход на сервере, очистка состояния и звуков.
    async abortCall(callId: number) {
      const settings = useSettingsStore()
      try {
        await settings.api.leaveCall(callId)
      } catch {
        /* ignore */
      }
      this.calls = this.calls.filter((c) => c.id !== callId)
      sounds.stopAll()
      await this.disconnectRoom()
    },
    async leave() {
      const settings = useSettingsStore()
      const call = this.currentCall
      if (call) {
        await settings.api.leaveCall(call.id)
      }
      await this.disconnectRoom()
      this.micOn = false
      this.camOn = false
      this.screenOn = false
    },
    stopIncoming(callId: number) {
      const c = this.calls.find((x) => x.id === callId)
      if (c) c.incoming = false
      sounds.stopRing()
    },
    endAllInChannel(channelId: number) {
      this.calls = this.calls.filter((c) => c.channel_id !== channelId)
      sounds.stopAll()
      void this.disconnectRoom()
    },
    // Текст длительности звонка для системного сообщения («12:34»).
    callDurationText(): string | null {
      if (!this.connectedAt) return null
      const s = Math.max(1, Math.floor((Date.now() - this.connectedAt) / 1000))
      const h = Math.floor(s / 3600)
      const m = Math.floor((s % 3600) / 60)
      const sec = s % 60
      const two = (v: number) => String(v).padStart(2, '0')
      return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`
    },
    // ---------- LiveKit ----------
    async connectRoom(callId: number, token: string) {
      const settings = useSettingsStore()
      await this.disconnectRoom()
      // Все вызовы идут через coturn (TURN), без прямого подключения:
      // сервер Go выдаёт временные учётные данные в /api/config.
      const turn = settings.serverConfig?.turn
      const rtcConfig = turn?.urls?.length
        ? {
            iceServers: [
              {
                urls: turn.urls,
                username: turn.username,
                credential: turn.credential,
              },
            ],
          }
        : undefined
      const room = new Room({
        // На слабых серверах adaptiveStream/dynacast (смена слоёв по перегрузке)
        // могут останавливать медиа — отключаем, получаем полный поток всегда.
        adaptiveStream: false,
        dynacast: false,
        rtcConfig,
        // Микрофон: максимум качества (48 кГц — предел opus), моно,
        // эхо-подавление и автоусиление всегда включены. Шумоподавление —
        // подсказка браузеру (уровней у него нет): off — выключено,
        // low/medium — обычное, high — дополнительно voiceIsolation
        // (экспериментальное усиление голоса, Chrome; если не поддержано,
        // браузер просто игнорирует констрейнт).
        audioCaptureDefaults: {
          echoCancellation: true,
          autoGainControl: true,
          noiseSuppression: settings.noiseSuppression !== 'off',
          voiceIsolation: settings.noiseSuppression === 'high',
          channelCount: 1,
          sampleRate: 48000,
        },
        // Пресет кодирования речи: 96 кбит/с opus вместо стандартных 48 —
        // заметно чище голос, не адаптивно (LiveKit-клиент не умеет
        // подстраивать битрейт под микрофон).
        publishDefaults: { audioPreset: AudioPresets.musicHighQuality },
        videoCaptureDefaults: { resolution: { width: 1280, height: 720 } },
      })
      // Обработчики треков регистрируем ДО connect, чтобы не пропустить ранние.
      // ВАЖНО: track.attach() без аргумента в этой версии SDK НЕ вставляет
      // элемент в DOM — создаём <audio> сами и прикрепляем трек к нему.
      const attachAudio = (track: any) => {
        try {
          if (track.kind !== Track.Kind.Audio) return
          const el = document.createElement('audio')
          el.autoplay = true
          el.style.display = 'none'
          document.body.appendChild(el)
          track.attach(el)
          // ВАЖНО: в реальном браузере SDK может переключить трек на
          // WebAudio-граф (element.muted=true + gainNode), у которого сломан
          // возврат громкости после 0 — звук не возвращается. Отключаем
          // WebAudio-граф и управляем громкостью через сам элемент.
          if (track.audioContext) {
            track.disconnectWebAudio?.()
          }
          el.muted = false
          el.volume = 1
          this.applySpeakersVolume()
        } catch {
          /* не фатально */
        }
      }
      // Активные видео: пересчитываем при любых изменениях треков.
      const refreshVideo = () => {
        let n = 0
        try {
          const check = (pubs: any) =>
            [...pubs.values()].forEach((pub: any) => {
              if (pub.track && !pub.track.isMuted) n++
            })
          const locals = room.localParticipant?.videoTrackPublications
          if (locals) check(locals)
          for (const p of room.remoteParticipants.values()) check(p.videoTrackPublications)
        } catch {
          /* ignore */
        }
        this.videoCount = n
      }
      refreshVideo()
      room.on(RoomEvent.TrackSubscribed, refreshVideo)
      room.on(RoomEvent.TrackUnsubscribed, refreshVideo)
      room.on(RoomEvent.TrackMuted, refreshVideo)
      room.on(RoomEvent.TrackUnmuted, refreshVideo)
      room.on(RoomEvent.TrackPublished, refreshVideo)
      room.on(RoomEvent.ParticipantDisconnected, refreshVideo)
      // Кто говорит прямо сейчас (для зелёной подсветки аватаров).
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers: any[]) => {
        this.speakers = (speakers || []).map((sp) => ({
          identity: sp.identity,
          level: sp.audioLevel || 0,
        }))
      })
      room.on(RoomEvent.TrackSubscribed, attachAudio)
      room.on(RoomEvent.TrackUnsubscribed, (track: any) => {
        try {
          for (const el of track?.attachedElements || []) track.detach(el)
          // После detach SDK может снова собрать WebAudio-граф для
          // оставшихся элементов — отключаем его и восстанавливаем
          // управление громкостью через элементы.
          if (track?.audioContext && track?.attachedElements?.length) {
            track.disconnectWebAudio?.()
            for (const el of track.attachedElements) {
              el.muted = false
              el.volume = 1
            }
            this.applySpeakersVolume()
          }
        } catch {
          /* ignore */
        }
      })
      await room.connect(settings.serverConfig!.livekit_url, token)
      this.connectedAt = Date.now()
      // Сканируем уже подписанные аудио-треки (на случай пропущенных событий).
      const scanAudio = () => {
        try {
          for (const p of room.remoteParticipants.values()) {
            for (const pub of p.audioTrackPublications.values()) {
              if (pub.isSubscribed && pub.track && pub.track.attachedElements.length === 0) {
                attachAudio(pub.track)
              }
            }
          }
        } catch {
          /* ignore */
        }
      }
      scanAudio()
      // Периодический скан: аудио прикрепляется надёжно, даже если события
      // подписки не пришли (как видео в CallStage).
      this.audioScanTimer = window.setInterval(scanAudio, 2500)
      // markRaw: Room (и его объекты) не должны оборачиваться в реактивные
      // Proxy — иначе SDK ломается (DataCloneError при structuredClone).
      this.room = markRaw(room)
      // Диагностический экспорт для E2E-инструментовки.
      if (typeof window !== 'undefined') {
        ;(window as any).__golosloomRoom = room
      }
      this.connectedCallId = callId
      // Применяем сохранённые настройки громкости (в т.ч. выключение звука).
      this.applySpeakersVolume()
      // Микрофон включается автоматически при вызове, камера — нет.
      // Отказ микрофона (нет разрешения) НЕ должен обрывать звонок.
      this.micOn = false
      try {
        await room.localParticipant.setMicrophoneEnabled(true)
        this.micOn = true
      } catch {
        this.micOn = false
        toast.warning('Микрофон недоступен — проверьте разрешения браузера')
      }
    },
    async disconnectRoom() {
      if (this.audioScanTimer !== null) {
        clearInterval(this.audioScanTimer)
        this.audioScanTimer = null
      }
      this.stopMicMonitor()
      if (this.room) {
        this.room.disconnect()
        this.room = null
      }
      this.connectedCallId = 0
      this.connectedAt = 0
      this.speakers = []
      this.videoCount = 0
    },
    async toggleMic() {
      if (!this.room) return
      const target = !this.micOn
      if (target) this.stopMicMonitor() // микрофон нужен LiveKit — освобождаем его
      this.micOn = target
      try {
        await this.room.localParticipant.setMicrophoneEnabled(target)
        if (!target) void this.startMicMonitor()
      } catch {
        this.micOn = !target
        if (!this.micOn) void this.startMicMonitor()
        toast.warning('Микрофон недоступен — проверьте разрешения браузера')
      }
    },
    // Слежение за микрофоном, когда он выключен: если пользователь начинает
    // говорить, подаём сигнал «включите микрофон» (тост + звук).
    async startMicMonitor() {
      if (this.micMonitor || this.micOn || !this.inCall) return
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch {
        return // нет доступа к микрофону — следить не можем
      }
      const AC = window.AudioContext || (window as any).webkitAudioContext
      if (!AC) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      const ctx = new AC()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      ctx.createMediaStreamSource(stream).connect(analyser)
      const monitor = { stream, ctx, analyser, warned: false }
      this.micMonitor = markRaw(monitor)
      const buf = new Float32Array(analyser.fftSize)
      this.micMonitorTimer = window.setInterval(() => {
        if (!this.micMonitor) return
        analyser.getFloatTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
        const rms = Math.sqrt(sum / buf.length)
        if (rms > 0.04) {
          // Говорит при выключенном микрофоне: сигналим один раз за «фразу».
          if (!monitor.warned) {
            monitor.warned = true
            toast.warning('Ваш микрофон выключен — включите его, чтобы говорить', { duration: 4000 })
            sounds.micOff()
          }
        } else {
          monitor.warned = false
        }
      }, 200)
    },
    stopMicMonitor() {
      if (this.micMonitorTimer !== null) {
        clearInterval(this.micMonitorTimer)
        this.micMonitorTimer = null
      }
      const m = this.micMonitor
      if (m) {
        m.stream.getTracks().forEach((t) => t.stop())
        void m.ctx.close().catch(() => {})
        this.micMonitor = null
      }
    },
    async toggleCam() {
      if (!this.room) return
      this.camOn = !this.camOn
      try {
        await this.room.localParticipant.setCameraEnabled(this.camOn)
      } catch {
        this.camOn = !this.camOn
        toast.warning('Веб-камера недоступна — проверьте разрешения браузера')
      }
    },
    // Переключение микрофона на выбранное устройство.
    async setMicDevice(deviceId: string) {
      if (!this.room) return
      try {
        await this.room.switchActiveDevice('audioinput', deviceId)
      } catch {
        toast.warning('Не удалось переключить микрофон')
      }
    },
    async toggleScreen(quality: string) {
      if (!this.room) return
      try {
        if (this.screenOn) {
          await this.stopScreen()
          return
        }
        const [w, h, fps] = parseQuality(quality)
        // ВАЖНО: resolution и frameRate передаются на верхнем уровне опций
        // (ScreenShareCaptureOptions), иначе SDK их игнорирует и захват идёт
        // с дефолтом 1080p/30fps. degradationPreference 'maintain-framerate'
        // держит fps стабильным при нагрузке (браузер режет разрешение,
        // а не кадры). contentHint 'detail' — чёткий текст.
        await this.room.localParticipant.setScreenShareEnabled(
          true,
          {
            resolution: { width: w, height: h, frameRate: fps },
            contentHint: 'detail',
          },
          {
            videoEncoding: { maxBitrate: SCREEN_BITRATES[quality] || 5_000_000, maxFramerate: fps },
            degradationPreference: 'maintain-framerate',
          },
        )
        this.screenOn = true
      } catch {
        toast.warning('Не удалось запустить демонстрацию экрана')
      }
    },
    // Выключение демонстрации: отдельное действие, чтобы кнопка «Экран»
    // при активной демонстрации выключала её сразу, без выбора качества.
    async stopScreen() {
      if (!this.room) return
      try {
        await this.room.localParticipant.setScreenShareEnabled(false)
      } catch {
        /* ignore */
      }
      this.screenOn = false
    },
    async punch(targetUserId: number) {
      const now = Date.now()
      if (now - this.lastPunch < 10000) return
      this.lastPunch = now
      const auth = useAuthStore()
      const call = this.currentCall
      if (!call) return
      auth.ws.send('call.punch', { call_id: call.id, target_user_id: targetUserId })
    },
    // Громкость конкретного участника (сохраняется и применяется к его трекам).
    async setParticipantVolume(userId: number, volume: number) {
      const settings = useSettingsStore()
      settings.setVolume(userId, volume)
      this.applySpeakersVolume()
    },
    // Выключение/включение звука от всех собеседников (только их микрофоны;
    // системные звуки и другие приложения не затрагиваются).
    setSpeakersMuted(muted: boolean) {
      const settings = useSettingsStore()
      settings.setMutedOthers(muted)
      this.applySpeakersVolume()
    },
    // Применяет громкость ко всем аудио-трекам собеседников: общее
    // выключение звука + индивидуальная громкость каждого участника.
    // Выключение делаем через el.muted (надёжный булев флаг), а не только
    // через volume=0 — так звук гарантированно возвращается при включении.
    applySpeakersVolume() {
      if (!this.room) return
      const settings = useSettingsStore()
      const muted = settings.mutedOthers
      for (const p of this.room.remoteParticipants.values()) {
        const uid = Number(p.identity.split(':')[0])
        const vol = settings.volumes[uid]
        const level = vol !== undefined ? Math.max(0, Math.min(2, vol / 100)) : 1
        for (const pub of p.audioTrackPublications.values()) {
          if (!pub.track) continue
          const track = pub.track as any
          try {
            if (typeof track.setVolume === 'function') track.setVolume(muted ? 0 : level)
            for (const el of track.attachedElements || []) {
              el.muted = muted
              el.volume = muted ? 0 : level
              if (!muted && el.paused) {
                void el.play().catch(() => {})
              }
            }
          } catch {
            /* ignore */
          }
        }
      }
    },
    // ---------- Обработка WS-событий ----------
    handleCallInvite(data: { call_id: number; channel_id: number; initiator_id: number; initiator_nick: string }) {
      // Не даём двум вызовам звучать одновременно.
      // ВАЖНО: проверяем ДО добавления нового звонка в список — иначе
      // ringingCall уже истинен и звук звонка никогда не заиграет.
      const alreadyRinging = this.calls.some((c) => c.incoming && c.id !== data.call_id)
      const alreadyInCall = this.currentCall
      const exists = this.calls.find((c) => c.id === data.call_id)
      if (exists) return
      this.calls.push({
        id: data.call_id,
        channel_id: data.channel_id,
        initiator_id: data.initiator_id,
        status: 'ringing',
        created_at: '',
        participants: [],
        incoming: true,
        ringing: false,
        inCall: false,
      })
      toast(`Вас вызывает ${data.initiator_nick}`, { duration: 15000 })
      if (!alreadyRinging && !alreadyInCall) {
        sounds.playRing()
      } else {
        sounds.message()
      }
    },
    handleCallStarted(callId: number) {
      const c = this.calls.find((x) => x.id === callId)
      if (c) c.status = 'active'
      sounds.stopDialTone()
      sounds.stopRing()
    },
    handleCallEnded(data: { call_id: number }) {
      this.calls = this.calls.filter((c) => c.id !== data.call_id)
      sounds.stopAll()
      if (this.connectedCallId === data.call_id) void this.disconnectRoom()
    },
    handleCallCreated() {
      // Обновляем список звонков канала (для кнопки «Войти в звонок»):
      // refresh возвращает только звонки, куда пользователь приглашён/участвует.
      const channels = useChannelsStore()
      if (channels.currentId) void this.refresh(channels.currentId)
    },
    handlePunch(data: { by_nick: string }) {
      toast(`Вас пнул ${data.by_nick}`, { duration: 6000 })
      sounds.punched()
    },
  },
})

function parseQuality(q: string): [number, number, number] {
  switch (q) {
    case '1080p60':
      return [1920, 1080, 60]
    case '1080p30':
      return [1920, 1080, 30]
    case '720p60':
      return [1280, 720, 60]
    case '720p30':
      return [1280, 720, 30]
    case '480p30':
      return [854, 480, 30]
    default:
      return [1920, 1080, 60]
  }
}

// Битрейты демонстрации экрана: умеренные для слабого VPS (всё медиа идёт
// через TURN-релей на одном ядре — завышенный битрейт даёт потери и фризы).
const SCREEN_BITRATES: Record<string, number> = {
  '1080p60': 6_000_000,
  '1080p30': 5_000_000,
  '720p60': 4_000_000,
  '720p30': 2_500_000,
  '480p30': 1_500_000,
}
