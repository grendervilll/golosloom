// Настройки клиента: адрес сервера, шумоподавление, качество демонстрации.
<script setup lang="ts">
import { ref } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { useToasts } from '../stores/toasts'

const emit = defineEmits<{ (e: 'close'): void }>()

const settings = useSettingsStore()
const toasts = useToasts()

const serverUrl = ref(settings.serverUrl)

async function save() {
  try {
    settings.setServerUrl(serverUrl.value.trim())
    await settings.loadConfig()
    toasts.push({ kind: 'info', text: 'Настройки сохранены' })
    emit('close')
  } catch (e: any) {
    toasts.push({ kind: 'error', text: 'Не удалось подключиться к серверу: ' + e.message })
  }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal">
      <h2>Настройки</h2>
      <div class="field">
        <label>Адрес сервера</label>
        <input v-model="serverUrl" placeholder="https://ваш-домен.example" />
        <p class="hint-text">Можно сменить при переезде на другой VPS — пересборка приложения не нужна</p>
      </div>
      <div class="field">
        <label>Шумоподавление микрофона</label>
        <select :value="settings.noiseSuppression" @change="settings.setNoiseSuppression(($event.target as HTMLSelectElement).value as any)">
          <option value="off">Выключено</option>
          <option value="low">Лёгкое (по умолчанию)</option>
          <option value="medium">Среднее</option>
          <option value="high">Сильное</option>
        </select>
      </div>
      <div class="field">
        <label>Качество демонстрации экрана</label>
        <select :value="settings.screenQuality" @change="settings.setScreenQuality(($event.target as HTMLSelectElement).value)">
          <option value="1080p60">1080p / 60 fps</option>
          <option value="1080p30">1080p / 30 fps</option>
          <option value="720p60">720p / 60 fps</option>
          <option value="720p30">720p / 30 fps</option>
          <option value="480p30">480p / 30 fps</option>
        </select>
      </div>
      <div class="row end">
        <button class="primary" @click="save">Сохранить</button>
        <button @click="emit('close')">Закрыть</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.row.end {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
</style>
