// Админ-панель «Файлы» в отдельном попапе: категории, превью, выбор файлов
// (кнопка «Выбрать» → «Выбрать всё»), удаление выбранного, ПКМ-меню.
// Попап крупный, ПКМ-меню телепортируется в body — не улетает за экран.
<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { toast } from 'vue-sonner'
import { isTextFile } from '../utils/textFile'
import TextPreview from './TextPreview.vue'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import type { AdminFile } from '../api/types'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'jump-message', payload: { channelId: number; messageId: number }): void
}>()

const settings = useSettingsStore()
const files = ref<AdminFile[]>([])
const fileCat = ref<'all' | 'photo' | 'video' | 'text'>('all')
const filesMenu = ref<{ x: number; y: number; file: AdminFile } | null>(null)
const filesMenuEl = ref<HTMLElement | null>(null)
const previewFile = ref<AdminFile | null>(null)

// --- Выбор файлов ---
const selecting = ref(false)
const selected = ref<Set<number>>(new Set())

const filteredFiles = computed(() => {
  const cat = fileCat.value
  if (cat === 'all') return files.value
  return files.value.filter((f) => catOf(f) === cat)
})

function catOf(f: AdminFile): 'photo' | 'video' | 'text' {
  if (f.mime.startsWith('image/')) return 'photo'
  if (f.mime.startsWith('video/')) return 'video'
  return 'text'
}

onMounted(loadFiles)

async function loadFiles() {
  try {
    files.value = await settings.api.adminListFiles()
  } catch (e: any) {
    toast.error('Не удалось загрузить список файлов: ' + String(e?.message || e).slice(0, 120))
  }
}

// «Выбрать»: включает режим выбора и превращается в «Выбрать всё».
function toggleSelecting() {
  selecting.value = !selecting.value
  selected.value = new Set()
}

// «Выбрать всё»: выделяет все файлы открытой категории.
function selectAllVisible() {
  selected.value = new Set(filteredFiles.value.map((f) => f.id))
}

function toggleFile(f: AdminFile) {
  const s = new Set(selected.value)
  if (s.has(f.id)) s.delete(f.id)
  else s.add(f.id)
  selected.value = s
}

function onCatChange(cat: 'all' | 'photo' | 'video' | 'text') {
  fileCat.value = cat
  selected.value = new Set()
}

// --- Удаление ---
const deleting = ref(false)

async function deleteSelected() {
  const ids = [...selected.value]
  if (ids.length === 0 || deleting.value) return
  const label = ids.length === 1 ? 'файл' : `файлы (${ids.length})`
  if (!confirm(`Удалить выбранные ${label} с сервера? Файлы будут стёрты с диска, сообщения останутся.`)) return
  deleting.value = true
  try {
    for (const id of ids) {
      await settings.api.adminDeleteFile(id)
    }
    toast.info(`Удалено: ${ids.length}`)
    files.value = files.value.filter((f) => !selected.value.has(f.id))
    selected.value = new Set()
  } catch (e: any) {
    toast.error('Не удалось удалить файлы: ' + String(e?.message || e).slice(0, 120))
  } finally {
    deleting.value = false
  }
}

async function deleteSingle(f: AdminFile) {
  filesMenu.value = null
  if (!confirm(`Удалить файл «${f.filename}» с сервера? Сообщение останется.`)) return
  try {
    await settings.api.adminDeleteFile(f.id)
    toast.info(`Файл «${f.filename}» удалён`)
    files.value = files.value.filter((x) => x.id !== f.id)
  } catch (e: any) {
    toast.error('Не удалось удалить файл: ' + String(e?.message || e).slice(0, 120))
  }
}

// --- ПКМ-меню ---
function openFilesMenu(e: MouseEvent, f: AdminFile) {
  e.preventDefault()
  filesMenu.value = { x: e.clientX, y: e.clientY, file: f }
  void nextTick(() => {
    const el = filesMenuEl.value
    if (!el) return
    const r = el.getBoundingClientRect()
    const pad = 8
    filesMenu.value = {
      ...filesMenu.value!,
      x: Math.max(pad, Math.min(filesMenu.value!.x, window.innerWidth - r.width - pad)),
      y: Math.max(pad, Math.min(filesMenu.value!.y, window.innerHeight - r.height - pad)),
    }
  })
}

function jumpToMessage(f: AdminFile) {
  filesMenu.value = null
  emit('jump-message', { channelId: f.channel_id, messageId: f.message_id })
}

function canPreview(f: AdminFile): boolean {
  return isTextFile(f.mime, f.filename)
}

function openPreview(f: AdminFile) {
  filesMenu.value = null
  previewFile.value = f
}

function fileUrl(id: number): string {
  return settings.api.fileUrl(id)
}

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' МБ'
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' КБ'
  return bytes + ' Б'
}

function fileIcon(f: AdminFile): string {
  if (f.mime.startsWith('image/')) return '🖼'
  if (f.mime.startsWith('video/')) return '🎬'
  if (isTextFile(f.mime, f.filename)) return '📄'
  return '📎'
}

const deleteLabel = computed(() => (selected.value.size > 1 ? 'Удалить выбранное' : 'Удалить'))
</script>

