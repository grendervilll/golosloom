// Всплывающие уведомления (приглашения, звонки, бан/кик, пинок).
import { defineStore } from 'pinia'

export interface Toast {
  id: number
  kind: 'invite' | 'call' | 'punch' | 'warning' | 'info' | 'error'
  text: string
  inviteId?: number
}

let nextId = 1

export const useToasts = defineStore('toasts', {
  state: () => ({
    items: [] as Toast[],
  }),
  actions: {
    push(t: Omit<Toast, 'id'>) {
      const id = nextId++
      this.items.push({ ...t, id })
      setTimeout(() => this.remove(id), t.kind === 'invite' || t.kind === 'call' ? 15000 : 6000)
    },
    remove(id: number) {
      this.items = this.items.filter((x) => x.id !== id)
    },
  },
})
