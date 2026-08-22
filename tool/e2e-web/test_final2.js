const { chromium } = require('playwright-core')
const BASE = 'https://gl.netbird.mhspx.ru'
const PASS = 'Test12345!@#'
const CHROME = '/Users/alex/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
let fails = 0
function ok(n, c, x = '') { console.log((c ? 'PASS' : 'FAIL') + ' | ' + n + (x ? ' | ' + x : '')); if (!c) fails++ }

;(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'], headless: true })
  const ts = Date.now()

  // User 1: testuser1
  const p1 = await browser.newPage()
  await p1.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p1.waitForTimeout(2000)
  await p1.getByPlaceholder('Ваш ник').fill('testuser1')
  await p1.getByPlaceholder('Пароль').first().fill(PASS)
  await p1.getByRole('button', { name: 'Войти' }).click()
  await p1.waitForSelector('.sidebar', { timeout: 30000 })
  ok('1. testuser1 вошёл', true)

  // Создаём канал
  await p1.click('.add-btn')
  await p1.waitForSelector('input[placeholder="Название канала"]')
  await p1.fill('input[placeholder="Название канала"]', 'chat-' + ts)
  await p1.getByRole('button', { name: 'Создать' }).click()
  await p1.waitForTimeout(3000)
  const chId = await p1.evaluate(async () => {
    const t = localStorage.getItem('golosloom-token')
    const me = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    const chs = await fetch('/api/channels', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    const mine = chs.filter(c => c.creator_id === me.id && c.is_member)
    return mine.length > 0 ? mine[mine.length - 1].id : null
  })
  ok('2. Канал', !!chId, `id=${chId}`)
  if (!chId) { await browser.close(); process.exit(1) }

  // testuser1 отправляет
  await p1.locator('textarea').click()
  await p1.locator('textarea').fill('Привет от testuser1!')
  await p1.keyboard.press('Enter')
  await p1.waitForTimeout(3000)
  ok('3. testuser1 отправил', (await p1.evaluate(async (id) => {
    const t = localStorage.getItem('golosloom-token')
    return (await fetch('/api/channels/' + id + '/messages', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())).length
  }, chId)) > 0)

  // User 2: регистрируемся и входим в канал через API
  const nick2 = 'v_' + ts
  const p2 = await browser.newPage()
  await p2.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p2.waitForTimeout(2000)
  await p2.getByText('Зарегистрироваться').first().click()
  await p2.getByPlaceholder('Ваш ник').fill(nick2)
  await p2.getByPlaceholder('Пароль').first().fill(PASS)
  await p2.getByPlaceholder('Ещё раз').fill(PASS)
  await p2.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await p2.waitForSelector('.sidebar', { timeout: 30000 })
  ok('4. User2 зарегистрирован', true)

  // User2 вступает в канал через API
  const joinOk = await p2.evaluate(async (id) => {
    const t = localStorage.getItem('golosloom-token')
    const r = await fetch('/api/channels/' + id + '/join', { method: 'POST', headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    return !!r.ok
  }, chId)
  ok('4b. User2 вступил в канал', joinOk)

  // Обновляем страницу чтобы sidebar обновился
  await p2.reload({ waitUntil: 'load' })
  await p2.waitForTimeout(3000)
  
  // User2 видит канал
  await p2.locator('.chat-list .chat-row').filter({ hasText: 'chat-' }).first().click()
  await p2.waitForTimeout(5000)

  // User2 видит сообщение testuser1?
  const m2 = await p2.evaluate(async (id) => {
    const t = localStorage.getItem('golosloom-token')
    return (await fetch('/api/channels/' + id + '/messages', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())).length
  }, chId)
  ok('5. User2 видит testuser1', m2 > 0, `msgs=${m2}`)

  // User2 отправляет
  await p2.locator('textarea').click()
  await p2.locator('textarea').fill('Ответ от User2!')
  await p2.keyboard.press('Enter')
  await p2.waitForTimeout(3000)
  const m3 = await p2.evaluate(async (id) => {
    const t = localStorage.getItem('golosloom-token')
    return (await fetch('/api/channels/' + id + '/messages', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())).length
  }, chId)
  ok('6. User2 отправил', m3 > 1, `msgs=${m3}`)

  // testuser1 обновляет и видит
  await p1.reload({ waitUntil: 'load' })
  await p1.waitForTimeout(3000)
  await p1.locator('.chat-list .chat-row').filter({ hasText: 'chat-' }).first().click()
  await p1.waitForTimeout(3000)
  const m4 = await p1.evaluate(async (id) => {
    const t = localStorage.getItem('golosloom-token')
    return (await fetch('/api/channels/' + id + '/messages', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())).length
  }, chId)
  ok('7. testuser1 видит ответ', m4 > 1, `msgs=${m4}`)

  // UI
  const ui = await p1.locator('.chat-panel .msg').count()
  ok('8. UI показывает', ui > 0, `ui=${ui}`)

  await browser.close()
  console.log(fails === 0 ? '\nALL PASSED' : '\nFAILURES: ' + fails)
  process.exit(fails === 0 ? 0 : 1)
})().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
