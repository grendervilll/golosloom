// Код-блок в сообщении: шапка с языком и кнопкой «Скопировать» (как в Telegram).
<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{ lang?: string; code: string }>()

const copied = ref(false)

async function copy() {
  try {
    await navigator.clipboard.writeText(props.code)
  } catch {
    // Фолбэк для старых вебвью (Tauri).
    const ta = document.createElement('textarea')
    ta.value = props.code
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
</script>

<template>
  <div class="code-block">
    <div class="code-head">
      <span class="code-lang">{{ lang || 'Код' }}</span>
      <button class="copy-btn" :class="{ copied }" @click="copy">
        {{ copied ? 'Скопировано ✓' : 'Скопировать' }}
      </button>
    </div>
    <pre><code>{{ code }}</code></pre>
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
}
</style>
