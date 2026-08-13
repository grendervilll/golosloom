// Лёгкий markdown-рендер для сообщений: код-блоки с языком, inline-форматирование.
// ВАЖНО: весь текст сначала экранируется, поэтому v-html безопасен.
// Поддерживается: ```lang код```, `код`, **жирный**, *курсив*,
// ~~зачёркнутый~~, [ссылка](https://…).
export interface MarkdownSegment {
  type: 'text' | 'code'
  html?: string // отрендеренный inline-HTML (для text)
  lang?: string
  code?: string
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const CODE_RE = /```([\w+.#-]*)\n?([\s\S]*?)```/g
// Защитный маркер для inline-кода (невидимые символы не встречаются в тексте).
const SENTINEL = '\u0000CODE\u0000'

// Разбивает текст на сегменты: код-блоки и обычный текст с inline-разметкой.
export function splitMarkdown(text: string): MarkdownSegment[] {
  const out: MarkdownSegment[] = []
  let last = 0
  let m: RegExpExecArray | null
  CODE_RE.lastIndex = 0
  while ((m = CODE_RE.exec(text))) {
    if (m.index > last) {
      out.push({ type: 'text', html: renderInline(text.slice(last, m.index)) })
    }
    // Хвостовой перенос строки перед закрывающими ``` в код не входит.
    out.push({ type: 'code', code: m[2].replace(/\n$/, ''), lang: m[1] || '' })
    last = m.index + m[0].length
  }
  if (last < text.length) {
    out.push({ type: 'text', html: renderInline(text.slice(last)) })
  }
  if (out.length === 0) out.push({ type: 'text', html: '' })
  return out
}

// Inline-разметка одной строки текста (уже без код-блоков).
export function renderInline(src: string): string {
  const esc = escapeHtml(src)
  // Inline-код прячем в маркеры, чтобы разметка внутри него не форматировалась.
  const codeSpans: string[] = []
  const withoutCode = esc.replace(/`([^`\n]+)`/g, (m, c) => {
    codeSpans.push(c)
    return SENTINEL + String(codeSpans.length - 1) + SENTINEL
  })
  const html = withoutCode
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\n/g, '<br>')
  return html.replace(new RegExp(SENTINEL + '(\\d+)' + SENTINEL, 'g'), (_m, i) => `<code>${codeSpans[Number(i)]}</code>`)
}
