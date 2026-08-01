// Звонки: инициация, приём/отклонение, LiveKit-комната, участники, пинок.
import { defineStore } from 'pinia'
import { markRaw } from 'vue'
import { useSettingsStore } from './settings'
import { useAuthStore } from './auth'
import { useChannelsStore } from './channels'
import { useToasts } from './toasts'
import { sounds } from '../audio/sounds'
import type { Call } from '../api/types'
import { Room, RoomEvent, Track } from 'livekit-client'

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
    micOn: false,
    camOn: false,
    screenOn: false,
    punchCooldown: 0 as number,
    lastPunch: 0,
    audioScanTimer: null as number | null,
  }),
  getters: {
    inCall: (s) => s.connectedCallId > 0,
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
      const res = await settings.api.acceptCall(call.id, deviceId)
      this.stopIncoming(call.id)
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
      await settings.api.declineCall(call.id)
      this.stopIncoming(call.id)
    },
    async join(callId: number) {
      const settings = useSettingsStore()
      const channels = useChannelsStore()
      const deviceId = channels.ensureDevice().deviceId
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
        audioCaptureDefaults: { noiseSuppression: settings.noiseSuppression !== 'off' },
        videoCaptureDefaults: { resolution: { width: 1280, height: 720 } },
      })
      // Обработчики треков регистрируем ДО connect, чтобы не пропустить ранние.
      // ВАЖНО: в событии TrackSubscribed (single peer connection) у трека может
      // не быть participant — прикрепляем аудио по самому треку, не завися от него.
      const attachAudio = (track: any) => {
        try {
          if (track.kind !== Track.Kind.Audio) return
          track.attach()
          const el = track.attachedElements[0] as HTMLMediaElement
          if (el) el.volume = settings.mutedOthers ? 0 : 1
        } catch {
          /* не фатально */
        }
      }
      room.on(RoomEvent.TrackSubscribed, attachAudio)
      room.on(RoomEvent.TrackUnsubscribed, (track: any) => {
        try {
          track?.detach?.()
        } catch {
          /* ignore */
        }
      })
      await room.connect(settings.serverConfig!.livekit_url, token)
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
      this.connectedCallId = callId
      // Микрофон включается автоматически при вызове, камера — нет.
      // Отказ микрофона (нет разрешения) НЕ должен обрывать звонок.
      this.micOn = false
      try {
        await room.localParticipant.setMicrophoneEnabled(true)
        this.micOn = true
      } catch {
        this.micOn = false
        const toasts = useToasts()
        toasts.push({ kind: 'warning', text: 'Микрофон недоступен — проверьте разрешения браузера' })
      }
    },
    async disconnectRoom() {
      if (this.audioScanTimer !== null) {
        clearInterval(this.audioScanTimer)
        this.audioScanTimer = null
      }
      if (this.room) {
        this.room.disconnect()
        this.room = null
      }
      this.connectedCallId = 0
    },
    async toggleMic() {
      if (!this.room) return
      this.micOn = !this.micOn
      try {
        await this.room.localParticipant.setMicrophoneEnabled(this.micOn)
      } catch {
        this.micOn = !this.micOn
        const toasts = useToasts()
        toasts.push({ kind: 'warning', text: 'Микрофон недоступен — проверьте разрешения браузера' })
      }
    },
    async toggleCam() {
      if (!this.room) return
      this.camOn = !this.camOn
      try {
        await this.room.localParticipant.setCameraEnabled(this.camOn)
      } catch {
        this.camOn = !this.camOn
        const toasts = useToasts()
        toasts.push({ kind: 'warning', text: 'Веб-камера недоступна — проверьте разрешения браузера' })
      }
    },
    // Переключение микрофона на выбранное устройство.
    async setMicDevice(deviceId: string) {
      if (!this.room) return
      try {
        await this.room.switchActiveDevice('audioinput', deviceId)
      } catch {
        const toasts = useToasts()
        toasts.push({ kind: 'warning', text: 'Не удалось переключить микрофон' })
      }
    },
    async toggleScreen(quality: string) {
      if (!this.room) return
      try {
        if (this.screenOn) {
          await this.room.localParticipant.setScreenShareEnabled(false)
          this.screenOn = false
          return
        }
        const [w, h, fps] = parseQuality(quality)
        await this.room.localParticipant.setScreenShareEnabled(true, {
          video: { resolution: { width: w, height: h }, frameRate: fps },
        })
        this.screenOn = true
      } catch {
        const toasts = useToasts()
        toasts.push({ kind: 'warning', text: 'Не удалось запустить демонстрацию экрана' })
      }
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
    // Identity участника в LiveKit имеет вид "userID:deviceID" — ищем по префиксу.
    async setParticipantVolume(userId: number, volume: number) {
      const settings = useSettingsStore()
      settings.setVolume(userId, volume)
      if (!this.room) return
      const p = this.room.remoteParticipants.get(String(userId))
      let participant = p
      if (!participant) {
        for (const rp of this.room.remoteParticipants.values()) {
          if (rp.identity.split(':')[0] === String(userId)) {
            participant = rp
            break
          }
        }
      }
      if (!participant) return
      for (const pub of participant.audioTrackPublications.values()) {
        if (pub.track && typeof (pub.track as any).setVolume === 'function') {
          ;(pub.track as any).setVolume(settings.mutedOthers ? 0 : volume / 100)
        }
      }
    },
    // ---------- Обработка WS-событий ----------
    handleCallInvite(data: { call_id: number; channel_id: number; initiator_id: number; initiator_nick: string }) {
      // Не даём двум вызовам звучать одновременно: если звонок уже идёт —
      // только уведомление с коротким звуком.
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
      const toasts = useToasts()
      toasts.push({ kind: 'call', text: `Вас вызывает ${data.initiator_nick}` })
      if (!this.ringingCall && !this.currentCall) {
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
    handleCallCreated(data: { call: Call }) {
      const exists = this.calls.find((c) => c.id === data.call.id)
      if (!exists && data.call.initiator_id !== useAuthStore().user?.id) {
        // Звонок создан кем-то, но меня не пригласили — не показываем.
        return
      }
    },
    handlePunch(data: { by_nick: string }) {
      const toasts = useToasts()
      toasts.push({ kind: 'punch', text: `Вас пнул ${data.by_nick}` })
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
