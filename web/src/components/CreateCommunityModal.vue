// «Создать сообщество»: владелец публикует статьи/медиа/файлы,
// подписчики — только читают. Название может повторяться, id уникален.
<script setup lang="ts">
import { ref } from 'vue'
import { useChannelsStore } from '../stores/channels'
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

const channels = useChannelsStore()
const name = ref('')
const busy = ref(false)
const error = ref('')

async function create() {
  const n = name.value.trim()
  if (!n) {
    error.value = 'Введите название сообщества'
    return
  }
  busy.value = true
  error.value = ''
  try {
    await channels.createCommunity(n)
    toast.info(`Сообщество «${n}» создано`)
    emit('close')
  } catch (e: any) {
    error.value = String(e?.message || e).slice(0, 150)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Dialog :open="true" @update:open="(o) => { if (!o) emit('close') }">
    <DialogContent class="max-w-[420px]">
      <DialogHeader class="text-center">
        <DialogTitle class="text-center">Создать сообщество</DialogTitle>
      </DialogHeader>
      <div class="field modal-field">
        <label>Название</label>
        <input v-model="name" placeholder="Название сообщества" @keydown.enter="create" />
      </div>
      <p class="hint-text">
        Вы — владелец: публикуете статьи, фото, аудио, видео и файлы.
        Остальные могут подписаться и читать.
      </p>
      <div v-if="error" class="error-text">{{ error }}</div>
      <DialogFooter class="grid-cols-2">
        <Button variant="secondary" @click="emit('close')">Отмена</Button>
        <Button :disabled="busy" @click="create">Создать</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
