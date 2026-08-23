const { chromium } = require('playwright-core')
const BASE = process.env.BASE_URL || 'http://localhost:8080'
const PASS = 'TestPass12345!@#'
const CHROME = '/Users/alex/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

;(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'], headless: true })
  const ts = Date.now()

  // User 1
  const p1 = await browser.newPage()
  await p1.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p1.waitForTimeout(2000)
  await p1.getByText('Зарегистрироваться').first().click()
  await p1.getByPlaceholder('Ваш ник').fill('c3_' + ts)
  await p1.getByPlaceholder('Пароль').first().fill(PASS)
  await p1.getByPlaceholder('Ещё раз').fill(PASS)
  await p1.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await p1.waitForSelector('.sidebar', { timeout: 30000 })
  await p1.waitForTimeout(10000) // Wait for Centrifuge

  // User 2
  const p2 = await browser.newPage()
  await p2.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p2.waitForTimeout(2000)
  await p2.getByText('Зарегистрироваться').first().click()
  await p2.getByPlaceholder('Ваш ник').fill('c4_' + ts)
  await p2.getByPlaceholder('Пароль').first().fill(PASS)
  await p2.getByPlaceholder('Ещё раз').fill(PASS)
  await p2.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await p2.waitForSelector('.sidebar', { timeout: 30000 })
  await p2.waitForTimeout(10000) // Wait for Centrifuge

  // User 1 creates channel
  await p1.click('.add-btn')
  await p1.waitForSelector('input[placeholder="Название канала"]')
  await p1.fill('input[placeholder="Название канала"]', 'e2ecall-' + ts)
  await p1.getByRole('button', { name: 'Создать' }).click()
  await p1.waitForTimeout(3000)

  const chId = await p1.evaluate(async () => {
    const t = localStorage.getItem('golosloom-token')
    const chs = await fetch('/api/channels', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    return chs.find(c => c.is_member && c.name.startsWith('e2ecall-'))?.id
  })
  console.log('Channel:', chId)

  // User 2 joins
  await p2.evaluate(async (id) => {
    const t = localStorage.getItem('golosloom-token')
    await fetch('/api/channels/' + id + '/join', { method: 'POST', headers: { Authorization: 'Bearer ' + t } })
  }, chId)
  await p2.reload({ waitUntil: 'load' })
  await p2.waitForTimeout(10000)

  // User 1 calls User 2 (different user ID)
  const user2Id = await p2.evaluate(async () => {
    const t = localStorage.getItem('golosloom-token')
    return (await fetch('/api/me', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())).id
  })
  console.log('User2 ID:', user2Id)

  const callRes = await p1.evaluate(async (args) => {
    const t = localStorage.getItem('golosloom-token')
    return fetch('/api/calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
      body: JSON.stringify({ channel_id: args.chId, target_ids: [args.userId], device_id: 'dev1' })
    }).then(r => r.json())
  }, { chId, userId: user2Id })
  console.log('Call:', JSON.stringify(callRes).slice(0, 200))

  // Wait for call.invite to be delivered
  await p2.waitForTimeout(5000)

  // Check if incoming call overlay is visible
  const hasOverlay = await p2.evaluate(() => {
    const dialogs = document.querySelectorAll('[role="dialog"]')
    for (const d of dialogs) {
      if (d.textContent.includes('звонит') || d.textContent.includes('Войти')) return true
    }
    return false
  })
  console.log('Incoming call visible:', hasOverlay)

  // Check if ringtone is playing
  const audioCtx = await p2.evaluate(() => {
    return document.querySelectorAll('audio').length
  })
  console.log('Audio elements:', audioCtx)

  await browser.close()
  console.log('=== DONE ===')
})().catch(e => console.error('ERROR:', e.message))
