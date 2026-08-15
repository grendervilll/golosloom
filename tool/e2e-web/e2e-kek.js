// E2E: вход по токену без пароля (Tauri/веб с сохранённой сессией) —
// KEK отсутствует → появляется окно «Разблокировать личные сообщения»;
// после ввода пароля личные сообщения расшифровываются.
const { chromium } = require('playwright-core')
const { EXE, BASE, ok, register, finish } = require('./helpers')

const PASS = 'Passw0rd!x123'

async function login(page, nick) {
  await page.goto(BASE, { waitUntil: 'load' })
  await page.getByPlaceholder('Ваш ник').fill(nick)
  await page.getByPlaceholder('Пароль').first().fill(PASS)
  await page.getByRole('button', { name: 'Войти' }).click()
  await page.waitForSelector('.sidebar', { timeout: 15000 })
}

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-web-security'] })
  const pageA = await browser.newPage()
  const pageB = await browser.newPage()
  pageA.on('pageerror', (e) => console.log('[pageerror A]', e.message))

  const nickA = 'kkA' + Date.now().toString().slice(-6)
  const nickB = 'kkB' + Date.now().toString().slice(-6)
  await register(pageA, nickA)
  await register(pageB, nickB)

  // A создаёт DM и пишет; B отвечает. Бэкапы заливаются автоматически.
  await pageA.click('.burger', { force: true })
  await pageA.getByText('Найти контакт').first().click()
  await pageA.waitForSelector('.search-input', { timeout: 3000 })
  await pageA.fill('.search-input', nickB)
  await pageA.waitForTimeout(1000)
  await pageA.locator('.search-row', { hasText: nickB }).first().click()
  await pageA.waitForFunction(
    (n) => document.querySelector('.chat-head h2')?.textContent.toLowerCase().includes('и ' + n.toLowerCase()),
    nickB,
    { timeout: 10000 },
  )
  await pageA.click('.input-pill textarea')
  await pageA.keyboard.type('секрет для бэкапа')
  await pageA.press('.input-pill textarea', 'Enter')
  await pageA.waitForSelector('.msg .text:has-text("секрет для бэкапа")', { timeout: 8000, state: 'attached' })
  ok('A создал DM и написал', true)

  // «Сессия без пароля»: новый контекст с токеном, но без KEK (как Tauri
  // после переустановки с сохранённой сессией).
  const ctx2 = await browser.newContext()
  await ctx2.addInitScript(([token]) => {
    localStorage.setItem('golosloom-token', token)
  }, [await pageA.evaluate(() => localStorage.getItem('golosloom-token'))])
  const pageA2 = await ctx2.newPage()
  pageA2.on('pageerror', (e) => console.log('[pageerror A2]', e.message))
  await pageA2.goto(BASE, { waitUntil: 'load' })
  await pageA2.waitForSelector('.sidebar', { timeout: 15000 })
  ok('A2 вошёл по токену без пароля', true)

  // Окно разблокировки появляется, потому что KEK нет.
  await pageA2.waitForSelector('text=Разблокировать личные сообщения', { timeout: 15000 })
  ok('появилось окно «Разблокировать личные сообщения»', true)

  // Ввод пароля → DM расшифровывается.
  await pageA2.fill('input[type="password"]', PASS)
  await pageA2.getByRole('button', { name: 'Разблокировать' }).click()
  await pageA2.waitForSelector('.chat-row:has(.kind-ico)', { timeout: 10000 })
  await pageA2.locator('.chat-row:has(.kind-ico)').first().click()
  await pageA2.waitForSelector('.msg .text:has-text("секрет для бэкапа")', { timeout: 15000, state: 'attached' })
  ok('после ввода пароля история DM расшифрована', true)

  // Повторная перезагрузка: KEK сохранён — окно больше не нужно.
  await pageA2.reload({ waitUntil: 'load' })
  await pageA2.waitForSelector('.sidebar', { timeout: 15000 })
  await pageA2.waitForTimeout(4000)
  const modalCount = await pageA2.locator('text=Разблокировать личные сообщения').count()
  ok('после перезагрузки окно не появляется (KEK сохранён)', modalCount === 0)
  await pageA2.locator('.chat-row:has(.kind-ico)').first().click()
  await pageA2.waitForSelector('.msg .text:has-text("секрет для бэкапа")', { timeout: 15000, state: 'attached' })
  ok('DM читается после перезагрузки без пароля', true)

  await browser.close()
  finish()
})().catch((e) => { console.error('E2E ERROR:', e); process.exit(1) })
