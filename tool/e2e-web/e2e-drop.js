// E2E: drag and drop файлов работает как вставка из буфера (область
// предпросмотра, отправка с текстом одним сообщением).
const { chromium } = require('playwright-core')
const { EXE, BASE, PNG_B64, ok, register, createChannel, finish } = require('./helpers')

async function dragFiles(page, files) {
  const dt = await page.evaluateHandle((filesInit) => {
    const dt = new DataTransfer()
    for (const f of filesInit) {
      let bytes
      if (f.dataBytes) bytes = new Uint8Array(f.dataBytes)
      else if (f.data.startsWith('b64:')) bytes = Uint8Array.from(atob(f.data.slice(4)), (c) => c.charCodeAt(0))
      else bytes = new TextEncoder().encode(f.data)
      dt.items.add(new File([bytes], f.name, { type: f.type }))
    }
    return dt
  }, files)
  await page.dispatchEvent('.chat-panel', 'dragenter', { dataTransfer: dt })
  await page.dispatchEvent('.chat-panel', 'dragover', { dataTransfer: dt })
  await page.dispatchEvent('.chat-panel', 'drop', { dataTransfer: dt })
}

;(async () => {
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--no-sandbox', '--disable-web-security'],
  })
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))

  await register(page, 'drop' + Date.now().toString().slice(-6))
  await createChannel(page, 'Дроп')
  console.log('registered, channel created')

  const dt = await page.evaluateHandle(() => {
    const dt = new DataTransfer()
    dt.items.add(new File(['hello'], 'a.txt', { type: 'text/plain' }))
    return dt
  })
  await page.dispatchEvent('.chat-panel', 'dragenter', { dataTransfer: dt })
  await page.waitForSelector('.drop-hint', { timeout: 2000 })
  ok('оверлей при перетаскивании', true)

  await dragFiles(page, [{ name: 'заметки.txt', type: 'text/plain', data: 'привет' }])
  await page.waitForSelector('.paste-area', { timeout: 3000 })
  ok('дроп показывает область предпросмотра', (await page.locator('.paste-item').count()) === 1)
  await page.press('textarea', 'Enter')
  await page.waitForSelector('.file-card .file-name:has-text("заметки.txt")', { timeout: 10000 })
  ok('файл без текста отправляется как обычно', true)
  ok('область очистилась', (await page.locator('.paste-area').count()) === 0)

  await dragFiles(page, [{ name: 'пикча.png', type: 'image/png', data: 'b64:' + PNG_B64 }])
  await page.waitForSelector('.paste-area', { timeout: 3000 })
  await page.fill('textarea', 'вот картинка')
  await page.press('textarea', 'Enter')
  await page.waitForSelector('.msg.mine .att-img', { timeout: 10000 })
  await page.waitForTimeout(500)
  const single = await page.evaluate(() => {
    const msgs = [...document.querySelectorAll('.msg.mine')]
    const last = msgs[msgs.length - 1]
    return last ? { imgs: last.querySelectorAll('.att-img').length, text: last.querySelector('.text')?.textContent || '' } : null
  })
  ok('дроп+текст в одном сообщении', single && single.imgs === 1 && single.text.includes('вот картинка'), JSON.stringify(single))

  await dragFiles(page, [
    { name: 'multi1.txt', type: 'text/plain', data: 'one' },
    { name: 'multi2.txt', type: 'text/plain', data: 'two' },
  ])
  await page.waitForSelector('.paste-area', { timeout: 3000 })
  await page.press('textarea', 'Enter')
  await page.waitForSelector('.att.multi', { timeout: 10000 })
  const multi = await page.evaluate(() => document.querySelector('.att.multi')?.querySelectorAll('.file-card').length || 0)
  ok('два файла одним сообщением', multi === 2, 'cards=' + multi)

  await dragFiles(page, [{ name: 'big.bin', type: 'application/octet-stream', dataBytes: 101 * 1024 * 1024 }])
  await page.waitForTimeout(1500)
  await page.press('textarea', 'Enter')
  await page.waitForTimeout(1200)
  const bigMsg = await page.evaluate(() =>
    [...document.querySelectorAll('.file-card .file-name')].some((e) => e.textContent.includes('big.bin')),
  )
  ok('файл >100 МБ не отправляется', !bigMsg)

  await browser.close()
  finish()
})().catch((e) => { console.error('E2E ERROR:', e); process.exit(1) })
