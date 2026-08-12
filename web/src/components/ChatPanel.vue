// Панель чата — главное содержимое центра: история, отправка, редактирование.
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useChannelsStore } from '../stores/channels'
import { useChatStore, type ChatMessage } from '../stores/chat'
import { useCallStore } from '../stores/calls'
import { toast } from 'vue-sonner'
import MessageItem from './MessageItem.vue'
import EmojiPicker from './EmojiPicker.vue'

const emit = defineEmits<{ (e: 'toggle-participants'): void; (e: 'open-invite'): void; (e: 'open-call'): void; (e: 'open-reg-invite'): void }>()

const auth = useAuthStore()
const channels = useChannelsStore()
const chat = useChatStore()
const calls = useCallStore()
const showPicker = ref(false)

const listEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)
const menu = ref({ x: 0, y: 0, msg: null as ChatMessage | null })

const messages = computed(() => chat.messages.get(channels.currentId) || [])
const channelName = computed(() => channels.current?.name || '')
const canModerate = computed(() => chat.canSeeDeleted())
// Приглашение на регистрацию — только админ сервера или админ канала.
const canCreateRegInvite = computed(
  () => auth.isServerAdmin || channels.currentRole === 'channel_admin',
)

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
    toast.warning('Ключ канала ещё не получен, повторите позже')
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
    toast.warning('Ключ канала ещё не получен, повторите позже')
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
      <span class="muted small id-text">ID канала: {{ channels.currentId }}</span>
      <button
        v-if="channels.current?.private"
        class="icon-btn"
        title="Пригласить пользователя в приватный канал"
        @click="emit('open-invite')"
      >
        <svg class="ico" viewBox="0 0 640 512"><path d="M96 128a128 128 0 1 1 256 0A128 128 0 1 1 96 128zM0 482.3C0 383.8 79.8 304 178.3 304l91.4 0C368.2 304 448 383.8 448 482.3c0 16.4-13.3 29.7-29.7 29.7L29.7 512C13.3 512 0 498.7 0 482.3zM504 312l0-64-64 0c-13.3 0-24-10.7-24-24s10.7-24 24-24l64 0 0-64c0-13.3 10.7-24 24-24s24 10.7 24 24l0 64 64 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-64 0 0 64c0 13.3-10.7 24-24 24s-24-10.7-24-24z" /></svg>
      </button>
      <button
        v-if="canCreateRegInvite"
        class="icon-btn reg-invite-btn"
        title="Одноразовая ссылка на регистрацию (5 минут)"
        @click="emit('open-reg-invite')"
      >
        <svg class="ico" viewBox="0 0 512 512"><path d="M48 64C21.5 64 0 85.5 0 112c0 15.1 7.1 29.3 19.2 38.4L236.8 313.6c11.4 8.5 27 8.5 38.4 0L492.8 150.4c12.1-9.1 19.2-23.3 19.2-38.4c0-26.5-21.5-48-48-48L48 64zM0 176L0 384c0 35.3 28.7 64 64 64l384 0c35.3 0 64-28.7 64-64l0-208L294.4 339.2c-22.8 17.1-54 17.1-76.8 0L0 176z" /></svg>
      </button>
      <button v-if="!calls.inCall" class="icon-btn" title="Позвонить участникам канала" @click="emit('open-call')">
        <svg class="ico" viewBox="0 0 512 512"><path d="M164.9 24.6c-7.7-18.6-28-28.5-47.4-23.2l-88 24C12.1 30.2 0 46 0 64C0 311.4 200.6 512 448 512c18 0 33.8-12.1 38.6-29.5l24-88c5.3-19.4-4.6-39.7-23.2-47.4l-96-40c-16.3-6.8-35.2-2.1-46.3 11.6L304.7 368C234.3 334.7 177.3 277.7 144 207.3L193.3 167c13.7-11.2 18.4-30 11.6-46.3l-40-96z" /></svg>
      </button>
      <button class="icon-btn" title="Участники" @click="emit('toggle-participants')">
        <svg class="ico" viewBox="0 0 640 512"><path d="M144 0a80 80 0 1 1 0 160A80 80 0 1 1 144 0zM512 0a80 80 0 1 1 0 160A80 80 0 1 1 512 0zM0 298.7C0 239.8 47.8 192 106.7 192l42.7 0c15.9 0 31 3.5 44.6 9.7c-1.3 7.2-1.9 14.7-1.9 22.3c0 38.2 16.8 72.5 43.3 96c-.2 0-.4 0-.7 0L21.3 320C9.6 320 0 310.4 0 298.7zM405.3 320c-.2 0-.4 0-.7 0c26.5-23.5 43.3-57.8 43.3-96c0-7.6-.6-15.1-1.9-22.3c13.6-6.3 28.7-9.7 44.6-9.7l42.7 0C592.2 192 640 239.8 640 298.7c0 11.7-9.6 21.3-21.3 21.3L405.3 320z" /></svg>
      </button>
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
        <button v-if="chat.editingId" class="icon-btn" title="Отменить редактирование" @click="chat.editingId = 0; chat.draft = ''">
          <svg class="ico" viewBox="0 0 384 512"><path d="M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z" /></svg>
        </button>
        <button class="icon-btn" title="Смайлики и GIF" @click.stop="showPicker = !showPicker">
          <svg class="ico" viewBox="0 0 512 512"><path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM164.1 325.5C182 346.2 212.6 368 256 368s74-21.8 91.9-42.5c5.8-6.7 15.9-7.4 22.6-1.6s7.4 15.9 1.6 22.6C349.8 372.1 311.1 400 256 400s-93.8-27.9-116.1-53.5c-5.8-6.7-5.1-16.8 1.6-22.6s16.8-5.1 22.6 1.6zM144.4 208a32 32 0 1 1 64 0 32 32 0 1 1 -64 0zm192-32a32 32 0 1 1 0 64 32 32 0 1 1 0-64z" /></svg>
        </button>
        <button class="send-btn" title="Отправить" :disabled="!chat.draft.trim()" @click="send">
          <svg class="ico" viewBox="0 0 512 512"><path d="M498.1 5.6c10.1 7 15.4 19.1 13.5 31.2l-64 416c-1.5 9.7-7.4 18.2-16 23s-18.9 5.4-28 1.6L284 427.7l-68.5 74.1c-8.9 9.7-22.9 12.9-35.2 8.1S160 493.2 160 480l0-83.6c0-4 1.5-7.8 4.2-10.8L331.8 202.8c5.8-6.3 5.6-16-.4-22s-15.7-6.4-22-.7L106 360.8 17.7 316.6C7.1 311.3 .3 300.7 0 288.1s4.8-25.1 14.8-31.1l80.5-48.3 288.5-173.2 114.3-68.6z" /></svg>
        </button>
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
/* Круглые кнопки-иконки в шапке чата (единый стиль). */
.icon-btn {
  width: 34px;
  height: 34px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--bg4);
  flex-shrink: 0;
}
.icon-btn:hover:not(:disabled) {
  background: #43454d;
}
.icon-btn .ico {
  width: 15px;
  height: 15px;
  fill: var(--text-dim);
  flex-shrink: 0;
}
.icon-btn:hover .ico {
  fill: var(--text);
}
.reg-invite-btn .ico {
  fill: var(--accent);
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
.send-btn {
  width: 38px;
  height: 38px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--accent);
  flex-shrink: 0;
}
.send-btn:hover:not(:disabled) {
  background: var(--accent-hover);
}
.send-btn:disabled {
  opacity: 0.5;
}
.send-btn .ico {
  width: 15px;
  height: 15px;
  fill: #fff;
}
.ctx-menu {
  position: fixed;
  z-index: 200;
  background: #111214;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 200px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  animation: ctx-in 0.1s ease;
}
.ctx-menu button {
  text-align: left;
  background: transparent;
  border-radius: 4px;
  font-size: 13px;
  padding: 8px 10px;
}
.ctx-menu button:hover {
  background: var(--accent);
  color: #fff;
}
@keyframes ctx-in {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (max-width: 900px) {
  .id-text {
    display: none;
  }
  .chat-head {
    flex-wrap: wrap;
    padding: 8px 10px;
    gap: 6px;
  }
  .chat-list {
    padding: 8px 10px;
  }
  /* На сенсорных экранах нет hover — «⋯» видна всегда. */
  .more-btn {
    visibility: visible;
    opacity: 0.55;
  }
  .msg:hover {
    background: var(--bg3);
  }
  .chat-input {
    padding: 8px 10px;
  }
}
</style>
