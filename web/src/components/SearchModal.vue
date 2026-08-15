// «Найти контакт»: поиск людей и сообществ по нику/названию или id.
// Человек → личный чат (создаётся при первом обращении);
// сообщество → подписка и открытие.
<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useChannelsStore } from '../stores/channels'
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
import Avatar from './Avatar.vue'
import type { SearchResult } from '../api/types'

const emit = defineEmits<{ (e: 'close'): void }>()

const channels = useChannelsStore()
const settings = useSettingsStore()
const q = ref('')
const result = ref<SearchResult>({ users: [], communities: [] })
const busy = ref(false)
let timer = 0

watch(q, () => {
  if (timer) window.clearTimeout(timer)
  timer = window.setTimeout(() => void runSearch(), 300)
})

onMounted(() => void runSearch())

async function runSearch() {
  const query = q.value.trim()
  if (!query) {
    result.value = { users: [], communities: [] }
    return
  }
  busy.value = true
  try {
    result.value = await settings.api.search(query)
  } catch {
    result.value = { users: [], communities: [] }
  } finally {
    busy.value = false
  }
}

async function openUser(userId: number, nick: string) {
  try {
    await channels.openDM(userId)
    toast.info(`Личный чат с ${nick}`)
    emit('close')
  } catch (e: any) {
    toast.error(String(e?.message || e).slice(0, 120))
  }
}

async function subscribe(communityId: number, name: string) {
  try {
    await channels.subscribeCommunity(communityId)
    toast.info(`Вы подписаны на «${name}»`)
    emit('close')
  } catch (e: any) {
    toast.error(String(e?.message || e).slice(0, 120))
  }
}

// Формат числа подписчиков: до 1 млн точно, дальше 1.1М, 1.2М…
function subs(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000
    return (m >= 10 ? Math.round(m) : Math.round(m * 10) / 10) + 'М'
  }
  return String(n)
}
</script>

<template>
  <Dialog :open="true" @update:open="(o) => { if (!o) emit('close') }">
    <DialogContent class="max-h-[85vh] max-w-[460px] overflow-y-auto">
      <DialogHeader class="text-center">
        <DialogTitle class="text-center">Найти контакт</DialogTitle>
      </DialogHeader>
      <input
        v-model="q"
        class="search-input"
        placeholder="Ник, имя сообщества или ID…"
        autofocus
      />
      <p v-if="busy" class="muted center small">Поиск…</p>

      <p v-if="result.users.length" class="search-title">Люди</p>
      <div v-for="u in result.users" :key="'u' + u.id" class="search-row" @click="openUser(u.id, u.nick)">
        <Avatar :user-id="u.id" :nick="u.nick" :avatar="u.avatar || null" :size="36" />
        <div class="search-info">
          <b>{{ u.nick }}</b>
          <span class="muted small">ID: {{ u.id }} · начать личный чат</span>
        </div>
      </div>

      <p v-if="result.communities.length" class="search-title">Сообщества</p>
      <div v-for="c in result.communities" :key="'c' + c.id" class="search-row" @click="subscribe(c.id, c.name)">
        <div class="comm-ico">📣</div>
        <div class="search-info">
          <b>{{ c.name }}</b>
          <span class="muted small">{{ subs(c.member_count || 0) }} подписчиков · ID {{ c.id }} · подписаться</span>
        </div>
      </div>

      <p v-if="!busy && q.trim() && !result.users.length && !result.communities.length" class="muted center">
        Ничего не найдено
      </p>
      <p v-if="!q.trim()" class="muted center small">Ищите по нику, названию сообщества или ID</p>

      <DialogFooter class="grid-cols-1">
        <Button variant="secondary" @click="emit('close')">Закрыть</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
.search-input {
  width: 100%;
  background: var(--bg3);
  border: none;
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 14px;
  color: var(--text);
}
.search-title {
  font-size: 11px;
  text-transform: uppercase;
  color: var(--text-dim);
  font-weight: 700;
  margin: 10px 0 4px;
}
.search-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  cursor: pointer;
}
.search-row:hover {
  background: var(--bg3);
}
.search-info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.search-info b {
  font-size: 14px;
}
.comm-ico {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--bg3);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
}
.center {
  text-align: center;
  padding: 8px;
}
.small {
  font-size: 12px;
}
</style>
