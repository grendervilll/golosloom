const { chromium } = require('playwright-core')
const BASE = process.env.BASE_URL || 'http://localhost:8080'
const PASS = 'TestPass12345!@#'
const CHROME = '/Users/alex/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

;(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'], headless: true })
  const ts = Date.now()

  // User 1: registers and creates channel
  const p1 = await browser.newPage()
  p1.on('console', m => {
    const t = m.text()
    if (t.includes('user:') || t.includes('subscribe'))
      console.log('[p1]', t.slice(0, 150))
  })
  await p1.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p1.waitForTimeout(2000)
  await p1.getByText('Зарегистрироваться').first().click()
  await p1.getByPlaceholder('Ваш ник').fill('cu1_' + ts)
  await p1.getByPlaceholder('Пароль').first().fill(PASS)
  await p1.getByPlaceholder('Ещё раз').fill(PASS)
  await p1.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await p1.waitForSelector('.sidebar', { timeout: 30000 })

  // Create channel
  await p1.click('.add-btn')
  await p1.waitForSelector('input[placeholder="Название канала"]')
  await p1.fill('input[placeholder="Название канала"]', 'call-' + ts)
  await p1.getByRole('button', { name: 'Создать' }).click()
  await p1.waitForTimeout(3000)

  const chId = await p1.evaluate(async () => {
    const t = localStorage.getItem('golosloom-token')
    const chs = await fetch('/api/channels', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    return chs.find(c => c.is_member && c.name.startsWith('call-'))?.id
  })
  console.log('Channel:', chId)

  // User 2: registers and joins
  const p2 = await browser.newPage()
  p2.on('console', m => {
    const t = m.text()
    if (t.includes('user:') || t.includes('subscribe') || t.includes('call'))
      console.log('[p2]', t.slice(0, 150))
  })
  await p2.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p2.waitForTimeout(2000)
  await p2.getByText('Зарегистрироваться').first().click()
  await p2.getByPlaceholder('Ваш ник').fill('cu2_' + ts)
  await p2.getByPlaceholder('Пароль').first().fill(PASS)
  await p2.getByPlaceholder('Ещё раз').fill(PASS)
  await p2.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await p2.waitForSelector('.sidebar', { timeout: 30000 })

  // Join channel
  await p2.evaluate(async (id) => {
    const t = localStorage.getItem('golosloom-token')
    await fetch('/api/channels/' + id + '/join', { method: 'POST', headers: { Authorization: 'Bearer ' + t } })
  }, chId)
  await p2.reload({ waitUntil: 'load' })
  await p2.waitForTimeout(10000)

  // Wait for subscriptions
  await p1.waitForTimeout(5000)
  await p2.waitForTimeout(5000)

  // User 1 calls User 2
  console.log('=== CALLING ===')
  const callRes = await p1.evaluate(async (chId) => {
    const t = localStorage.getItem('golosloom-token')
    const me = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    return fetch('/api/calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
      body: JSON.stringify({ channel_id: chId, target_ids: [me.id], device_id: 'test-dev' })
    }).then(r => r.json())
  }, chId)
  console.log('Call result:', JSON.stringify(callRes).slice(0, 200))

  // Wait and check if User 2 received the call invite
  await p2.waitForTimeout(5000)
  const hasIncoming = await p2.evaluate(() => {
    const overlay = document.querySelector('[class*="incoming"], [class*="dialog"]')
    return overlay ? 'yes' : 'no'
  })
  console.log('Incoming call overlay:', hasIncoming)

  // Check if ringtone is playing
  const ringtone = await p2.evaluate(() => {
    const audio = document.querySelectorAll('audio')
    return audio.length
  })
  console.log('Audio elements:', ringtone)

  await browser.close()
  console.log('=== DONE ===')
})().catch(e => console.error('ERROR:', e.message))
