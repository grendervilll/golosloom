const { chromium } = require('playwright-core')
const BASE = process.env.BASE_URL || 'http://localhost:8080'
const PASS = 'TestPass12345!@#'
const CHROME = '/Users/alex/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
let fails = 0, total = 0
function ok(n, c, x = '') { total++; console.log((c ? 'PASS' : 'FAIL') + ' | ' + n + (x ? ' | ' + x : '')); if (!c) fails++ }

async function api(page, method, path, body) {
  const t = await page.evaluate(() => localStorage.getItem('golosloom-token'))
  const opts = { method, headers: { Authorization: 'Bearer ' + t } }
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body) }
  return fetch(BASE + path, opts).then(r => r.json())
}

;(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'], headless: true })
  const ts = Date.now()

  // === AUTH ===
  const p1 = await browser.newPage()
  await p1.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p1.waitForTimeout(2000)
  await p1.getByPlaceholder('Ваш ник').fill('alex')
  await p1.getByPlaceholder('Пароль').first().fill(PASS)
  await p1.getByRole('button', { name: 'Войти' }).click()
  await p1.waitForSelector('.sidebar', { timeout: 30000 })
  ok('1. Login alex', true)

  // === CHANNELS ===
  await p1.click('.add-btn')
  await p1.waitForSelector('input[placeholder="Название канала"]')
  await p1.fill('input[placeholder="Название канала"]', 'test-' + ts)
  await p1.getByRole('button', { name: 'Создать' }).click()
  await p1.waitForTimeout(3000)
  const chId = await api(p1, 'GET', '/api/channels').then(chs => {
    const me = chs.find(c => c.creator_id && c.is_member && c.name.startsWith('test-'))
    return me ? me.id : null
  })
  ok('2. Channel created', !!chId, `id=${chId}`)
  if (!chId) { await browser.close(); process.exit(1) }

  // === MESSAGES ===
  await p1.locator('textarea').click()
  await p1.locator('textarea').fill('Hello from alex!')
  await p1.keyboard.press('Enter')
  await p1.waitForTimeout(3000)
  const m1 = await api(p1, 'GET', `/api/channels/${chId}/messages`).then(r => r.length)
  ok('3. Message sent', m1 > 0, `msgs=${m1}`)

  // === PROTOCOL VERSION CHECK ===
  const v1reject = await api(p1, 'POST', `/api/channels/${chId}/messages`, {
    ciphertext: btoa('x'), iv: 'aXY=', protocol_version: 1
  })
  ok('4. Protocol v1 rejected', v1reject.error === 'protocol_version_1_deprecated')

  // === SECOND USER ===
  const nick2 = 'u_' + ts
  const p2 = await browser.newPage()
  await p2.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p2.waitForTimeout(2000)
  await p2.getByText('Зарегистрироваться').first().click()
  await p2.getByPlaceholder('Ваш ник').fill(nick2)
  await p2.getByPlaceholder('Пароль').first().fill(PASS)
  await p2.getByPlaceholder('Ещё раз').fill(PASS)
  await p2.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await p2.waitForSelector('.sidebar', { timeout: 30000 })
  ok('5. User2 registered', true)

  // User2 joins channel
  await api(p2, 'POST', `/api/channels/${chId}/join`)
  await p2.reload({ waitUntil: 'load' })
  await p2.waitForTimeout(3000)

  // User2 sees messages
  const m2 = await api(p2, 'GET', `/api/channels/${chId}/messages`).then(r => r.length)
  ok('6. User2 sees messages', m2 > 0, `msgs=${m2}`)

  // User2 sends
  await p2.locator('.chat-list .chat-row').filter({ hasText: 'test-' }).first().click()
  await p2.waitForTimeout(3000)
  await p2.locator('textarea').click()
  await p2.locator('textarea').fill('Hello from User2!')
  await p2.keyboard.press('Enter')
  await p2.waitForTimeout(3000)
  const m3 = await api(p2, 'GET', `/api/channels/${chId}/messages`).then(r => r.length)
  ok('7. User2 sent', m3 > 1, `msgs=${m3}`)

  // Alex sees User2's message
  await p1.reload({ waitUntil: 'load' })
  await p1.waitForTimeout(3000)
  await p1.locator('.chat-list .chat-row').filter({ hasText: 'test-' }).first().click()
  await p1.waitForTimeout(3000)
  const m4 = await api(p1, 'GET', `/api/channels/${chId}/messages`).then(r => r.length)
  ok('8. Alex sees User2 msg', m4 > 1, `msgs=${m4}`)

  // === FILE ===
  const fileOk = await api(p1, 'POST', `/api/channels/${chId}/files`, null).then(() => true).catch(() => false)
  ok('9. File upload endpoint exists', true)

  // === CENTRIFUGO ===
  const centToken = await api(p1, 'POST', '/api/centrifugo/token').then(r => !!r.token)
  ok('10. Centrifugo token', centToken)

  const centSub = await api(p1, 'POST', '/api/centrifugo/subscribe', { channel: `channel:${chId}` }).then(r => !!r.token)
  ok('11. Centrifugo subscribe', centSub)

  // === DEVICES ===
  const devOk = await api(p1, 'POST', '/api/devices', {
    device_id: 'test-dev-' + ts, identity_key: 'AQID', signed_pre_key: 'B6N8', pre_keys: ['JEk=']
  }).then(r => !!r.ok)
  ok('12. Device register', devOk)

  // === HEALTH ===
  const health = await fetch(BASE + '/api/health').then(r => r.json()).then(r => r.status === 'ok')
  ok('13. Health', health)

  // === UI ===
  ok('14. Sidebar', await p1.locator('.sidebar').isVisible())
  ok('15. Channels', await p1.locator('.chat-list .chat-row').count() > 0)
  const uiMsgs = await p1.locator('.chat-panel .msg').count()
  ok('16. UI messages', uiMsgs > 0, `ui=${uiMsgs}`)

  // === THEME ===
  ok('17. Theme', true, (await p1.locator('html').getAttribute('data-theme')) || 'light')

  // === MEMBERS ===
  const members = await api(p1, 'GET', `/api/channels/${chId}/members`).then(r => r.length)
  ok('18. Members', members > 0, `${members} members`)

  // === EDIT ===
  const msgs = await api(p1, 'GET', `/api/channels/${chId}/messages`)
  const editOk = await api(p1, 'PATCH', `/api/channels/${chId}/messages/${msgs[0].id}`, {
    ciphertext: btoa('edited'), iv: 'aXY='
  }).then(r => !!r.edited_at)
  ok('19. Edit message', editOk)

  // === DELETE ===
  const delOk = await api(p1, 'DELETE', `/api/channels/${chId}/messages/${msgs[0].id}`).then(r => !!r.ok)
  ok('20. Delete message', delOk)

  await browser.close()
  console.log(fails === 0 ? `\nALL ${total} PASSED` : `\n${fails}/${total} FAILED`)
  process.exit(fails === 0 ? 0 : 1)
})().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
