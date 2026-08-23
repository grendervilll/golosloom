const { chromium } = require('playwright-core')
const BASE = process.env.BASE_URL || 'http://localhost:8080'
const PASS = 'TestPass12345!@#'
const CHROME = '/Users/alex/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

;(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'], headless: true })
  const ts = Date.now()

  const p1 = await browser.newPage()
  p1.on('console', m => console.log('[p1]', m.type(), m.text().slice(0, 150)))
  await p1.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p1.waitForTimeout(2000)
  await p1.getByText('Зарегистрироваться').first().click()
  await p1.getByPlaceholder('Ваш ник').fill('cv2_' + ts)
  await p1.getByPlaceholder('Пароль').first().fill(PASS)
  await p1.getByPlaceholder('Ещё раз').fill(PASS)
  await p1.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await p1.waitForSelector('.sidebar', { timeout: 30000 })
  await p1.waitForTimeout(20000)

  const p2 = await browser.newPage()
  await p2.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p2.waitForTimeout(2000)
  await p2.getByText('Зарегистрироваться').first().click()
  await p2.getByPlaceholder('Ваш ник').fill('cv2b_' + ts)
  await p2.getByPlaceholder('Пароль').first().fill(PASS)
  await p2.getByPlaceholder('Ещё раз').fill(PASS)
  await p2.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await p2.waitForSelector('.sidebar', { timeout: 30000 })
  await p2.waitForTimeout(15000)

  await p1.click('.add-btn')
  await p1.waitForSelector('input[placeholder="Название канала"]')
  await p1.fill('input[placeholder="Название канала"]', 'v2c-' + ts)
  await p1.getByRole('button', { name: 'Создать' }).click()
  await p1.waitForTimeout(3000)

  const chId = await p1.evaluate(async () => {
    const t = localStorage.getItem('golosloom-token')
    const chs = await fetch('/api/channels', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    return chs.find(c => c.is_member && c.name.startsWith('v2c-'))?.id
  })

  await p2.evaluate(async (id) => {
    const t = localStorage.getItem('golosloom-token')
    await fetch('/api/channels/' + id + '/join', { method: 'POST', headers: { Authorization: 'Bearer ' + t } })
  }, chId)
  await p2.reload({ waitUntil: 'load' })
  await p2.waitForTimeout(10000)

  const user2Id = await p2.evaluate(async () => {
    const t = localStorage.getItem('golosloom-token')
    return (await fetch('/api/me', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())).id
  })

  const callRes = await p1.evaluate(async (args) => {
    const t = localStorage.getItem('golosloom-token')
    return fetch('/api/calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
      body: JSON.stringify({ channel_id: args.chId, target_ids: [args.userId], device_id: 'dev1' })
    }).then(r => r.json())
  }, { chId, userId: user2Id })

  await p2.waitForTimeout(15000)
  const overlay = await p2.evaluate(() => {
    const d = document.querySelectorAll('[role="dialog"]')
    for (const el of d) { if (el.textContent.includes('звонит')) return true }
    return false
  })
  console.log('Call:', JSON.stringify(callRes).slice(0, 100), '| Overlay:', overlay)

  await browser.close()
})().catch(e => console.error('ERROR:', e.message))
