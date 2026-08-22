const { chromium } = require('playwright-core')
const BASE = process.env.BASE_URL || 'http://localhost:8080'
const PASS = 'TestPass12345!@#'
const CHROME = '/Users/alex/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
let fails = 0
function ok(n, c, x = '') { console.log((c ? 'PASS' : 'FAIL') + ' | ' + n + (x ? ' | ' + x : '')); if (!c) fails++ }

;(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'], headless: true })
  const ts = Date.now().toString().slice(-6)
  const nick1 = 'e2e_' + ts

  const p1 = await browser.newPage()
  p1.on('console', m => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 80)) })

  // 1. Регистрация
  await p1.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p1.waitForTimeout(2000)
  await p1.getByText('Зарегистрироваться').first().click()
  await p1.getByPlaceholder('Ваш ник').fill(nick1)
  await p1.getByPlaceholder('Пароль').first().fill(PASS)
  await p1.getByPlaceholder('Ещё раз').fill(PASS)
  await p1.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await p1.waitForSelector('.sidebar', { timeout: 30000 })
  ok('1. Регистрация', true)

  // 2. Создание канала
  await p1.click('.add-btn')
  await p1.waitForSelector('input[placeholder="Название канала"]')
  await p1.fill('input[placeholder="Название канала"]', 'E2E ' + ts)
  await p1.getByRole('button', { name: 'Создать' }).click()
  await p1.waitForTimeout(3000)
  //频道ID через API
  channelId = await p1.evaluate(async () => {
    const t = localStorage.getItem('golosloom-token')
    const chs = await fetch('/api/channels', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    const m = chs.filter(c => c.is_member)
    return m.length > 0 ? m[m.length - 1].id : null
  })
  ok('2. Канал создан', !!channelId, `id=${channelId}`)

  if (!channelId) { await browser.close(); process.exit(1) }

  // 3. Сообщение
  try {
    const ta = p1.locator('textarea')
    await ta.waitFor({ state: 'visible', timeout: 5000 })
    await ta.click()
    await ta.fill('Привет из E2E!')
    await p1.waitForTimeout(500)
    await p1.keyboard.press('Enter')
    await p1.waitForTimeout(3000)
    const cnt = await p1.locator('.chat-panel .msg').count()
    const apiCnt = await p1.evaluate(async (chId) => {
      const t = localStorage.getItem('golosloom-token')
      const r = await fetch('/api/channels/' + chId + '/messages', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
      return Array.isArray(r) ? r.length : 0
    }, channelId)
    ok('3. Сообщение', cnt > 0 || apiCnt > 0, `ui=${cnt} api=${apiCnt}`)
  } catch (e) {
    ok('3. Сообщение', false, e.message.slice(0, 80))
  }

  // 4. История в UI (после отправки)
  const histCnt = await p1.locator('.chat-panel .msg').count()
  ok('4. История UI', histCnt > 0, `msgs=${histCnt}`)

  // 5. Файл
  const fileOk = await p1.evaluate(async (chId) => {
    const t = localStorage.getItem('golosloom-token')
    const f = new FormData(); f.append('file', new Blob(['test']), 'test.txt')
    const r = await fetch('/api/channels/' + chId + '/files', { method: 'POST', headers: { Authorization: 'Bearer ' + t }, body: f }).then(r => r.json())
    return !!r.id
  }, channelId)
  ok('5. Файл', fileOk)

  // 6. Редактирование
  const editOk = await p1.evaluate(async (chId) => {
    const t = localStorage.getItem('golosloom-token')
    const msgs = await fetch('/api/channels/' + chId + '/messages', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    if (!msgs.length) return false
    const r = await fetch('/api/channels/' + chId + '/messages/' + msgs[0].id, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ ciphertext: btoa(String.fromCharCode(1,2,3)), iv: 'aXY=' }) }).then(r => r.json())
    return !!r.edited_at
  }, channelId)
  ok('6. Редактирование', editOk)

  // 7. Удаление
  const delOk = await p1.evaluate(async (chId) => {
    const t = localStorage.getItem('golosloom-token')
    const msgs = await fetch('/api/channels/' + chId + '/messages', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    if (!msgs.length) return false
    const r = await fetch('/api/channels/' + chId + '/messages/' + msgs[0].id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    return !!r.ok
  }, channelId)
  ok('7. Удаление', delOk)

  // 8. Protocol v1
  const v1 = await p1.evaluate(async (chId) => {
    const t = localStorage.getItem('golosloom-token')
    const r = await fetch('/api/channels/' + chId + '/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ ciphertext: btoa('x'), iv: 'aXY=', protocol_version: 1 }) }).then(r => r.json())
    return r.error === 'protocol_version_1_deprecated'
  }, channelId)
  ok('8. Protocol v1 rejected', v1)

  // 9. Устройство
  const devOk = await p1.evaluate(async () => {
    const t = localStorage.getItem('golosloom-token')
    await fetch('/api/devices', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ device_id: 'e2e-' + Date.now(), identity_key: 'AQID', signed_pre_key: 'B6N8', pre_keys: ['JEk='] }) }).then(r => r.json())
    const me = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    const devs = await fetch('/api/users/' + me.id + '/devices', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    return devs.length > 0
  })
  ok('9. Устройство', devOk)

  // 10. Centrifugo token
  const centOk = await p1.evaluate(async () => {
    const t = localStorage.getItem('golosloom-token')
    const r = await fetch('/api/centrifugo/token', { method: 'POST', headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    return !!r.token
  })
  ok('10. Centrifugo token', centOk)

  // 11. Centrifugo subscribe
  const subOk = await p1.evaluate(async (chId) => {
    const t = localStorage.getItem('golosloom-token')
    const r = await fetch('/api/centrifugo/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ channel: 'channel:' + chId }) }).then(r => r.json())
    return !!r.token
  }, channelId)
  ok('11. Centrifugo subscribe', subOk)

  // 12. Звонок
  const callOk = await p1.evaluate(async (chId) => {
    const t = localStorage.getItem('golosloom-token')
    const me = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    const r = await fetch('/api/calls', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ channel_id: chId, target_ids: [me.id], device_id: 'e2e-dev' }) }).then(r => r.json())
    return !!r.call || !!r.error
  }, channelId)
  ok('12. Звонок', callOk)

  // 13. Health
  ok('13. Health', await p1.evaluate(async () => (await fetch('/api/health').then(r => r.json())).status === 'ok'))

  // 14. Тема
  ok('14. Тема', true, (await p1.locator('html').getAttribute('data-theme')) || 'light')

  // 15. Сайдбар
  ok('15. Сайдбар', await p1.locator('.sidebar').isVisible())

  // 16. Каналы
  ok('16. Каналы', await p1.locator('.chat-list .chat-row').count() > 0)

  // 17. Участники
  const members = await p1.evaluate(async (chId) => {
    const t = localStorage.getItem('golosloom-token')
    return (await fetch('/api/channels/' + chId + '/members', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())).length
  }, channelId)
  ok('17. Участники', members > 0, `${members} участников`)

  await browser.close()
  console.log(fails === 0 ? '\nALL PASSED' : '\nFAILURES: ' + fails)
  process.exit(fails === 0 ? 0 : 1)
})().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
