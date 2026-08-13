// Просмотр фото без скачивания: затемнённый лайтбокс поверх всего.
// Клик по фото закрывает; ПКМ — нативное меню браузера («Сохранить как…»).
<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'

const props = defineProps<{
  src: string
  filename: string
  video?: boolean
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
    <div class="viewer" @click="emit('close')">
      <div class="viewer-box">
        <video
          v-if="props.video"
          class="viewer-media"
          :src="props.src"
          controls
          autoplay
          @click.stop
        ></video>
        <img
          v-else
          class="viewer-media"
          :src="props.src"
          :alt="props.filename"
          @click.stop
        />
      </div>
      <div class="viewer-hint">Клик — закрыть · ПКМ — скачать</div>
    </div>
  </Teleport>
</template>

<style scoped>
.viewer {
  position: fixed;
  inset: 0;
  z-index: 300;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: zoom-out;
  animation: viewer-in 0.18s ease-out;
}
@keyframes viewer-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
.viewer-box {
  max-width: 92vw;
  max-height: 88vh;
}
.viewer-media {
  max-width: 92vw;
  max-height: 88vh;
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 12px 60px rgba(0, 0, 0, 0.7);
  cursor: default;
  display: block;
}
.viewer-hint {
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
