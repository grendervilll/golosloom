// E2E: черновики сообщений по чатам — текст остаётся в своём канале,
// индикатор «✏️» в списке чатов, восстановление при возврате,
// очистка после отправки, персист через перезагрузку.
const { chromium } = require('playwright-core')
const { EXE, BASE, ok, register, createChannel, finish } = require('./helpers')

async function typeChat(page, text) {
  await page.click('.input-pill textarea')
  await page.keyboard.type(text)
}

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-web-security'] })
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))

  await register(page, 'drf' + Date.now().toString().slice(-6))
  await createChannel(page, 'Первый')
  await createChannel(page, 'Второй')
  console.log('registered, two channels')

  const rowByName = (name) => page.locator('.chat-row', { hasText: name }).first()

  // Пишем черновик в «Первом», не отправляя.
  await rowByName('Первый').click()
  await page.waitForSelector('.input-pill textarea', { timeout: 8000 })
  await typeChat(page, 'черновик первого канала')
  ok('черновик набран', (await page.inputValue('.input-pill textarea')) === 'черновик первого канала')

  // Переходим во «Второй» — там пусто.
  await rowByName('Второй').click()
  await page.waitForTimeout(600)
  const secondVal = await page.inputValue('.input-pill textarea')
  ok('в другом чате черновика нет', secondVal === '')

  // В списке чатов под «Первым» — индикатор черновика.
  const draftRow = page.locator('.chat-row', { hasText: 'Первый' }).first()
  const draftText = await draftRow.locator('.draft-preview').textContent().catch(() => null)
  ok('в списке под названием чата виден черновик', !!draftText && draftText.includes('черновик первого канала'), draftText)

  // Возвращаемся в «Первый» — текст на месте.
  await rowByName('Первый').click()
  await page.waitForTimeout(600)
  ok('при возврате черновик восстановлен', (await page.inputValue('.input-pill textarea')) === 'черновик первого канала')

  // Перезагрузка: черновик переживает (localStorage).
  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('.chat-row', { timeout: 10000 })
  await rowByName('Первый').click()
  await page.waitForTimeout(600)
  ok('черновик сохранился после перезагрузки', (await page.inputValue('.input-pill textarea')) === 'черновик первого канала')

  // Отправляем — черновик очищается и индикатор пропадает.
  await page.press('.input-pill textarea', 'Enter')
  await page.waitForSelector('.msg .text:has-text("черновик первого канала")', { timeout: 8000, state: 'attached' })
  await page.waitForTimeout(500)
  const draftGone = await page.locator('.chat-row .draft-preview').count()
  ok('после отправки черновик очищен (индикатора нет)', draftGone === 0)
  ok('после отправки поле пустое', (await page.inputValue('.input-pill textarea')) === '')

  await browser.close()
  finish()
})().catch((e) => { console.error('E2E ERROR:', e); process.exit(1) })
