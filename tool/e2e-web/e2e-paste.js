// E2E: вставка файлов из буфера обмена — область предпросмотра 15% экрана,
// файлы+текст одним сообщением, до 20 файлов в сообщении, текст в последнем.
const { chromium } = require('playwright-core')
const { EXE, BASE, PNG_B64, ok, register, createChannel, finish } = require('./helpers')

async function pasteFiles(page, files) {
  await page.evaluate((filesInit) => {
    const dt = new DataTransfer()
    for (const f of filesInit) {
      let bytes
      if (f.data.startsWith('b64:')) bytes = Uint8Array.from(atob(f.data.slice(4)), (c) => c.charCodeAt(0))
      else bytes = new TextEncoder().encode(f.data)
      dt.items.add(new File([bytes], f.name, { type: f.type }))
    }
    const textarea = document.querySelector('textarea')
    const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'clipboardData', { value: dt })
    textarea.dispatchEvent(ev)
  }, files)
}

;(async () => {
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--no-sandbox', '--disable-web-security'],
  })
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))

  await register(page, 'paste' + Date.now().toString().slice(-6))
  await createChannel(page, 'Буфер')
  console.log('registered, channel created')

  await pasteFiles(page, [])
  ok('пустая вставка не открывает область', (await page.locator('.paste-area').count()) === 0)

  await page.click('textarea')
  await pasteFiles(page, [{ name: 'скрин.png', type: 'image/png', data: 'b64:' + PNG_B64 }])
  await page.waitForSelector('.paste-area', { timeout: 3000 })
  ok('область предпросмотра появилась', (await page.locator('.paste-item').count()) === 1)
  const h = await page.evaluate(() => document.querySelector('.paste-area')?.getBoundingClientRect().height || 0)
  const vh = await page.evaluate(() => innerHeight * 0.15)
  ok('высота области ≈ 15% экрана', Math.abs(h - vh) < 20, `h=${h} 15vh=${vh}`)
  ok('курсор остался в поле ввода', await page.evaluate(() => document.activeElement?.tagName === 'TEXTAREA'))

  await page.fill('textarea', 'вот скриншот')
  await page.press('textarea', 'Enter')
  await page.waitForSelector('.msg.mine .att-img', { timeout: 10000 })
  await page.waitForTimeout(600)
  const single = await page.evaluate(() => {
    const msgs = [...document.querySelectorAll('.msg.mine')]
    const last = msgs[msgs.length - 1]
    return last ? { imgs: last.querySelectorAll('.att-img').length, text: last.querySelector('.text')?.textContent || '' } : null
  })
  ok('картинка и текст в одном сообщении', single && single.imgs === 1 && single.text.includes('вот скриншот'), JSON.stringify(single))
  ok('область очистилась', (await page.locator('.paste-area').count()) === 0)

  const many = []
  for (let i = 1; i <= 25; i++) many.push({ name: `файл${i}.png`, type: 'image/png', data: 'b64:' + PNG_B64 })
  await pasteFiles(page, many)
  await page.waitForSelector('.paste-area', { timeout: 3000 })
  ok('все 25 файлов в области', (await page.locator('.paste-item').count()) === 25)
  ok('подсказка про несколько сообщений', (await page.locator('.paste-over').count()) === 1)
  await page.fill('textarea', '25 файлов одним махом')
  await page.press('textarea', 'Enter')
  await page.waitForFunction(() => document.querySelectorAll('.msg.mine .att').length >= 2, null, { timeout: 20000 })
  await page.waitForTimeout(800)
  const groups = await page.evaluate(() => {
    const msgs = [...document.querySelectorAll('.msg.mine')].filter((m) => m.querySelector('.att'))
    return msgs.slice(-2).map((m) => ({
      atts: m.querySelectorAll('.att-img').length,
      text: m.querySelector('.text')?.textContent || '',
    }))
  })
  ok('первое сообщение: 20 файлов без текста', groups[0] && groups[0].atts === 20 && groups[0].text === '', JSON.stringify(groups[0]))
  ok('второе: 5 файлов + текст', groups[1] && groups[1].atts === 5 && groups[1].text.includes('25 файлов'), JSON.stringify(groups[1]))

  await browser.close()
  finish()
})().catch((e) => { console.error('E2E ERROR:', e); process.exit(1) })
