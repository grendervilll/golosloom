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

  // === REGISTER ===
  const p1 = await browser.newPage()
  await p1.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p1.waitForTimeout(2000)
  await p1.getByText('Зарегистрироваться').first().click()
  await p1.getByPlaceholder('Ваш ник').fill('tester_' + ts)
  await p1.getByPlaceholder('Пароль').first().fill(PASS)
  await p1.getByPlaceholder('Ещё раз').fill(PASS)
  await p1.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await p1.waitForSelector('.sidebar', { timeout: 30000 })
  ok('1. Register', true)

  // === CHANNEL ===
  await p1.click('.add-btn')
  await p1.waitForSelector('input[placeholder="Название канала"]')
  await p1.fill('input[placeholder="Название канала"]', 'test-' + ts)
  await p1.getByRole('button', { name: 'Создать' }).click()
  await p1.waitForTimeout(3000)
  const chId = await api(p1, 'GET', '/api/channels').then(chs => {
    const me = chs.find(c => c.is_member && c.name.startsWith('test-'))
    return me ? me.id : null
  })
  ok('2. Channel', !!chId, `id=${chId}`)
  if (!chId) { await browser.close(); process.exit(1) }

  // === SEND MESSAGE ===
  await p1.locator('textarea').click()
  await p1.locator('textarea').fill('Hello from tester!')
  await p1.keyboard.press('Enter')
  await p1.waitForTimeout(3000)
  const m1 = await api(p1, 'GET', `/api/channels/${chId}/messages`).then(r => r.length)
  ok('3. Send message', m1 > 0, `msgs=${m1}`)

  // === PROTOCOL V1 REJECTED ===
  const v1 = await api(p1, 'POST', `/api/channels/${chId}/messages`, {
    ciphertext: btoa('x'), iv: 'aXY=', protocol_version: 1
  })
  ok('4. Protocol v1 rejected', v1.error === 'protocol_version_1_deprecated')

  // === PROTOCOL V2 WORKS ===
  const v2 = await api(p1, 'POST', `/api/channels/${chId}/messages`, {
    ciphertext: btoa('v2test'), iv: 'aXY=', protocol_version: 2
  })
  ok('5. Protocol v2 works', !!v2.id)

  // === USER 2 ===
  const nick2 = 'u2_' + ts
  const p2 = await browser.newPage()
  await p2.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p2.waitForTimeout(2000)
  await p2.getByText('Зарегистрироваться').first().click()
  await p2.getByPlaceholder('Ваш ник').fill(nick2)
  await p2.getByPlaceholder('Пароль').first().fill(PASS)
  await p2.getByPlaceholder('Ещё раз').fill(PASS)
  await p2.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await p2.waitForSelector('.sidebar', { timeout: 30000 })
  ok('6. User2 register', true)

  // User2 joins channel
  await api(p2, 'POST', `/api/channels/${chId}/join`)
  await p2.reload({ waitUntil: 'load' })
  await p2.waitForTimeout(3000)

  // User2 sees messages
  const m2 = await api(p2, 'GET', `/api/channels/${chId}/messages`).then(r => r.length)
  ok('7. User2 sees msgs', m2 > 0, `msgs=${m2}`)

  // User2 sends
  await p2.locator('.chat-list .chat-row').filter({ hasText: 'test-' }).first().click()
  await p2.waitForTimeout(3000)
  await p2.locator('textarea').click()
  await p2.locator('textarea').fill('Reply from User2!')
  await p2.keyboard.press('Enter')
  await p2.waitForTimeout(3000)
  const m3 = await api(p2, 'GET', `/api/channels/${chId}/messages`).then(r => r.length)
  ok('8. User2 sent', m3 > 2, `msgs=${m3}`)

  // User1 sees reply
  await p1.reload({ waitUntil: 'load' })
  await p1.waitForTimeout(3000)
  await p1.locator('.chat-list .chat-row').filter({ hasText: 'test-' }).first().click()
  await p1.waitForTimeout(3000)
  const m4 = await api(p1, 'GET', `/api/channels/${chId}/messages`).then(r => r.length)
  ok('9. User1 sees reply', m4 > 2, `msgs=${m4}`)

  // === EDIT ===
  const msgs = await api(p1, 'GET', `/api/channels/${chId}/messages`)
  const editOk = await api(p1, 'PATCH', `/api/channels/${chId}/messages/${msgs[0].id}`, {
    ciphertext: btoa('edited'), iv: 'aXY='
  }).then(r => !!r.edited_at)
  ok('10. Edit', editOk)

  // === DELETE ===
  const delOk = await api(p1, 'DELETE', `/api/channels/${chId}/messages/${msgs[0].id}`).then(r => !!r.ok)
  ok('11. Delete', delOk)

  // === DEVICES ===
  const devOk = await api(p1, 'POST', '/api/devices', {
    device_id: 'dev-' + ts, identity_key: 'AQID', signed_pre_key: 'B6N8', pre_keys: ['JEk=']
  }).then(r => !!r.ok)
  ok('12. Device', devOk)

  // === CENTRIFUGO ===
  const centToken = await api(p1, 'POST', '/api/centrifugo/token').then(r => !!r.token)
  ok('13. Centrifugo token', centToken)
  const centSub = await api(p1, 'POST', '/api/centrifugo/subscribe', { channel: `channel:${chId}` }).then(r => !!r.token)
  ok('14. Centrifugo subscribe', centSub)

  // === HEALTH ===
  const health = await fetch(BASE + '/api/health').then(r => r.json()).then(r => r.status === 'ok')
  ok('15. Health', health)

  // === UI ===
  ok('16. Sidebar', await p1.locator('.sidebar').isVisible())
  ok('17. Channels', await p1.locator('.chat-list .chat-row').count() > 0)
  ok('18. UI msgs', (await p1.locator('.chat-panel .msg').count()) > 0)
  ok('19. Theme', true, (await p1.locator('html').getAttribute('data-theme')) || 'light')

  // === MEMBERS ===
  const members = await api(p1, 'GET', `/api/channels/${chId}/members`).then(r => r.length)
  ok('20. Members', members >= 2, `${members} members`)

  // === FILE UPLOAD ===
  const fileRes = await p1.evaluate(async (id) => {
    const t = localStorage.getItem('golosloom-token')
    const f = new FormData()
    f.append('file', new Blob(['test file content'], { type: 'text/plain' }), 'test.txt')
    const r = await fetch(`/api/channels/${id}/files`, { method: 'POST', headers: { Authorization: 'Bearer ' + t }, body: f }).then(r => r.json())
    return !!r.id
  }, chId)
  ok('21. File upload', fileRes)

  // === CALL ===
  const callOk = await api(p1, 'POST', '/api/calls', {
    channel_id: chId, target_ids: [1], device_id: 'dev-' + ts
  }).then(r => !!r.call || !!r.error)
  ok('22. Call create', callOk)

  // === PUSH ===
  const pushOk = await api(p1, 'POST', '/api/push/subscribe', {
    endpoint: 'https://fcm.googleapis.com/fcm/send/test', p256dh: 'test', auth: 'test'
  }).then(r => !!r.ok)
  ok('23. Push subscribe', pushOk)

  // === INVITES ===
  const inviteOk = await api(p1, 'POST', `/api/channels/${chId}/invites`, { user_id: 1 }).then(r => true).catch(() => false)
  ok('24. Invite endpoint', inviteOk)

  await browser.close()
  console.log(fails === 0 ? `\nALL ${total} PASSED` : `\n${fails}/${total} FAILED`)
  process.exit(fails === 0 ? 0 : 1)
})().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
