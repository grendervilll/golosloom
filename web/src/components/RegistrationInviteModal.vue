// Приглашение на регистрацию: одноразовая ссылка на 5 минут.
// Если создано из канала — зарегистрировавшийся сразу получит доступ к нему.
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
// Текущий канал: зарегистрировавшийся по ссылке сразу получит к нему доступ.
const props = defineProps<{ channelId?: number }>()

const settings = useSettingsStore()
const link = ref('')
const busy = ref(false)
const error = ref('')

async function create() {
  busy.value = true
  error.value = ''
  try {
    const res = await settings.api.createRegistrationInvite(props.channelId)
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
    toast.info('Ссылка скопирована (действует 5 минут)')
  } catch {
    toast.warning('Не удалось скопировать — скопируйте ссылку вручную')
  }
}
</script>

<template>
  <Dialog :open="true" @update:open="(o) => { if (!o) emit('close') }">
    <DialogContent class="max-w-[420px]">
      <DialogHeader class="text-center">
        <DialogTitle class="text-center">Пригласить зарегистрироваться</DialogTitle>
      </DialogHeader>
      <p v-if="!link" class="hint-text text-center">
        Создать одноразовую ссылку на регистрацию (действует 5 минут). Зарегистрировавшийся сразу получит доступ к этому каналу.
      </p>
      <p v-if="error" class="error-text">{{ error }}</p>
      <div v-if="link" class="invite-link">
        <input readonly :value="link" @focus="($event.target as HTMLInputElement).select()" />
        <Button variant="outline" @click="copy">Копировать</Button>
      </div>
      <DialogFooter :class="link ? 'grid-cols-1' : 'grid-cols-2'">
        <Button v-if="!link" variant="secondary" :disabled="busy" @click="emit('close')">Закрыть</Button>
        <Button v-if="!link" :disabled="busy" @click="create">Создать ссылку</Button>
        <Button v-else @click="emit('close')">Готово</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
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
