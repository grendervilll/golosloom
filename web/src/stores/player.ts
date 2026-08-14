// Плеер голосовых сообщений: какое сообщение сейчас играет в верхнем
// плеере канала. Клик по тому же голосовому сообщению останавливает.
import { defineStore } from 'pinia'

export interface VoiceTrack {
  msgId: number
  channelId: number
  src: string
  filename: string
}

export const usePlayerStore = defineStore('player', {
  state: () => ({
    voice: null as VoiceTrack | null,
  }),
  actions: {
    toggleVoice(v: VoiceTrack) {
      if (this.voice && this.voice.msgId === v.msgId) {
        this.voice = null
      } else {
        this.voice = v
      }
    },
    stop() {
      this.voice = null
    },
  },
})
