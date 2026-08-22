const { chromium } = require('playwright-core')
const BASE = process.env.BASE_URL || 'http://localhost:8080'
const PASS = 'Test12345!@#'
const CHROME = '/Users/alex/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
let fails = 0
function ok(n, c, x = '') { console.log((c ? 'PASS' : 'FAIL') + ' | ' + n + (x ? ' | ' + x : '')); if (!c) fails++ }

;(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'], headless: true })

  // === User 1: testuser1 ===
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
  await p1.fill('input[placeholder="Название канала"]', 'Тест видимости ' + Date.now())
  await p1.getByRole('button', { name: 'Создать' }).click()
  await p1.waitForTimeout(3000)

  const chId = await p1.evaluate(async () => {
    const t = localStorage.getItem('golosloom-token')
    const me = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    const chs = await fetch('/api/channels', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    const mine = chs.filter(c => c.creator_id === me.id && c.is_member)
    return mine.length > 0 ? mine[mine.length - 1].id : null
  })
  ok('2. Канал создан', !!chId, `id=${chId}`)
  if (!chId) { await browser.close(); process.exit(1) }

  // Отправляем сообщение от testuser1
  await p1.locator('textarea').click()
  await p1.locator('textarea').fill('Привет от testuser1!')
  await p1.keyboard.press('Enter')
  await p1.waitForTimeout(3000)

  const msg1 = await p1.evaluate(async (id) => {
    const t = localStorage.getItem('golosloom-token')
    const r = await fetch('/api/channels/' + id + '/messages', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    return r.length
  }, chId)
  ok('3. testuser1 отправил', msg1 > 0, `msgs=${msg1}`)

  // === User 2: new user ===
  const nick2 = 'viewer_' + Date.now().toString().slice(-6)
  const p2 = await browser.newPage()
  await p2.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p2.waitForTimeout(2000)
  await p2.getByText('Зарегистрироваться').first().click()
  await p2.getByPlaceholder('Ваш ник').fill(nick2)
  await p2.getByPlaceholder('Пароль').first().fill(PASS)
  await p2.getByPlaceholder('Ещё раз').fill(PASS)
  await p2.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await p2.waitForSelector('.sidebar', { timeout: 30000 })
  ok('4. viewer зарегистрирован', true)

  // Viewer входит в канал
  await p2.locator('.chat-list .chat-row').filter({ hasText: 'Тест видимости' }).first().click()
  await p2.waitForTimeout(5000)

  // Проверяем API
  const viewerMsgs = await p2.evaluate(async (id) => {
    const t = localStorage.getItem('golosloom-token')
    const r = await fetch('/api/channels/' + id + '/messages', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    return r.length
  }, chId)
  ok('5. viewer видит сообщение testuser1 (API)', viewerMsgs > 0, `msgs=${viewerMsgs}`)

  // Проверяем UI
  const uiMsgs = await p2.locator('.chat-panel .msg').count()
  ok('6. viewer видит в UI', uiMsgs > 0, `ui_msgs=${uiMsgs}`)

  // Viewer отправляет ответ
  await p2.locator('textarea').click()
  await p2.locator('textarea').fill('Ответ от viewer!')
  await p2.keyboard.press('Enter')
  await p2.waitForTimeout(3000)

  // testuser1 видит ответ viewer?
  const testuser1Msgs = await p1.evaluate(async (id) => {
    const t = localStorage.getItem('golosloom-token')
    const r = await fetch('/api/channels/' + id + '/messages', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    return r.length
  }, chId)
  ok('7. testuser1 видит ответ viewer', testuser1Msgs > 1, `msgs=${testuser1Msgs}`)

  // UI testuser1
  const ui1 = await p1.locator('.chat-panel .msg').count()
  ok('8. testuser1 UI показывает', ui1 > 0, `ui_msgs=${ui1}`)

  await browser.close()
  console.log(fails === 0 ? '\nALL PASSED' : '\nFAILURES: ' + fails)
  process.exit(fails === 0 ? 0 : 1)
})().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
