// E2E: кнопка спуска к последним сообщениям (40px, hover +40px) и
// разделители дат в чате («Сегодня» — один раз).
const { chromium } = require('playwright-core')
const { EXE, BASE, ok, register, createChannel, finish } = require('./helpers')

;(async () => {
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--no-sandbox', '--disable-web-security'],
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 600 } })
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))

  await register(page, 'scr' + Date.now().toString().slice(-6))
  await createChannel(page, 'Скролл')
  console.log('registered')

  // Много сообщений, чтобы список прокручивался.
  for (let i = 1; i <= 40; i++) {
    await page.click('.input-pill textarea')
    await page.keyboard.type('сообщение номер ' + i)
    await page.press('.input-pill textarea', 'Enter')
    // Лимит сервера 10 сообщений/сек — пауза, чтобы не упереться в него.
    await page.waitForTimeout(200)
    await page.waitForSelector(`.msg .text:has-text("сообщение номер ${i}")`, { timeout: 8000, state: 'attached' })
  }

  // Разделитель даты: «Сегодня» ровно один.
  const chips = await page.locator('.date-chip').allTextContents()
  ok('разделитель даты «Сегодня» один', chips.length === 1 && chips[0].includes('Сегодня'), chips.join(' | '))

  // Кнопка «вниз»: у нижнего края её нет.
  ok('внизу кнопка скрыта', (await page.locator('.scroll-down').count()) === 0)

  // Прокручиваем вверх — кнопка появляется.
  await page.evaluate(() => {
    const el = document.querySelector('.chat-panel .chat-list')
    el.scrollTop = el.scrollHeight / 4
    el.dispatchEvent(new Event('scroll'))
  })
  await page.waitForSelector('.scroll-down', { timeout: 3000 })
  const base = await page.locator('.scroll-down').boundingBox()
  ok('кнопка появилась при скролле вверх', base && Math.round(base.width) === 40, JSON.stringify(base))

  // Наведение: плавное расширение на 40px (40 → 80).
  await page.hover('.scroll-down')
  await page.waitForTimeout(400)
  const hover = await page.locator('.scroll-down').boundingBox()
  ok('при наведении расширяется на 40px (до 80)', hover && Math.round(hover.width) === 80 && Math.round(hover.height) === 80, JSON.stringify(hover))

  // Уход мыши: сжимается обратно.
  await page.mouse.move(5, 5)
  await page.waitForTimeout(400)
  const out = await page.locator('.scroll-down').boundingBox()
  ok('после ухода сжимается обратно до 40', out && Math.round(out.width) === 40, JSON.stringify(out))

  // Кнопка не перекрывает поле ввода (учёт расширения до 13 строк).
  await page.evaluate(() => {
    const el = document.querySelector('.chat-panel .chat-list')
    el.scrollTop = el.scrollHeight / 4
    el.dispatchEvent(new Event('scroll'))
  })
  await page.waitForSelector('.scroll-down', { timeout: 3000 })
  const overlap = await page.evaluate(() => {
    const btn = document.querySelector('.scroll-down').getBoundingClientRect()
    const input = document.querySelector('.chat-input').getBoundingClientRect()
    return { btnBottom: btn.bottom, inputTop: input.top, overlap: btn.bottom > input.top }
  })
  ok('кнопка не наезжает на поле ввода', !overlap.overlap, JSON.stringify(overlap))

  // Клик — прокрутка к последним сообщениям, кнопка скрывается.
  await page.click('.scroll-down')
  await page.waitForTimeout(900)
  const nearBottom = await page.evaluate(() => {
    const el = document.querySelector('.chat-panel .chat-list')
    return el.scrollHeight - el.scrollTop - el.clientHeight < 50
  })
  ok('клик прокручивает к последним сообщениям', nearBottom)
  ok('после прокрутки кнопка скрыта', (await page.locator('.scroll-down').count()) === 0)

  await browser.close()
  finish()
})().catch((e) => { console.error('E2E ERROR:', e); process.exit(1) })
