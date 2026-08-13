// Тесты markdown-рендера: экранирование (безопасность v-html),
// код-блоки, inline-разметка.
import { describe, expect, it } from 'vitest'
import { escapeHtml, renderInline, splitMarkdown } from './markdown'

describe('markdown', () => {
  it('экранирует HTML', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(escapeHtml('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot;')
  })

  it('выделяет код-блок с языком', () => {
    const segs = splitMarkdown('text ```go\nfmt.Println("hi")\n``` end')
    expect(segs).toHaveLength(3)
    expect(segs[0]).toEqual({ type: 'text', html: 'text ' })
    expect(segs[1]).toEqual({ type: 'code', code: 'fmt.Println("hi")', lang: 'go' })
    expect(segs[2]).toEqual({ type: 'text', html: ' end' })
  })

  it('код-блок без языка', () => {
    const segs = splitMarkdown('```\nplain code\n```')
    expect(segs).toHaveLength(1)
    expect(segs[0]).toEqual({ type: 'code', code: 'plain code', lang: '' })
  })

  it('рендерит inline-форматирование', () => {
    const html = renderInline('**bold** *it* ~~no~~ `code`')
    expect(html).toBe('<strong>bold</strong> <em>it</em> <s>no</s> <code>code</code>')
  })

  it('не форматирует разметку внутри inline-кода', () => {
    const html = renderInline('`**not bold**`')
    expect(html).toBe('<code>**not bold**</code>')
  })

  it('ссылки — только http(s), с target=_blank', () => {
    const html = renderInline('[сайт](https://example.com/a?b=1)')
    expect(html).toBe('<a href="https://example.com/a?b=1" target="_blank" rel="noopener noreferrer">сайт</a>')
    // Не-http ссылка остаётся текстом.
    expect(renderInline('[x](javascript:alert(1))')).toContain('[x](javascript:alert(1))')
  })

  it('переносы строк становятся <br>', () => {
    expect(renderInline('a\nb')).toBe('a<br>b')
  })

  it('опасный текст остаётся экранированным в HTML-сегменте', () => {
    const segs = splitMarkdown('<img src=x onerror=alert(1)>')
    expect(segs[0].html).not.toContain('<img')
    expect(segs[0].html).toContain('&lt;img')
  })
})
