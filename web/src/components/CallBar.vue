// Плашка активного звонка внизу экрана: длительность, аватары участников,
// зелёная подсветка говорящего, тап — вернуться к звонку.
<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useCallStore } from '../stores/calls'
import { useChannelsStore } from '../stores/channels'
import Avatar from './Avatar.vue'

const emit = defineEmits<{ (e: 'return'): void }>()

const calls = useCallStore()
const channels = useChannelsStore()

const now = ref(Date.now())
const timer = window.setInterval(() => (now.value = Date.now()), 1000)
onBeforeUnmount(() => clearInterval(timer))

const time = computed(() => {
  if (!calls.connectedAt) return '0:00'
  const s = Math.max(0, Math.floor((now.value - calls.connectedAt) / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const two = (v: number) => String(v).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`
})

const participants = computed(() => calls.remoteParticipants.slice(0, 3))
const extra = computed(() => Math.max(0, calls.remoteParticipants.length - 3))

function userIdOf(identity: string): number {
  return Number(identity.split(':')[0]) || 0
}
function nickOf(p: any): string {
  return p.name || p.identity.split(':')[1] || p.identity
}
function avatarOf(userId: number): string | null {
  const m = channels.members.find((x) => x.user_id === userId)
  return m?.avatar || null
}
function isSpeaking(identity: string): boolean {
  return calls.speakers.some((s) => s.identity === identity && s.level > 0.05)
}
</script>

<template>
  <button v-if="calls.inCall" class="call-bar" @click="emit('return')">
    <span class="mic">🎧</span>
    <span class="time">Разговор · {{ time }}</span>
    <span class="participants">
      <span
        v-for="p in participants"
        :key="p.identity"
        class="chip"
        :class="{ speaking: isSpeaking(p.identity) }"
      >
        <Avatar
          :user-id="userIdOf(p.identity)"
          :nick="nickOf(p)"
          :avatar="avatarOf(userIdOf(p.identity))"
          :size="26"
        />
      </span>
      <span v-if="extra" class="extra">+{{ extra }}</span>
      <span v-if="!participants.length" class="waiting">ждём собеседников…</span>
    </span>
  </button>
</template>

<style scoped>
.call-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 6px 14px;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  color: var(--text);
}
.mic {
  font-size: 15px;
}
.time {
  font-size: 13px;
  font-weight: 600;
}
.participants {
  display: flex;
  align-items: center;
  gap: 6px;
}
.chip {
  display: inline-flex;
  border-radius: 50%;
  padding: 2px;
  transition: box-shadow 0.2s, border-color 0.2s;
}
.chip.speaking {
  border: 2px solid var(--green);
  box-shadow: 0 0 8px rgba(35, 165, 90, 0.6);
}
.extra {
  font-size: 12px;
  color: var(--text-dim);
}
.waiting {
  font-size: 12px;
  color: var(--text-dim);
}

</style>
