// Приглашение на регистрацию: одноразовая ссылка на 5 минут.
// Если создано из канала — зарегистрировавшийся сразу получит доступ к нему.
<script setup lang="ts">
import { ref } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { useToasts } from '../stores/toasts'

const emit = defineEmits<{ (e: 'close'): void }>()

const settings = useSettingsStore()
const link = ref('')
const busy = ref(false)
const error = ref('')

async function create(channelId?: number) {
  busy.value = true
  error.value = ''
  try {
    const res = await settings.api.createRegistrationInvite(channelId)
    const url = new URL(window.location.href)
    url.hash = '#/register?invite=' + res.token
    link.value = url.toString()
  } catch (e: any) {
    error.value = String(e?.message || e).slice(0, 150)
  } finally {
    busy.value = false
  }
}

async function copy() {
  try {
    await navigator.clipboard.writeText(link.value)
    useToasts().push({ kind: 'info', text: 'Ссылка скопирована (действует 5 минут)' })
  } catch {
    useToasts().push({ kind: 'warning', text: 'Не удалось скопировать — скопируйте ссылку вручную' })
  }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal reg-invite">
      <h2>Пригласить зарегистрироваться</h2>
      <p v-if="!link" class="muted">Создать одноразовую ссылку на регистрацию (действует 5 минут). Зарегистрировавшийся сразу получит доступ к этому каналу.</p>
      <p v-if="error" class="error-text">{{ error }}</p>
      <div v-if="link" class="invite-link">
        <input readonly :value="link" @focus="($event.target as HTMLInputElement).select()" />
        <button class="primary" @click="copy">Копировать</button>
      </div>
      <div class="row">
        <button v-if="!link" class="primary" :disabled="busy" @click="create(undefined)">Создать ссылку</button>
        <button v-if="!link" :disabled="busy" @click="emit('close')">Закрыть</button>
        <button v-else @click="emit('close')">Готово</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.reg-invite {
  width: 420px;
}
.invite-link {
  display: flex;
  gap: 8px;
  margin: 10px 0;
}
.invite-link input {
  flex: 1;
  font-size: 12px;
}
</style>
