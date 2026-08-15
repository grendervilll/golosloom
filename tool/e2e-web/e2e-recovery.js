// E2E: восстановление потерянного ключа личного чата.
// Сценарий «новое устройство/переустановка»: A заходит с чистого контекста
// (без локального хранилища) — это новое устройство без ключей. A — создатель
// DM → ключ пересоздаётся автоматически, A может писать, B (онлайн) получает
// новый ключ через key.reset + обмен и читает новое сообщение.
const { chromium } = require('playwright-core')
const { EXE, BASE, ok, register, createChannel, finish } = require('./helpers')

async function typeChat(page, text) {
  await page.click('.input-pill textarea')
  await page.keyboard.type(text)
}

async function login(page, nick, pass) {
  await page.goto(BASE, { waitUntil: 'load' })
  await page.getByPlaceholder('Ваш ник').fill(nick)
  await page.getByPlaceholder('Пароль').first().fill(pass)
  await page.getByRole('button', { name: 'Войти' }).click()
  await page.waitForSelector('.sidebar', { timeout: 10000 })
}

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-web-security'] })
  const pageA = await browser.newPage()
  const pageB = await browser.newPage()
  pageA.on('pageerror', (e) => console.log('[pageerror A]', e.message))
  pageB.on('pageerror', (e) => console.log('[pageerror B]', e.message))

  const pass = 'Passw0rd!x123'
  const nickA = 'recA' + Date.now().toString().slice(-6)
  const nickB = 'recB' + Date.now().toString().slice(-6)
  await register(pageA, nickA)
  await createChannel(pageA, 'Общий')
  await register(pageB, nickB)

  // A создаёт DM и пишет первое сообщение.
  await pageA.click('.burger', { force: true })
  await pageA.getByText('Найти контакт').first().click()
  await pageA.waitForSelector('.search-input', { timeout: 3000 })
  await pageA.fill('.search-input', 'recB')
  await pageA.waitForTimeout(1000)
  await pageA.locator('.search-row', { hasText: 'recB' }).first().click()
  await pageA.waitForFunction(() => document.querySelector('.chat-head h2')?.textContent.toLowerCase().includes('и recb'), null, { timeout: 10000 })
  await pageA.waitForSelector('.muted.empty', { timeout: 8000 })
  await typeChat(pageA, 'до потери ключа')
  await pageA.press('.input-pill textarea', 'Enter')
  await pageA.waitForSelector('.msg .text:has-text("до потери ключа")', { timeout: 8000, state: 'attached' })
  ok('до потери ключа A писал', true)

  // B читает первое сообщение.
  await pageB.reload({ waitUntil: 'load' })
  await pageB.waitForSelector('.chat-row', { timeout: 10000 })
  await pageB.locator('.chat-row:has(.kind-ico)').first().click()
  await pageB.waitForSelector('.msg .text:has-text("до потери ключа")', { timeout: 8000, state: 'attached' })
  ok('B читал первое сообщение', true)

  // «Потерянное устройство»: A заходит с чистого контекста (новый браузер).
  const pageA2 = await browser.newPage()
  pageA2.on('pageerror', (e) => console.log('[pageerror A2]', e.message))
  await login(pageA2, nickA, pass)
  await pageA2.locator('.chat-row:has(.kind-ico)').first().click()
  await pageA2.waitForSelector('.input-pill textarea', { timeout: 10000 })
  await pageA2.waitForTimeout(2500) // автовосстановление ключа создателем
  await typeChat(pageA2, 'после восстановления ключа')
  await pageA2.press('.input-pill textarea', 'Enter')
  await pageA2.waitForSelector('.msg .text:has-text("после восстановления ключа")', { timeout: 15000, state: 'attached' })
  ok('A на новом устройстве восстановил ключ и пишет', true)

  // B (онлайн) получает key.reset и новый ключ, читает новое сообщение.
  try {
    await pageB.waitForSelector('.msg .text:has-text("после восстановления ключа")', { timeout: 25000, state: 'attached' })
    ok('B после сброса ключа читает новое сообщение', true)
  } catch {
    const bState = await pageB.evaluate(() => ({
      msgs: [...document.querySelectorAll('.msg')].map((m) => m.textContent.trim().slice(0, 40)),
      encrypted: [...document.querySelectorAll('.encrypted')].map((m) => m.textContent.slice(0, 40)),
      ta: document.querySelectorAll('.input-pill textarea').length,
    }))
    console.log('B state:', JSON.stringify(bState, null, 1))
    throw new Error('B не увидел новое сообщение')
  }

  await browser.close()
  finish()
})().catch((e) => { console.error('E2E ERROR:', e); process.exit(1) })
