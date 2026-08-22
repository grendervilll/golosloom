const { chromium } = require('playwright-core')
const BASE = process.env.BASE_URL || 'http://localhost:8080'
const PASS = 'TestPass12345!@#'
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
  await p1.fill('input[placeholder="Название канала"]', 'Видимость ' + Date.now())
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
  await p1.locator('textarea').fill('Сообщение от testuser1')
  await p1.keyboard.press('Enter')
  await p1.waitForTimeout(3000)
  
  const msg1 = await p1.evaluate(async (id) => {
    const t = localStorage.getItem('golosloom-token')
    const r = await fetch('/api/channels/' + id + '/messages', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    return r.length
  }, chId)
  ok('3. testuser1 отправил', msg1 > 0, `msgs=${msg1}`)

  // === User 2: alex ===
  const p2 = await browser.newPage()
  await p2.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p2.waitForTimeout(2000)
  await p2.getByPlaceholder('Ваш ник').fill('alex')
  await p2.getByPlaceholder('Пароль').first().fill(PASS)
  await p2.getByRole('button', { name: 'Войти' }).click()
  await p2.waitForSelector('.sidebar', { timeout: 30000 })
  ok('4. alex вошёл', true)

  // Alex входит в канал
  await p2.locator('.chat-list .chat-row').filter({ hasText: 'Видимость' }).first().click()
  await p2.waitForTimeout(5000)
  
  const alexMsgs = await p2.evaluate(async (id) => {
    const t = localStorage.getItem('golosloom-token')
    const r = await fetch('/api/channels/' + id + '/messages', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    return r.length
  }, chId)
  ok('5. alex видит сообщения', alexMsgs > 0, `msgs=${alexMsgs}`)

  // Alex отправляет сообщение
  await p2.locator('textarea').click()
  await p2.locator('textarea').fill('Сообщение от alex')
  await p2.keyboard.press('Enter')
  await p2.waitForTimeout(3000)
  
  const alexMsgs2 = await p2.evaluate(async (id) => {
    const t = localStorage.getItem('golosloom-token')
    const r = await fetch('/api/channels/' + id + '/messages', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    return r.length
  }, chId)
  ok('6. alex отправил', alexMsgs2 > 1, `msgs=${alexMsgs2}`)

  // testuser1 видит сообщение alex?
  const testuser1Msgs = await p1.evaluate(async (id) => {
    const t = localStorage.getItem('golosloom-token')
    const r = await fetch('/api/channels/' + id + '/messages', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    return r.length
  }, chId)
  ok('7. testuser1 видит сообщения alex', testuser1Msgs > 1, `msgs=${testuser1Msgs}`)

  // UI проверка: testuser1 видит сообщения в chat-panel
  await p1.waitForTimeout(2000)
  const uiMsgs = await p1.locator('.chat-panel .msg').count()
  ok('8. testuser1 UI показывает сообщения', uiMsgs > 0, `ui_msgs=${uiMsgs}`)

  await browser.close()
  console.log(fails === 0 ? '\nALL PASSED' : '\nFAILURES: ' + fails)
  process.exit(fails === 0 ? 0 : 1)
})().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
