// E2E: парольный бэкап ключей — «новое устройство без онлайн-держателя».
// Сценарий пользователя: чат создан в веб-клиенте, потом заходим с другого
// устройства (Tauri/переустановка) только с паролем — все старые сессии
// ЗАКРЫТЫ. Ключ должен прийти из парольного бэкапа, а не от держателя.
const { chromium } = require('playwright-core')
const { EXE, BASE, ok, register, finish } = require('./helpers')

async function typeChat(page, text) {
  await page.click('.input-pill textarea')
  await page.keyboard.type(text)
}

async function login(page, nick, pass) {
  await page.goto(BASE, { waitUntil: 'load' })
  await page.getByPlaceholder('Ваш ник').fill(nick)
  await page.getByPlaceholder('Пароль').first().fill(pass)
  await page.getByRole('button', { name: 'Войти' }).click()
  await page.waitForSelector('.sidebar', { timeout: 15000 })
}

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-web-security'] })
  const pageA = await browser.newPage()
  const pageB = await browser.newPage()
  pageA.on('pageerror', (e) => console.log('[pageerror A]', e.message))
  pageB.on('pageerror', (e) => console.log('[pageerror B]', e.message))

  const pass = 'Passw0rd!x123'
  const nickA = 'bkA' + Date.now().toString().slice(-6)
  const nickB = 'bkB' + Date.now().toString().slice(-6)
  await register(pageA, nickA)
  await register(pageB, nickB)

  // A создаёт DM с B и пишет первое сообщение.
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
  await typeChat(pageA, 'до переустановки')
  await pageA.press('.input-pill textarea', 'Enter')
  await pageA.waitForSelector('.msg .text:has-text("до переустановки")', { timeout: 8000, state: 'attached' })
  ok('A создал DM и написал', true)

  // B получает ключ (обёртка от A) — и заодно заливает свой бэкап.
  await pageB.reload({ waitUntil: 'load' })
  await pageB.waitForSelector('.chat-row', { timeout: 10000 })
  await pageB.locator('.chat-row:has(.kind-ico)').first().click()
  await pageB.waitForSelector('.msg .text:has-text("до переустановки")', { timeout: 15000, state: 'attached' })
  ok('B читал первое сообщение (обёртка от A)', true)

  // КЛЮЧЕВОЕ: закрываем ВСЕ сессии — держателей онлайн не осталось.
  await pageA.close()
  await pageB.close()

  // A2 — «новое устройство» (Tauri/переустановка): только пароль.
  const pageA2 = await browser.newPage()
  pageA2.on('pageerror', (e) => console.log('[pageerror A2]', e.message))
  await login(pageA2, nickA, pass)
  await pageA2.locator('.chat-row:has(.kind-ico)').first().click()
  await pageA2.waitForSelector('.msg .text:has-text("до переустановки")', { timeout: 20000, state: 'attached' })
  ok('A2 без онлайн-держателя читает историю (парольный бэкап)', true)
  await typeChat(pageA2, 'после переустановки')
  await pageA2.press('.input-pill textarea', 'Enter')
  await pageA2.waitForSelector('.msg .text:has-text("после переустановки")', { timeout: 8000, state: 'attached' })
  ok('A2 пишет новое сообщение', true)

  // B2 — тоже «новое устройство», все сессии A закрыты.
  const pageB2 = await browser.newPage()
  await login(pageB2, nickB, pass)
  await pageB2.locator('.chat-row:has(.kind-ico)').first().click()
  await pageB2.waitForSelector('.msg .text:has-text("до переустановки")', { timeout: 20000, state: 'attached' })
  ok('B2 без онлайн-держателя читает историю (парольный бэкап)', true)
  await pageB2.waitForSelector('.msg .text:has-text("после переустановки")', { timeout: 15000, state: 'attached' })
  ok('B2 читает новое сообщение A2', true)

  await browser.close()
  finish()
})().catch((e) => { console.error('E2E ERROR:', e); process.exit(1) })
