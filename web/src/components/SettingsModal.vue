// Настройки клиента: адрес сервера, шумоподавление, качество демонстрации.
<script setup lang="ts">
import { ref } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { toast } from 'vue-sonner'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'

const emit = defineEmits<{ (e: 'close'): void }>()

const settings = useSettingsStore()

const serverUrl = ref(settings.serverUrl)

async function save() {
  try {
    settings.setServerUrl(serverUrl.value.trim())
    await settings.loadConfig()
    toast.info('Настройки сохранены')
    emit('close')
  } catch (e: any) {
    toast.error('Не удалось подключиться к серверу: ' + e.message)
  }
}
</script>

<template>
  <Dialog :open="true" @update:open="(o) => { if (!o) emit('close') }">
    <DialogContent class="max-w-[420px]">
      <DialogHeader class="text-center">
        <DialogTitle class="text-center">Настройки</DialogTitle>
      </DialogHeader>
      <div class="field modal-field">
        <label>Адрес сервера</label>
        <input v-model="serverUrl" placeholder="https://ваш-домен.example" />
        <p class="hint-text">Можно сменить при переезде на другой VPS — пересборка приложения не нужна</p>
      </div>
      <div class="field modal-field">
        <label>Шумоподавление микрофона</label>
        <select :value="settings.noiseSuppression" @change="settings.setNoiseSuppression(($event.target as HTMLSelectElement).value as any)">
          <option value="off">Выключено</option>
          <option value="low">Лёгкое (по умолчанию)</option>
          <option value="medium">Среднее</option>
          <option value="high">Сильное</option>
        </select>
      </div>
      <div class="field modal-field">
        <label>Качество демонстрации экрана</label>
        <select :value="settings.screenQuality" @change="settings.setScreenQuality(($event.target as HTMLSelectElement).value)">
          <option value="1080p60">1080p / 60 fps</option>
          <option value="1080p30">1080p / 30 fps</option>
          <option value="720p60">720p / 60 fps</option>
          <option value="720p30">720p / 30 fps</option>
          <option value="480p30">480p / 30 fps</option>
        </select>
      </div>
      <DialogFooter class="grid-cols-2">
        <Button variant="secondary" @click="emit('close')">Закрыть</Button>
        <Button @click="save">Сохранить</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
