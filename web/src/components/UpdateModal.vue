// Проверка обновлений для Electron (Windows/macOS/Linux) через GitHub Releases.
// Показывает диалог с кнопками "Принять" (скачать в Загрузки и установить) и "Отклонить" (не показывать до следующей версии).
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
let assetName = ''

function isElectron(): boolean {
  return typeof window !== 'undefined' && !!(window as any).__ELECTRON__?.updater?.check
}

function onUpdateAvailable(_event: unknown, version: string, assetNameParam?: string) {
  // Main process уже проверил dismissed, но на всякий случай
  newVersion.value = version || ''
  if (assetNameParam) assetName = assetNameParam
  else if (!assetName) {
    // Попробуем получить assetName через check, если main прислал только версию
    void (async () => {
      try {
        const api = (window as any).__ELECTRON__?.updater
        const res = await api?.check()
        if (res?.assetName) assetName = res.assetName
      } catch {}
    })()
  }
  visible.value = true
  progress.value = ''
  error.value = ''
}

function onUpdateProgress(_event: unknown, pct: number) {
  progress.value = `Скачано ${pct}%`
}

function onUpdateError(_event: unknown, msg: string) {
  error.value = String(msg).slice(0, 300)
  busy.value = false
}

let unsubAvailable: (() => void) | null = null
let unsubProgress: (() => void) | null = null
let unsubError: (() => void) | null = null

onMounted(async () => {
  if (!isElectron()) return
  const api = (window as any).__ELECTRON__.updater
  // Слушаем события от main (авто-проверка при старте)
  unsubAvailable = api.onAvailable(onUpdateAvailable as any)
  unsubProgress = api.onProgress(onUpdateProgress as any)
  unsubError = api.onError(onUpdateError as any)

  // Также триггерим ручную проверку (на случай если main еще не успел)
  try {
    const res = await api.check()
    if (res && res.version) {
      newVersion.value = res.version
      assetName = res.assetName || ''
      visible.value = true
    }
  } catch {}
})

onUnmounted(() => {
  unsubAvailable?.()
  unsubProgress?.()
  unsubError?.()
})

async function installNow() {
  if (!isElectron()) return
  const api = (window as any).__ELECTRON__.updater
  busy.value = true
  error.value = ''
  progress.value = 'Загрузка...'
  try {
    await api.download()
    progress.value = 'Загрузка завершена — откройте файл в Загрузках для установки'
    // Не закрываем сразу, пусть пользователь видит путь
    // На Windows/macOS shell.openPath уже открыл установщик
  } catch (e: any) {
    error.value = String(e?.message || e).slice(0, 300)
  } finally {
    busy.value = false
  }
}

async function later() {
  if (isElectron() && newVersion.value) {
    try {
      const api = (window as any).__ELECTRON__.updater
      await api.dismiss(newVersion.value)
    } catch {}
  }
  visible.value = false
}
</script>

<template>
  <Dialog :open="visible" @update:open="(o) => { if (!o) visible = false }">
    <DialogContent class="max-w-[420px] text-center">
      <DialogHeader class="text-center">
        <DialogTitle class="text-center">⬆️ Доступно обновление</DialogTitle>
      </DialogHeader>
      <div class="space-y-2">
        <p v-if="newVersion">Вышла новая версия Golosloom <b>{{ newVersion }}</b>. Обновить сейчас?</p>
        <p v-else>Вышла новая версия Golosloom. Обновить сейчас?</p>
        <p v-if="assetName" class="text-xs text-muted-foreground">Файл: {{ assetName }} — автовыбор архитектуры ({{ isElectron() ? 'определяется автоматически' : 'auto' }})</p>
        <p v-if="progress" class="text-sm font-medium text-primary">{{ progress }}</p>
        <p v-if="error" class="error-text">{{ error }}</p>
        <p v-if="!isElectron()" class="text-xs text-muted-foreground">Откройте сайт для загрузки вручную.</p>
        <p v-else class="text-xs text-muted-foreground">После скачивания файл появится в папке «Загрузки» и установщик запустится автоматически.</p>
      </div>
      <DialogFooter class="grid-cols-2">
        <Button variant="secondary" :disabled="busy" @click="later">Отклонить</Button>
        <Button :disabled="busy" @click="installNow">Принять</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
