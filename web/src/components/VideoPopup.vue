// Просмотр видео-сообщения: прямоугольный попап по центру экрана,
// занимает ~70% доступной площади. Клик по фону / Esc — закрыть.
<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'

defineProps<{
  src: string
  filename: string
}>()
const emit = defineEmits<{ (e: 'close'): void }>()

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div class="vpop" @click="emit('close')">
      <div class="vpop-box">
        <video :src="src" controls autoplay @click.stop></video>
      </div>
      <div class="vpop-hint">Клик — закрыть</div>
    </div>
  </Teleport>
</template>

<style scoped>
.vpop {
  position: fixed;
  inset: 0;
  z-index: 300;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: default;
  animation: vpop-in 0.18s ease-out;
}
@keyframes vpop-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
.vpop-box {
  width: 70vw;
  height: 70vh;
  max-width: 70vw;
  max-height: 70vh;
  background: #000;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 12px 60px rgba(0, 0, 0, 0.7);
}
.vpop-box video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.vpop-hint {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 999px;
  padding: 6px 14px;
}
</style>
