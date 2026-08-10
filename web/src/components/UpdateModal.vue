// Проверка обновлений в Tauri: при запуске спрашиваем пользователя,
// скачать ли новую версию (скачивается под текущую ОС/архитектуру
// из GitHub Releases через плагин updater).
<script setup lang="ts">
import { onMounted, ref } from 'vue'
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

function isTauri(): boolean {
  return typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__
}

async function checkForUpdates() {
  if (!isTauri()) return
  try {
    const w = (window as any).__TAURI__
    if (!w?.updater?.check) return
    const update = await w.updater.check()
    if (update && update.available) {
      newVersion.value = update.version || ''
      visible.value = true
    }
  } catch {
    /* сервер недоступен или нет обновлений — молчим */
  }
}

async function installNow() {
  busy.value = true
  error.value = ''
  try {
    const w = (window as any).__TAURI__
    await w.updater.downloadAndInstall((event: any) => {
      if (event?.event === 'DownloadProgress' && event.data?.total) {
        const pct = Math.round((event.data.transferred / event.data.total) * 100)
        progress.value = `Скачано ${pct}%`
      }
    })
    // Перезапуск для применения обновления.
    try {
      await w.process.relaunch()
    } catch {
      /* после установки пользователь перезапустит приложение сам */
    }
  } catch (e: any) {
    error.value = String(e?.message || e).slice(0, 200)
  } finally {
    busy.value = false
  }
}

function later() {
  visible.value = false
}

onMounted(checkForUpdates)
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
