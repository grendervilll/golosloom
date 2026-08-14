// Плеер голосовых сообщений: какое сообщение сейчас играет в верхнем
// плеере канала. Клик по тому же голосовому сообщению останавливает.
import { defineStore } from 'pinia'

export interface VoiceTrack {
  msgId: number
  // attId — конкретное аудио-вложение (в сообщении их может быть несколько).
  attId?: number
  channelId: number
  // fileId нужен для перестроения src при обновлении файлового токена.
  fileId: number
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
