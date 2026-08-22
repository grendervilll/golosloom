// Код-блок в сообщении: подсветка синтаксиса (highlight.js), шапка с языком
// и кнопкой «Скопировать» (как в Telegram). Блок редактируемый локально:
// Tab вставляет отступ вместо перехода по кнопкам.
<script setup lang="ts">
import { computed, ref } from 'vue'
import hljs from 'highlight.js/lib/common'
import 'highlight.js/styles/github-dark.css'

const props = defineProps<{ lang?: string; code: string }>()

const codeEl = ref<HTMLElement | null>(null)
const copied = ref(false)

// Подсветка: по указанному языку, при ошибке/отсутствии — автоопределение.
const highlighted = computed(() => {
  if (props.lang) {
    try {
      if (hljs.getLanguage(props.lang)) {
        return hljs.highlight(props.code, { language: props.lang }).value
      }
    } catch {
      /* автоопределение ниже */
    }
  }
  try {
    return hljs.highlightAuto(props.code).value
  } catch {
    return ''
  }
})

// Копируем то, что пользователь видит (с учётом локальных правок).
async function copy() {
  const text = codeEl.value?.textContent ?? props.code
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Фолбэк для окружений без Clipboard API.
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

// Tab вставляет отступ вместо перехода к следующей кнопке.
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Tab') {
    e.preventDefault()
    document.execCommand('insertText', false, '\t')
  }
}
</script>

<template>
  <div class="code-block">
    <div class="code-head">
      <span class="code-lang">{{ lang || 'Код' }}</span>
      <button class="copy-btn" :class="{ copied }" @click="copy">
        {{ copied ? 'Скопировано ✓' : 'Скопировать' }}
      </button>
    </div>
    <pre><code
      ref="codeEl"
      class="hljs"
      contenteditable="true"
      spellcheck="false"
      @keydown="onKeydown"
      v-html="highlighted"
    ></code></pre>
  </div>
</template>

<style scoped>
/* Тёмный блок кода в обеих темах (как в Telegram). */
.code-block {
  background: #161b22;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  overflow: hidden;
  margin: 4px 0;
}
.code-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 12px;
  background: rgba(255, 255, 255, 0.05);
}
.code-lang {
  font-size: 11px;
  font-weight: 600;
  color: #8b949e;
  text-transform: lowercase;
}
.copy-btn {
  background: transparent;
  color: #8b949e;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 6px;
  min-height: 24px;
}
.copy-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #e6edf3;
}
.copy-btn.copied {
  color: #3fb950;
}
pre {
  margin: 0;
  padding: 10px 12px;
  overflow-x: auto;
}
pre code {
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.5;
  color: #e6edf3;
  white-space: pre;
  tab-size: 4;
  display: block;
}
/* Редактирование локально: не подсвечиваем фокус как кнопку. */
pre code:focus {
  outline: none;
}
</style>
