// Проверка обновлений: в Electron обновление инициируется из main process
// через electron-updater. Этот компонент просто показывает диалог обновления.
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'

const visible = ref(false)
const busy = ref(false)
const newVersion = ref('')
const progress = ref('')
const error = ref('')

function isElectron(): boolean {
  return typeof window !== 'undefined' && !!(window as any).__ELECTRON__?.secureStorage
}

function onUpdateAvailable(_event: Event, version: string) {
  newVersion.value = version || ''
  visible.value = true
}

function onUpdateProgress(_event: Event, pct: number) {
  progress.value = `Скачано ${pct}%`
}

function onUpdateError(_event: Event, msg: string) {
  error.value = String(msg).slice(0, 200)
}

onMounted(() => {
  if (!isElectron()) return
  // Слушаем IPC-события от main process (electron-updater).
  // Пока IPC не настроен — просто скрываем компонент.
})

onUnmounted(() => {
  // отписка от IPC если была
})

function installNow() {
  busy.value = true
  error.value = ''
  // В Electron main process сам скачивает и устанавливает.
  // Renderer лишь показывает статус. Перезапуск — из main process.
  busy.value = false
}

function later() {
  visible.value = false
}
</script>

<template>
  <Dialog :open="visible" @update:open="(o) => { if (!o) visible = false }">
    <DialogContent class="max-w-[380px] text-center">
      <DialogHeader class="text-center">
        <DialogTitle class="text-center">⬆️ Доступно обновление</DialogTitle>
      </DialogHeader>
      <p v-if="newVersion">Вышла новая версия Golosloom <b>{{ newVersion }}</b>. Обновить сейчас?</p>
      <p v-else>Вышла новая версия Golosloom. Обновить сейчас?</p>
      <p v-if="progress" class="muted">{{ progress }}</p>
      <p v-if="error" class="error-text">{{ error }}</p>
      <DialogFooter class="grid-cols-2">
        <Button variant="secondary" :disabled="busy" @click="later">Позже</Button>
        <Button :disabled="busy" @click="installNow">Да, обновить</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
