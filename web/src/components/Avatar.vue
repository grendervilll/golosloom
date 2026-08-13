// Аватар пользователя: картинка с сервера или первая буква ника.
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useSettingsStore } from '../stores/settings'

const props = defineProps<{
  userId: number
  nick: string
  avatar?: string | null
  size?: number
  color?: string
}>()

const settings = useSettingsStore()
const failed = ref(false)

watch(
  () => props.avatar,
  () => (failed.value = false),
)

const src = computed(() => {
  if (!props.avatar || failed.value) return ''
  return settings.serverUrl + `/api/avatars/${props.userId}?v=${encodeURIComponent(props.avatar)}`
})
const letter = computed(() => (props.nick || '?').charAt(0).toUpperCase())
</script>

<template>
  <span
    class="avatar"
    :style="{
      width: (size ?? 28) + 'px',
      height: (size ?? 28) + 'px',
      fontSize: ((size ?? 28) * 0.48) + 'px',
      background: color || 'var(--accent)',
    }"
  >
    <img v-if="src" :src="src" alt="" @error="failed = true" />
    <span v-else class="letter">{{ letter }}</span>
  </span>
</template>

<style scoped>
.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  color: #fff;
  font-weight: 700;
  user-select: none;
}
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.letter {
  line-height: 1;
}
</style>
