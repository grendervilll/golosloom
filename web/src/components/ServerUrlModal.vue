// Первичная настройка адреса сервера (для Tauri-приложения при первом запуске).
<script setup lang="ts">
import { ref } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { toast } from 'vue-sonner'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'

const emit = defineEmits<{ (e: 'close'): void }>()

const settings = useSettingsStore()
const url = ref(settings.serverUrl)
const busy = ref(false)
const error = ref('')

async function save() {
  busy.value = true
  error.value = ''
  try {
    settings.setServerUrl(url.value.trim())
    await settings.loadConfig()
    toast.info('Сервер подключён')
    emit('close')
  } catch (e: any) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Dialog :open="true" @update:open="(o) => { if (!o) emit('close') }">
    <DialogContent class="max-w-[420px]">
      <DialogHeader class="text-center">
        <DialogTitle class="text-center">Подключение к серверу</DialogTitle>
        <DialogDescription class="text-center">Укажите адрес вашего сервера Golosloom</DialogDescription>
      </DialogHeader>
      <div class="field modal-field">
        <input v-model="url" placeholder="https://golosloom.example.com" />
      </div>
      <div v-if="error" class="error-text">{{ error }}</div>
      <DialogFooter class="grid-cols-1">
        <Button :disabled="busy" @click="save">Подключиться</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
