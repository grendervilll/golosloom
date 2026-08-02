// Панель чата — главное содержимое центра: история, отправка, редактирование.
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useChannelsStore } from '../stores/channels'
import { useChatStore, type ChatMessage } from '../stores/chat'
import { useCallStore } from '../stores/calls'
import { useToasts } from '../stores/toasts'
import MessageItem from './MessageItem.vue'
import EmojiPicker from './EmojiPicker.vue'

const emit = defineEmits<{ (e: 'toggle-participants'): void; (e: 'open-invite'): void; (e: 'open-call'): void }>()

const auth = useAuthStore()
const channels = useChannelsStore()
const chat = useChatStore()
const calls = useCallStore()
const toasts = useToasts()
const showPicker = ref(false)

const listEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)
const menu = ref({ x: 0, y: 0, msg: null as ChatMessage | null })

const messages = computed(() => chat.messages.get(channels.currentId) || [])
const channelName = computed(() => channels.current?.name || '')
const canModerate = computed(() => chat.canSeeDeleted())

async function scrollBottom() {
  await nextTick()
  if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
}

watch(messages, () => void scrollBottom(), { deep: true })
onMounted(() => void scrollBottom())

async function send() {
  const text = chat.draft.trim()
  if (!text) return
  if (chat.editingId) {
    await chat.edit(channels.currentId, chat.editingId, text)
    return
  }
  const ok = await chat.send(channels.currentId, text)
  if (!ok) {
    toasts.push({ kind: 'warning', text: 'Ключ канала ещё не получен, повторите позже' })
    return
  }
  chat.draft = ''
}

function insertEmoji(e: string) {
  const el = inputEl.value
  const start = el?.selectionStart ?? chat.draft.length
  const end = el?.selectionEnd ?? start
  chat.draft = chat.draft.slice(0, start) + e + chat.draft.slice(end)
  void nextTick(() => {
    el?.focus()
    el?.setSelectionRange(start + e.length, start + e.length)
  })
}

async function sendGif(url: string) {
  showPicker.value = false
  const ok = await chat.send(channels.currentId, '![gif](' + url + ')')
  if (!ok) {
    toasts.push({ kind: 'warning', text: 'Ключ канала ещё не получен, повторите позже' })
  }
}

function startEdit(msg: ChatMessage) {
  if (msg.senderId !== auth.user?.id) return
  chat.editingId = msg.id
  chat.draft = msg.text
  inputEl.value?.focus()
}

async function remove(msg: ChatMessage) {
  menu.value.msg = null
  await chat.remove(channels.currentId, msg.id)
}

function showOriginal(msg: ChatMessage) {
  if (!canModerate.value || !msg.original) return
  const t = msg.text
  msg.text = msg.original
  msg.original = t
}

function openMenu(e: MouseEvent, msg: ChatMessage) {
  e.preventDefault?.()
  if (!canModerate.value && msg.senderId !== auth.user?.id) return
  menu.value = { x: e.clientX, y: e.clientY, msg }
}

function closeMenu() {
  menu.value.msg = null
  showPicker.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    void send()
  }
  if (e.key === 'Escape') closeMenu()
}
</script>

<template>
  <div class="chat-panel" @click="closeMenu">
    <div class="chat-head">
      <h2><span class="hash">#</span> {{ channelName }}</h2>
      <span class="muted small">ID канала: {{ channels.currentId }}</span>
      <button
        v-if="channels.current?.private"
        class="invite-btn"
        title="Пригласить пользователя в приватный канал"
        @click="emit('open-invite')"
      >
        🔗 Пригласить
      </button>
      <button v-if="!calls.inCall" class="invite-btn" title="Позвонить участникам канала" @click="emit('open-call')">
        📞 Позвонить
      </button>
      <button class="members-btn" title="Участники" @click="emit('toggle-participants')">👥</button>
    </div>
    <div ref="listEl" class="chat-list">
      <MessageItem
        v-for="m in messages"
        :key="m.id"
        :msg="m"
        :my-id="auth.user?.id || 0"
        :can-moderate="canModerate"
        @contextmenu="(e) => openMenu(e, m)"
      />
      <p v-if="messages.length === 0" class="muted empty">Сообщений пока нет</p>
    </div>
    <div class="chat-input">
      <textarea
        v-model="chat.draft"
        ref="inputEl"
        rows="1"
        :placeholder="chat.editingId ? 'Редактирование сообщения...' : 'Сообщение в канал...'"
        @keydown="onKeydown"
      ></textarea>
      <div class="input-row">
        <button v-if="chat.editingId" @click="chat.editingId = 0; chat.draft = ''">Отменить</button>
        <button class="emoji-btn" title="Смайлики и GIF" @click.stop="showPicker = !showPicker">😊</button>
        <button class="primary" @click="send">{{ chat.editingId ? 'Сохранить' : 'Отправить' }}</button>
      </div>
      <EmojiPicker
        v-if="showPicker"
        @insert="insertEmoji"
        @send-gif="sendGif"
        @close="showPicker = false"
      />
    </div>

    <div v-if="menu.msg" class="ctx-menu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @click.stop>
      <button v-if="menu.msg.senderId === auth.user?.id" @click="startEdit(menu.msg!)">Изменить сообщение</button>
      <button v-if="menu.msg.senderId === auth.user?.id || canModerate" class="danger" @click="remove(menu.msg!)">
        Удалить сообщение
      </button>
      <button v-if="canModerate && menu.msg.original" @click="showOriginal(menu.msg!)">Показать оригинал сообщения</button>
    </div>
  </div>
</template>

<style scoped>
.chat-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  background: var(--bg);
}
.chat-panel.in-call {
  flex: 0 0 300px;
  border-top: 1px solid var(--border);
}
.chat-head {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--bg2);
}
.chat-head h2 {
  font-size: 16px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.hash {
  color: var(--text-dim);
}
.small {
  font-size: 12px;
}
.members-btn {
  margin-left: auto;
  padding: 4px 10px;
  display: block;
}
.invite-btn {
  margin-left: auto;
  padding: 5px 12px;
  background: transparent;
  border: 1px solid var(--accent);
  color: var(--text);
  font-size: 13px;
}
.invite-btn:hover {
  background: var(--bg4);
}
.chat-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.empty {
  text-align: center;
  margin-top: 40px;
}
.chat-input {
  padding: 10px 16px;
  border-top: 1px solid var(--border);
  background: var(--bg2);
  display: flex;
  flex-direction: column;
  gap: 8px;
  position: relative;
}
.chat-input textarea {
  resize: none;
  background: var(--bg);
}
.input-row {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.emoji-btn {
  font-size: 20px;
  line-height: 1;
  padding: 8px 12px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
}
.emoji-btn:hover {
  background: var(--bg3);
}
.ctx-menu {
  position: fixed;
  z-index: 200;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 200px;
}
.ctx-menu button {
  text-align: left;
  background: transparent;
}
.ctx-menu button:hover {
  background: var(--bg4);
}
</style>
