// Окно входящего звонка: принять или отклонить.
<script setup lang="ts">
import { computed } from 'vue'
import { useCallStore } from '../stores/calls'
import { toast } from 'vue-sonner'
import type { Call } from '../api/types'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'

const calls = useCallStore()

const call = computed(() => calls.ringingCall)

async function accept(c: Call) {
  try {
    await calls.accept(c)
  } catch (e: any) {
    toast.error(e.message || 'Не удалось подключиться к звонку')
  }
}
async function decline(c: Call) {
  await calls.decline(c)
}
</script>

<template>
  <!-- :open управляется только звонком: Esc/клик мимо не закроют входящий вызов. -->
  <Dialog v-if="call" :open="true">
    <DialogContent class="max-w-[360px] text-center">
      <DialogHeader class="text-center">
        <DialogTitle class="text-center">📞 Входящий звонок</DialogTitle>
      </DialogHeader>
      <p>Вам звонят в канале. Принять?</p>
      <DialogFooter class="grid-cols-2">
        <Button variant="outline" @click="decline(call)">Отклонить</Button>
        <Button class="bg-[#23a55a] hover:bg-[#23a55a]/90" @click="accept(call)">Принять</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
