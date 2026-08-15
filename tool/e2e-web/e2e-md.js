// E2E: markdown в сообщениях — заголовки, списки, чекбоксы, цитаты, таблицы,
// код-блоки; рендер виден и собеседнику.
const { chromium } = require('playwright-core')
const { EXE, BASE, ok, register, createChannel, finish } = require('./helpers')

const MD = '# Заголовок\n\n- пункт один\n- [x] сделано\n- [ ] осталось\n\n> цитата\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```go\nfmt.Println("hi")\n```'

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-web-security'] })
  const pageA = await browser.newPage()
  const pageB = await browser.newPage()
  pageA.on('pageerror', (e) => console.log('[pageerror A]', e.message))

  await register(pageA, 'mdA' + Date.now().toString().slice(-6))
  await createChannel(pageA, 'MD')
  await register(pageB, 'mdB' + Date.now().toString().slice(-6))
  console.log('registered')

  // A отправляет markdown-сообщение.
  await pageA.fill('.input-pill textarea', MD)
  await pageA.press('.input-pill textarea', 'Enter')
  await pageA.waitForSelector('.text h1:has-text("Заголовок")', { timeout: 8000, state: 'attached' })

  const html = await pageA.evaluate(() => document.querySelector('.msg:last-of-type')?.innerHTML || '')
  ok('заголовок h1', html.includes('<h1>Заголовок</h1>'))
  ok('маркированный список', html.includes('<ul>') && html.includes('<li>пункт один</li>'))
  ok('чекбокс выполненный', html.includes('task done') && html.includes('сделано'))
  ok('чекбокс невыполненный', html.includes('class="task"') && html.includes('осталось'))
  ok('цитата', html.includes('<blockquote>цитата</blockquote>'))
  ok('таблица', html.includes('<table>') && html.includes('<th>A</th>') && html.includes('<td>1</td>'))
  ok('код-блок с языком', html.includes('hljs') || html.includes('<pre><code'))
  ok('безопасность: нет сырого HTML из текста', !html.includes('<img'))

  // B (другой пользователь) видит то же форматирование.
  await pageB.reload({ waitUntil: 'load' })
  await pageB.waitForSelector('.chat-row', { timeout: 10000 })
  await pageB.locator('.chat-row', { hasText: 'MD' }).first().click()
  await pageB.waitForSelector('.text h1:has-text("Заголовок")', { timeout: 8000, state: 'attached' })
  const htmlB = await pageB.evaluate(() => document.querySelector('.msg:last-of-type')?.innerHTML || '')
  ok('у собеседника тоже h1', htmlB.includes('<h1>Заголовок</h1>'))
  ok('у собеседника таблица', htmlB.includes('<table>'))

  await browser.close()
  finish()
})().catch((e) => { console.error('E2E ERROR:', e); process.exit(1) })
