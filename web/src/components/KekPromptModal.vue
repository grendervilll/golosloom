// Разблокировка переписки: вход по токену (без пароля) не позволяет
// расшифровать парольные бэкапы ключей. Просим ввести пароль один раз —
// KEK сохраняется в хранилище, дальше автовход работает без запросов.
<script setup lang="ts">
import { ref } from 'vue'
import { useChannelsStore } from '../stores/channels'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'

const channels = useChannelsStore()
const password = ref('')
const busy = ref(false)

async function unlock() {
  if (!password.value || busy.value) return
  busy.value = true
  try {
    const ok = await channels.submitKek(password.value)
    if (ok) password.value = ''
  } finally {
    busy.value = false
  }
}

function onOpenChange(open: boolean) {
  if (!open) channels.dismissKekPrompt()
}
</script>

<template>
  <Dialog :open="channels.kekPromptVisible" @update:open="onOpenChange">
    <DialogContent class="max-w-[420px]">
      <DialogHeader>
        <DialogTitle class="text-center">Расшифровать переписку</DialogTitle>
      </DialogHeader>
      <p class="text-sm text-muted-foreground">
        Для расшифровки сообщений введите пароль аккаунта. Понадобится один раз —
        в дальнейшем ключи будут восстановлены автоматически на любом устройстве.
      </p>
      <input
        v-model="password"
        type="password"
        placeholder="Пароль"
        class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        @keydown.enter="unlock"
        autofocus
      />
      <p v-if="channels.kekPromptError" class="text-sm text-red-500">{{ channels.kekPromptError }}</p>
      <DialogFooter class="flex justify-end gap-2">
        <Button variant="ghost" @click="channels.dismissKekPrompt()">Позже</Button>
        <Button :disabled="busy || !password" @click="unlock">
          {{ busy ? 'Расшифровываю…' : 'Разблокировать' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
