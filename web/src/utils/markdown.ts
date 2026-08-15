// Лёгкий markdown-рендер для сообщений: код-блоки с языком, inline-форматирование
// и блочные элементы (заголовки, списки, чекбоксы, цитаты, таблицы, hr).
// ВАЖНО: весь текст сначала экранируется, поэтому v-html безопасен.
// Поддерживается: ```lang код```, `код`, **жирный**, *курсив*,
// ~~зачёркнутый~~, [ссылка](https://…), # заголовки, - списки,
// - [x] задачи, > цитаты, | таблицы |, --- разделитель.
export interface MarkdownSegment {
  type: 'text' | 'code'
  html?: string // отрендеренный блок/inline-HTML (для text)
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

// Разбивает текст на сегменты: код-блоки и обычный текст с блочной разметкой.
export function splitMarkdown(text: string): MarkdownSegment[] {
  const out: MarkdownSegment[] = []
  let last = 0
  let m: RegExpExecArray | null
  CODE_RE.lastIndex = 0
  while ((m = CODE_RE.exec(text))) {
    if (m.index > last) {
      out.push({ type: 'text', html: renderBlock(text.slice(last, m.index)) })
    }
    // Хвостовой перенос строки перед закрывающими ``` в код не входит.
    out.push({ type: 'code', code: m[2].replace(/\n$/, ''), lang: m[1] || '' })
    last = m.index + m[0].length
  }
  if (last < text.length) {
    out.push({ type: 'text', html: renderBlock(text.slice(last)) })
  }
  if (out.length === 0) out.push({ type: 'text', html: '' })
  return out
}

// Блочная разметка: заголовки, списки, чекбоксы, цитаты, таблицы, hr.
// Каждая строка дополнительно прогоняется через renderInline.
export function renderBlock(src: string): string {
  const lines = src.split('\n')
  let html = ''
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    // Разделитель --- (свободная строка до/после не обязательна).
    if (/^\s*---+$/.test(line) && i + 1 < lines.length) {
      html += '<hr>'
      i++
      continue
    }
    // Заголовок #..####
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      const lvl = h[1].length
      html += `<h${lvl}>${renderInline(h[2])}</h${lvl}>`
      i++
      continue
    }
    // Цитата: строки, начинающиеся с «> ».
    if (/^\s*>\s?/.test(line)) {
      let q = ''
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        q += (q ? '\n' : '') + lines[i].replace(/^\s*>\s?/, '')
        i++
      }
      html += `<blockquote>${renderInline(q)}</blockquote>`
      continue
    }
    // Таблица: строка с | и следующая — разделитель |-...-|.
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) &&
      lines[i + 1].includes('-')
    ) {
      const rows: string[][] = []
      let j = i
      while (j < lines.length && lines[j].includes('|')) {
        rows.push(
          lines[j]
            .trim()
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .split('|')
            .map((c) => c.trim()),
        )
        j++
      }
      const header = rows[0] || []
      const body = rows.slice(2) // rows[1] — разделитель
      let t = '<table><thead><tr>'
      for (const c of header) t += `<th>${renderInline(c)}</th>`
      t += '</tr></thead><tbody>'
      for (const row of body) {
        t += '<tr>'
        for (const c of row) t += `<td>${renderInline(c)}</td>`
        t += '</tr>'
      }
      t += '</tbody></table>'
      html += `<div class="md-table">${t}</div>`
      i = j
      continue
    }
    // Маркированный список (и чекбоксы - [x]).
    const ul = line.match(/^\s*[-*+]\s+(.*)$/)
    if (ul) {
      let items = ''
      while (i < lines.length) {
        const m = lines[i].match(/^\s*[-*+]\s+(.*)$/)
        if (!m) break
        const task = m[1].match(/^\[([ xX])\]\s+(.*)$/)
        items += task
          ? `<li class="task${task[1].toLowerCase() === 'x' ? ' done' : ''}">${renderInline(task[2])}</li>`
          : `<li>${renderInline(m[1])}</li>`
        i++
      }
      html += `<ul>${items}</ul>`
      continue
    }
    // Нумерованный список.
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (ol) {
      let items = ''
      while (i < lines.length) {
        const m = lines[i].match(/^\s*\d+[.)]\s+(.*)$/)
        if (!m) break
        items += `<li>${renderInline(m[1])}</li>`
        i++
      }
      html += `<ol>${items}</ol>`
      continue
    }
    // Пустая строка.
    if (line.trim() === '') {
      i++
      continue
    }
    // Обычный абзац: до пустой строки или начала следующего блока.
    let para = ''
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,4})\s/.test(lines[i]) &&
      !/^\s*[-*+]\s/.test(lines[i]) &&
      !/^\s*\d+[.)]\s/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^\s*---+$/.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-'))
    ) {
      para += (para ? '\n' : '') + lines[i]
      i++
    }
    html += `<p>${renderInline(para)}</p>`
  }
  return html
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
