// Просмотр текстового файла: попап на 80% доступного пространства.
// Если файл — код на языке программирования, включается подсветка
// синтаксиса (highlight.js, автоопределение языка).
// Esc / клик по фону — закрыть.
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import hljs from 'highlight.js/lib/common'
import 'highlight.js/styles/github-dark.css'

const props = defineProps<{
  src: string
  filename: string
}>()
const emit = defineEmits<{ (e: 'close'): void }>()

const text = ref('')
const error = ref('')
const loading = ref(true)
const lang = ref('')

onMounted(async () => {
  // Capture-фаза + preventDefault: Esc закрывает только попап, а не
  // вложенный диалог (reka-ui пропускает dismiss при defaultPrevented).
  window.addEventListener('keydown', onKey, true)
  try {
    const res = await fetch(props.src)
    if (!res.ok) throw new Error('Не удалось загрузить файл: ' + res.status)
    text.value = await res.text()
  } catch (e: any) {
    error.value = String(e?.message || e)
  } finally {
    loading.value = false
  }
})
onUnmounted(() => window.removeEventListener('keydown', onKey, true))

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  }
}

const highlighted = computed(() => {
  if (loading.value || error.value || !text.value) return ''
  try {
    const r = hljs.highlightAuto(text.value)
    if (r.language) lang.value = r.language
    return r.value
  } catch {
    return ''
  }
})

const langLabel = computed(() => {
  const name = lang.value || 'Текст'
  return name.charAt(0).toUpperCase() + name.slice(1)
})

async function copy() {
  try {
    await navigator.clipboard.writeText(text.value)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text.value
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="tpop" @click="emit('close')">
      <div class="tpop-box" @click.stop>
        <div class="tpop-head">
          <span class="tpop-name" :title="filename">{{ filename }}</span>
          <span class="tpop-lang">{{ langLabel }}</span>
          <button class="tpop-copy" @click="copy">Скопировать</button>
          <button class="tpop-close" title="Закрыть (Esc)" @click="emit('close')">✕</button>
        </div>
        <div v-if="loading" class="tpop-center muted">Загрузка…</div>
        <div v-else-if="error" class="tpop-center">{{ error }}</div>
        <pre v-else class="tpop-pre"><code class="hljs" v-html="highlighted"></code></pre>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.tpop {
  position: fixed;
  inset: 0;
  z-index: 300;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: default;
  animation: tpop-in 0.18s ease-out;
}
@keyframes tpop-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
/* 80% доступного пространства. */
.tpop-box {
  width: 80vw;
  height: 80vh;
  max-width: 80vw;
  max-height: 80vh;
  background: #161b22;
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 12px 60px rgba(0, 0, 0, 0.7);
}
.tpop-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: rgba(255, 255, 255, 0.05);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}
.tpop-name {
  font-size: 13px;
  font-weight: 600;
  color: #e6edf3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.tpop-lang {
  font-size: 11px;
  font-weight: 600;
  color: #8b949e;
  text-transform: lowercase;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  padding: 2px 10px;
  flex-shrink: 0;
}
.tpop-copy {
  margin-left: auto;
  background: transparent;
  color: #8b949e;
  font-size: 12px;
  font-weight: 600;
  padding: 4px 12px;
  border-radius: 6px;
  flex-shrink: 0;
}
.tpop-copy:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #e6edf3;
}
.tpop-close {
  width: 30px;
  height: 30px;
  padding: 0;
  background: transparent;
  color: #8b949e;
  font-size: 14px;
  border-radius: 50%;
  flex-shrink: 0;
}
.tpop-close:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #e6edf3;
}
.tpop-pre {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 12px 16px;
  overflow: auto;
}
.tpop-pre code {
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.55;
  color: #e6edf3;
  white-space: pre;
  tab-size: 4;
  display: block;
}
.tpop-center {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #8b949e;
  font-size: 14px;
}
.muted {
  color: #8b949e;
}
</style>
