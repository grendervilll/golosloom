// E2E против ПРОДАКШЕН-сервера: DM, обмен ключами, сообщества,
// восстановление ключа на «новом устройстве» (как у пользователя).
// Нужны заранее созданные пользователи E2E_PROD1/E2E_PROD2.
const { chromium } = require('playwright-core')
const { EXE, BASE, ok, createChannel, finish } = require('./helpers')

const PASS = 'Passw0rd!x123'
const NICK1 = process.env.E2E_PROD1 || 'e2eprod1'
const NICK2 = process.env.E2E_PROD2 || 'e2eprod2'

async function login(page, nick) {
  await page.goto(BASE, { waitUntil: 'load' })
  await page.getByPlaceholder('Ваш ник').fill(nick)
  await page.getByPlaceholder('Пароль').first().fill(PASS)
  await page.getByRole('button', { name: 'Войти' }).click()
  await page.waitForSelector('.sidebar', { timeout: 15000 })
}

async function typeChat(page, text) {
  await page.click('.input-pill textarea')
  await page.keyboard.type(text)
}

// Отправка с ретраями: ключ мог ещё восстанавливаться (до ~15 с).
async function sendAndWait(page, text, timeout) {
  const deadline = Date.now() + timeout
  for (;;) {
    await typeChat(page, text)
    await page.press('.input-pill textarea', 'Enter')
    try {
      await page.waitForSelector(`.msg .text:has-text("${text}")`, { timeout: 4000, state: 'attached' })
      return true
    } catch {
      if (Date.now() > deadline) throw new Error('сообщение не ушло за ' + timeout + 'мс: ' + text)
      await page.waitForTimeout(3000)
    }
  }
}

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-web-security'] })
  const pageA = await browser.newPage()
  const pageB = await browser.newPage()
  pageA.on('pageerror', (e) => console.log('[pageerror A]', e.message))
  pageA.on('console', (m) => { if (m.text().includes('[keys]')) console.log('[A-console]', m.text().slice(0, 300)) })
  pageB.on('pageerror', (e) => console.log('[pageerror B]', e.message))
  pageB.on('console', (m) => { if (m.text().includes('[keys]') || m.text().includes('decrypt')) console.log('[B-console]', m.text().slice(0, 300)) })

  await login(pageA, NICK1)
  console.log('A logged in:', NICK1)
  await login(pageB, NICK2)
  console.log('B logged in:', NICK2)

  // DM: A ищет B по нику.
  await pageA.click('.burger', { force: true })
  await pageA.getByText('Найти контакт').first().click()
  await pageA.waitForSelector('.search-input', { timeout: 8000 })
  await pageA.fill('.search-input', NICK2)
  await pageA.waitForTimeout(1200)
  const rowCount = await pageA.locator('.search-row', { hasText: NICK2 }).count()
  ok('поиск находит контакт', rowCount > 0)
  await pageA.locator('.search-row', { hasText: NICK2 }).first().click()
  await pageA.waitForFunction(
    (nick) => document.querySelector('.chat-head h2')?.textContent.toLowerCase().includes('и ' + nick.toLowerCase()),
    NICK2,
    { timeout: 12000 },
  )
  ok('DM создан', true)

  // A пишет в DM (канал может уже существовать с прошлого прогона).
  await pageA.waitForSelector('.input-pill textarea', { timeout: 15000 })
  await sendAndWait(pageA, 'привет с прода', 60000)
  ok('A отправил сообщение в DM', true)


  // B видит и отвечает.
  await pageB.reload({ waitUntil: 'load' })
  await pageB.waitForSelector('.chat-row', { timeout: 15000 })
  await pageB.locator('.chat-row:has(.kind-ico)').first().click()
  // Ключ от A приходит через обмен в фоне — ждём до 40с.
  await pageB.waitForSelector('.msg .text:has-text("привет с прода")', { timeout: 40000, state: 'attached' })
  ok('B получил ключ DM и читает', true)
  await sendAndWait(pageB, 'ответ с прода', 60000)
  await pageA.waitForSelector('.msg .text:has-text("ответ с прода")', { timeout: 30000, state: 'attached' })
  ok('B ответил, A читает ответ', true)

  // Сообщество: A создаёт, публикует, B подписывается и читает.
  const COMM_NAME = 'ПродТестКомм' + Math.floor(Date.now() / 1000) % 100000
  await pageA.click('.burger', { force: true })
  await pageA.getByText('Создать сообщество').first().click()
  await pageA.fill('input[placeholder="Название сообщества"]', COMM_NAME)
  await pageA.getByRole('button', { name: 'Создать', exact: true }).click()
  await pageA.waitForSelector(`.chat-head h2:has-text("${COMM_NAME}")`, { timeout: 10000 })
  await pageA.waitForSelector('.subs-count', { timeout: 8000 })
  ok('сообщество создано, счётчик виден', true)
  await sendAndWait(pageA, 'статья из сообщества', 60000)
  ok('A опубликовал в сообществе', true)

  // B: сообщества не видно, ищет, подписывается, читает.
  await pageB.reload({ waitUntil: 'load' })
  await pageB.waitForSelector('.chat-row', { timeout: 15000 })
  const bSees = await pageB.evaluate((n) => document.querySelector('.sidebar')?.innerText.includes(n), COMM_NAME)
  ok('B не видит сообщество до подписки', !bSees)
  await pageB.click('.burger', { force: true })
  await pageB.getByText('Найти контакт').first().click()
  await pageB.waitForSelector('.search-input', { timeout: 8000 })
  await pageB.fill('.search-input', COMM_NAME)
  await pageB.waitForTimeout(1200)
  await pageB.locator('.search-row', { hasText: COMM_NAME }).first().click()
  await pageB.waitForSelector(`.chat-head h2:has-text("${COMM_NAME}")`, { timeout: 12000 })
  await pageB.waitForSelector('.msg .text:has-text("статья из сообщества")', { timeout: 20000, state: 'attached' })
  ok('B подписался и читает сообщество', true)
  const roBar = await pageB.locator('.readonly-bar').count()
  const noInput = await pageB.locator('.input-pill textarea').count()
  ok('B не может писать (readonly)', roBar === 1 && noInput === 0)

  // Восстановление ключа: A заходит с чистого контекста («переустановка»).
  const pageA2 = await browser.newPage()
  pageA2.on('pageerror', (e) => console.log('[pageerror A2]', e.message))
  await login(pageA2, NICK1)
  await pageA2.locator('.chat-row:has(.kind-ico)').first().click()
  await pageA2.waitForSelector('.input-pill textarea', { timeout: 15000 })
  await pageA2.waitForTimeout(3000)
  await sendAndWait(pageA2, 'после переустановки', 60000)
  ok('A на новом устройстве восстановил ключ и пишет', true)
  await pageB.waitForSelector('.msg .text:has-text("после переустановки")', { timeout: 30000, state: 'attached' })
  ok('B читает сообщение после восстановления', true)

  await browser.close()
  finish()
})().catch((e) => { console.error('E2E ERROR:', e); process.exit(1) })
