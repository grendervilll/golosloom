// Первичная настройка адреса сервера (для Tauri-приложения при первом запуске).
<script setup lang="ts">
import { ref } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { useToasts } from '../stores/toasts'

const emit = defineEmits<{ (e: 'close'): void }>()

const settings = useSettingsStore()
const toasts = useToasts()
const url = ref(settings.serverUrl)
const busy = ref(false)
const error = ref('')

async function save() {
  busy.value = true
  error.value = ''
  try {
    settings.setServerUrl(url.value.trim())
    await settings.loadConfig()
    toasts.push({ kind: 'info', text: 'Сервер подключён' })
    emit('close')
  } catch (e: any) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="modal-backdrop">
    <div class="modal">
      <h2>Подключение к серверу</h2>
      <p class="hint-text">Укажите адрес вашего сервера Golosloom</p>
      <div class="field">
        <input v-model="url" placeholder="https://golosloom.example.com" />
      </div>
      <div v-if="error" class="error-text">{{ error }}</div>
      <div class="row end">
        <button class="primary" :disabled="busy" @click="save">Подключиться</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.row.end {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}
</style>
