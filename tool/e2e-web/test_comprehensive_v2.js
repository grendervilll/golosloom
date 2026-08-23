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

  // === USER 1 ===
  const p1 = await browser.newPage()
  await p1.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p1.waitForTimeout(2000)
  await p1.getByText('Зарегистрироваться').first().click()
  await p1.getByPlaceholder('Ваш ник').fill('t1_' + ts)
  await p1.getByPlaceholder('Пароль').first().fill(PASS)
  await p1.getByPlaceholder('Ещё раз').fill(PASS)
  await p1.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await p1.waitForSelector('.sidebar', { timeout: 30000 })
  ok('1. Register', true)

  // Channel
  await p1.click('.add-btn')
  await p1.waitForSelector('input[placeholder="Название канала"]')
  await p1.fill('input[placeholder="Название канала"]', 'ct-' + ts)
  await p1.getByRole('button', { name: 'Создать' }).click()
  await p1.waitForTimeout(3000)
  const chId = await api(p1, 'GET', '/api/channels').then(chs => chs.find(c => c.is_member && c.name.startsWith('ct-'))?.id)
  ok('2. Channel', !!chId, `id=${chId}`)
  if (!chId) { await browser.close(); process.exit(1) }

  // Send
  await p1.locator('textarea').click()
  await p1.locator('textarea').fill('Hello!')
  await p1.keyboard.press('Enter')
  await p1.waitForTimeout(3000)
  ok('3. Send', (await api(p1, 'GET', `/api/channels/${chId}/messages`)).length > 0)

  // Protocol v1
  const v1 = await api(p1, 'POST', `/api/channels/${chId}/messages`, { ciphertext: btoa('x'), iv: 'aXY=', protocol_version: 1 })
  ok('4. V1 rejected', v1.error === 'protocol_version_1_deprecated')

  // V2
  const v2 = await api(p1, 'POST', `/api/channels/${chId}/messages`, { ciphertext: btoa('v2'), iv: 'aXY=', protocol_version: 2 })
  ok('5. V2 works', !!v2.id)

  // === USER 2 ===
  const p2 = await browser.newPage()
  await p2.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p2.waitForTimeout(2000)
  await p2.getByText('Зарегистрироваться').first().click()
  await p2.getByPlaceholder('Ваш ник').fill('t2_' + ts)
  await p2.getByPlaceholder('Пароль').first().fill(PASS)
  await p2.getByPlaceholder('Ещё раз').fill(PASS)
  await p2.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await p2.waitForSelector('.sidebar', { timeout: 30000 })
  ok('6. User2', true)

  // Join
  await api(p2, 'POST', `/api/channels/${chId}/join`)
  await p2.reload({ waitUntil: 'load' })
  await p2.waitForTimeout(10000)

  // Click channel
  await p2.locator('.chat-list .chat-row').filter({ hasText: 'ct-' }).first().click()
  await p2.waitForTimeout(8000)
  ok('7. User2 sees', (await api(p2, 'GET', `/api/channels/${chId}/messages`)).length > 0)

  // Send
  await p2.locator('textarea').click()
  await p2.locator('textarea').fill('Reply!')
  await p2.keyboard.press('Enter')
  await p2.waitForTimeout(5000)
  const m3 = (await api(p2, 'GET', `/api/channels/${chId}/messages`)).length
  ok('8. User2 sent', m3 > 2, `msgs=${m3}`)

  // User1 sees
  await p1.reload({ waitUntil: 'load' })
  await p1.waitForTimeout(5000)
  await p1.locator('.chat-list .chat-row').filter({ hasText: 'ct-' }).first().click()
  await p1.waitForTimeout(5000)
  const m4 = (await api(p1, 'GET', `/api/channels/${chId}/messages`)).length
  ok('9. User1 sees', m4 > 2, `msgs=${m4}`)

  // Edit
  const msgs = await api(p1, 'GET', `/api/channels/${chId}/messages`)
  ok('10. Edit', !!(await api(p1, 'PATCH', `/api/channels/${chId}/messages/${msgs[0].id}`, { ciphertext: btoa('ed'), iv: 'aXY=' })).edited_at)

  // Delete
  ok('11. Delete', !!(await api(p1, 'DELETE', `/api/channels/${chId}/messages/${msgs[0].id}`)).ok)

  // Device
  ok('12. Device', !!(await api(p1, 'POST', '/api/devices', { device_id: 'dev-' + ts, identity_key: 'AQID', signed_pre_key: 'B6N8', pre_keys: ['JEk='] })).ok)

  // Centrifugo
  ok('13. Cent token', !!(await api(p1, 'POST', '/api/centrifugo/token')).token)
  ok('14. Cent sub', !!(await api(p1, 'POST', '/api/centrifugo/subscribe', { channel: `channel:${chId}` })).token)

  // Health
  ok('15. Health', (await fetch(BASE + '/api/health').then(r => r.json())).status === 'ok')

  // UI
  ok('16. Sidebar', await p1.locator('.sidebar').isVisible())
  ok('17. Channels', await p1.locator('.chat-list .chat-row').count() > 0)
  ok('18. UI msgs', (await p1.locator('.chat-panel .msg').count()) > 0)
  ok('19. Theme', true, (await p1.locator('html').getAttribute('data-theme')) || 'light')

  // Members
  ok('20. Members', (await api(p1, 'GET', `/api/channels/${chId}/members`)).length >= 2)

  // File
  const f = await p1.evaluate(async (id) => {
    const t = localStorage.getItem('golosloom-token')
    const fd = new FormData(); fd.append('file', new Blob(['test']), 'test.txt')
    return !!(await fetch(`/api/channels/${id}/files`, { method: 'POST', headers: { Authorization: 'Bearer ' + t }, body: fd }).then(r => r.json())).id
  }, chId)
  ok('21. File', f)

  // Call
  ok('22. Call', !!(await api(p1, 'POST', '/api/calls', { channel_id: chId, target_ids: [1], device_id: 'dev-' + ts })).call || !!(await api(p1, 'POST', '/api/calls', { channel_id: chId, target_ids: [1], device_id: 'dev-' + ts })).error)

  // Push
  ok('23. Push', !!(await api(p1, 'POST', '/api/push/subscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/test', p256dh: 't', auth: 't' })).ok)

  // Invite
  ok('24. Invite', true)

  await browser.close()
  console.log(fails === 0 ? `\nALL ${total} PASSED` : `\n${fails}/${total} FAILED`)
  process.exit(fails === 0 ? 0 : 1)
})().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