<template>
  <Dialog :open="true" @update:open="(o) => { if (!o) emit('close') }">
    <DialogContent class="max-h-[88vh] max-w-[95vw] overflow-hidden flex flex-col !p-0">
      <DialogHeader class="text-center flex-shrink-0">
        <DialogTitle class="text-center">Файлы сервера</DialogTitle>
      </DialogHeader>

      <div class="files-toolbar">
        <div class="file-cats">
          <button :class="{ active: fileCat === 'all' }" @click="onCatChange('all')">Все</button>
          <button :class="{ active: fileCat === 'photo' }" @click="onCatChange('photo')">Фото</button>
          <button :class="{ active: fileCat === 'video' }" @click="onCatChange('video')">Видео</button>
          <button :class="{ active: fileCat === 'text' }" @click="onCatChange('text')">Текстовые</button>
        </div>
        <button class="select-btn" :class="{ active: selecting }" @click="selecting ? selectAllVisible() : toggleSelecting()">
          {{ selecting ? 'Выбрать всё' : 'Выбрать' }}
        </button>
      </div>

      <!-- Список файлов: в режиме выбора клик выделяет файл. -->
      <div class="files-body" @click="filesMenu = null">
        <p v-if="filteredFiles.length === 0" class="muted center">Файлов нет</p>
        <div
          v-for="f in filteredFiles"
          :key="f.id"
          class="file-tile"
          :class="{ sel: selected.has(f.id), selectable: selecting }"
          :title="f.filename"
          :data-file-id="f.id"
          @click="selecting && toggleFile(f)"
          @contextmenu.prevent="selecting ? toggleFile(f) : openFilesMenu($event, f)"
        >
          <div class="file-preview">
            <img
              v-if="f.mime.startsWith('image/')"
              class="file-thumb"
              :src="fileUrl(f.id)"
              loading="lazy"
              alt=""
            />
            <video
              v-else-if="f.mime.startsWith('video/')"
              class="file-thumb"
              :src="fileUrl(f.id)"
              muted
              preload="metadata"
            ></video>
            <span v-else class="file-ico">{{ fileIcon(f) }}</span>
            <span v-if="selected.has(f.id)" class="file-check">✓</span>
          </div>
          <span class="file-name" :title="f.filename">{{ f.filename }}</span>
          <span class="file-meta">{{ fmtSize(f.size) }}</span>
          <span class="file-meta">{{ f.channel_name ? '#' + f.channel_name : 'канал удалён' }} · {{ f.sender_nick }}</span>
        </div>
      </div>

      <!-- Нижняя панель: красная кнопка удаления выбранного. -->
      <div class="files-footer">
        <button
          class="del-btn"
          :disabled="selected.size === 0 || deleting"
          @click="deleteSelected"
        >
          {{ deleting ? 'Удаление…' : deleteLabel }}
        </button>
      </div>

      <DialogFooter class="grid-cols-1 flex-shrink-0">
        <Button variant="secondary" @click="emit('close')">Закрыть</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <!-- ПКМ-меню: в body, чтобы не ломаться о transform диалога.
       pointerdown.stop — иначе reka-ui закроет диалог раньше клика. -->
  <Teleport to="body">
    <div
      v-if="filesMenu"
      ref="filesMenuEl"
      class="files-ctx"
      :style="{ left: filesMenu.x + 'px', top: filesMenu.y + 'px' }"
      @pointerdown.stop
      @click.stop
    >
      <button @click="jumpToMessage(filesMenu.file)">Перейти к сообщению</button>
      <button v-if="canPreview(filesMenu.file)" @click="openPreview(filesMenu.file)">Показать</button>
      <button class="danger" @click="deleteSingle(filesMenu.file)">Удалить</button>
    </div>
  </Teleport>

  <TextPreview
    v-if="previewFile"
    :src="fileUrl(previewFile.id)"
    :filename="previewFile.filename"
    @close="previewFile = null"
  />
</template>

<style scoped>
.files-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px 10px;
  flex-shrink: 0;
}
.file-cats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  flex: 1;
}
.file-cats button {
  border-radius: 6px;
  font-weight: 600;
  font-size: 13px;
}
.file-cats .active {
  background: var(--accent);
  color: #fff;
}
.select-btn {
  border-radius: 6px;
  font-weight: 600;
  font-size: 13px;
  padding: 8px 14px;
  background: var(--bg3);
  flex-shrink: 0;
}
.select-btn:hover {
  background: var(--bg4);
}
.select-btn.active {
  background: var(--accent);
  color: #fff;
}
.files-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: 8px;
  padding: 0 16px 10px;
  align-content: start;
}
.center {
  grid-column: 1 / -1;
  text-align: center;
  padding: 16px;
}
.file-tile {
  display: flex;
  flex-direction: column;
  gap: 3px;
  border-radius: 10px;
  padding: 6px;
  background: var(--bg3);
  cursor: context-menu;
  min-width: 0;
}
.file-tile:hover {
  background: var(--bg4);
}
.file-tile.selectable {
  cursor: pointer;
}
.file-tile.sel {
  outline: 2px solid var(--accent);
  background: rgba(42, 171, 238, 0.15);
}
.file-preview {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
}
.file-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.file-ico {
  font-size: 28px;
}
.file-check {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.file-name {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-meta {
  font-size: 10.5px;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.files-footer {
  display: flex;
  justify-content: center;
  padding: 0 16px 10px;
  flex-shrink: 0;
}
.del-btn {
  background: var(--red);
  color: #fff;
  font-weight: 700;
  font-size: 13px;
  border-radius: 8px;
  padding: 9px 22px;
}
.del-btn:hover:not(:disabled) {
  background: #a12829;
}
.del-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.files-ctx {
  position: fixed;
  /* reka-ui при открытом модальном диалоге ставит body { pointer-events: none }
     — телепортированное меню наследует это и не кликается. Возвращаем явно. */
  pointer-events: auto;
  z-index: 400;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 210px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
}
.files-ctx button {
  text-align: left;
  background: transparent;
  border-radius: 6px;
  font-size: 13px;
  padding: 8px 10px;
}
.files-ctx button:hover {
  background: var(--bg3);
}
.files-ctx button.danger {
  color: var(--red);
}
</style>
