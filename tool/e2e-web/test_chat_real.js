// E2E test: both users ONLINE simultaneously (the real scenario)
// User1 creates channel + sends message → STAYS ONLINE
// User2 opens fresh browser → joins → gets key from User1 → reads + sends
const { chromium } = require('playwright-core')
const BASE = process.env.BASE_URL || 'http://localhost:8080'
const PASS = 'TestPass12345!@#'
const CHROME = '/Users/alex/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

;(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'], headless: true })
  const ts = Date.now()
  const msg1 = 'hello_from_user1_' + ts
  const msg2 = 'hello_from_user2_' + ts

  // ===== User1: register + create channel + send message =====
  console.log('=== User1: create channel + send message ===')
  const ctx1 = await browser.newContext()
  const p1 = await ctx1.newPage()
  p1.on('console', m => { const t = m.text(); if (t.includes('chat') || t.includes('key') || t.includes('sync')) console.log('[p1]', t.slice(0, 250)) })

  await p1.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p1.waitForTimeout(2000)
  await p1.getByText('Зарегистрироваться').first().click()
  await p1.getByPlaceholder('Ваш ник').fill('sim1_' + ts)
  await p1.getByPlaceholder('Пароль').first().fill(PASS)
  await p1.getByPlaceholder('Ещё раз').fill(PASS)
  await p1.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await p1.waitForSelector('.sidebar', { timeout: 30000 })
  await p1.waitForTimeout(20000) // key upload

  await p1.click('.add-btn')
  await p1.waitForSelector('input[placeholder="Название канала"]')
  await p1.fill('input[placeholder="Название канала"]', 'sim-' + ts)
  await p1.getByRole('button', { name: 'Создать' }).click()
  await p1.waitForTimeout(5000)

  const chId = await p1.evaluate(async () => {
    const t = localStorage.getItem('golosloom-token')
    const chs = await fetch('/api/channels', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    return chs.find(c => c.is_member && c.name.startsWith('sim-'))?.id
  })
  console.log('Channel:', chId)

  // Send message
  await p1.locator('textarea').first().fill(msg1)
  await p1.locator('.send-btn').click()
  await p1.waitForTimeout(3000)
  const p1ok = await p1.evaluate((msg) => {
    for (const b of document.querySelectorAll('.bubble')) { if (b.textContent?.includes(msg)) return true }
    return false
  }, msg1)
  console.log('User1 sent:', p1ok)

  // ===== User2: fresh browser, joins channel while User1 is ONLINE =====
  console.log('\n=== User2: join channel (User1 is online) ===')
  const ctx2 = await browser.newContext()
  const p2 = await ctx2.newPage()
  p2.on('console', m => { const t = m.text(); if (t.includes('chat') || t.includes('key') || t.includes('sync')) console.log('[p2]', t.slice(0, 250)) })

  await p2.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p2.waitForTimeout(2000)
  await p2.getByText('Зарегистрироваться').first().click()
  await p2.getByPlaceholder('Ваш ник').fill('sim2_' + ts)
  await p2.getByPlaceholder('Пароль').first().fill(PASS)
  await p2.getByPlaceholder('Ещё раз').fill(PASS)
  await p2.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await p2.waitForSelector('.sidebar', { timeout: 30000 })
  await p2.waitForTimeout(15000) // device key upload

  // Join channel
  await p2.evaluate(async (id) => {
    const t = localStorage.getItem('golosloom-token')
    await fetch('/api/channels/' + id + '/join', { method: 'POST', headers: { Authorization: 'Bearer ' + t } })
  }, chId)
  await p2.reload({ waitUntil: 'load' })
  await p2.waitForTimeout(5000)

  // Open the channel — User1 is online, should distribute key
  await p2.locator('.chat-list .chat-row').last().click()
  // Wait for key exchange: requestKey → broadcast → User1 wraps → key.granted → syncKeys → loadHistory
  console.log('Waiting for key exchange...')
  await p2.waitForTimeout(15000)

  // Check User2 state
  const p2state = await p2.evaluate(() => {
    const bubbles = document.querySelectorAll('.bubble')
    const encrypted = document.querySelectorAll('.encrypted')
    return { bubbles: bubbles.length, encrypted: encrypted.length }
  })
  console.log('User2 state:', JSON.stringify(p2state))

  // Check if User2 sees User1's message
  const p2see1 = await p2.evaluate((msg) => {
    for (const b of document.querySelectorAll('.bubble')) { if (b.textContent?.includes(msg)) return true }
    return false
  }, msg1)
  console.log('User2 sees User1 message:', p2see1)

  // User2 sends reply
  await p2.locator('textarea').first().fill(msg2)
  await p2.locator('.send-btn').click()
  await p2.waitForTimeout(5000)
  const p2ok = await p2.evaluate((msg) => {
    for (const b of document.querySelectorAll('.bubble')) { if (b.textContent?.includes(msg)) return true }
    return false
  }, msg2)
  console.log('User2 sent:', p2ok)

  // User1 should see User2's reply
  await p1.waitForTimeout(3000)
  const p1see2 = await p1.evaluate((msg) => {
    for (const b of document.querySelectorAll('.bubble')) { if (b.textContent?.includes(msg)) return true }
    return false
  }, msg2)
  console.log('User1 sees User2 reply:', p1see2)

  // Summary
  console.log('\n=== RESULT ===')
  const pass = p1ok && p2see1 && p2ok && p1see2
  console.log(pass ? 'PASS' : 'FAIL')
  console.log('  User1 sent:', p1ok)
  console.log('  User2 read:', p2see1)
  console.log('  User2 sent:', p2ok)
  console.log('  User1 read:', p1see2)

  await browser.close()
})().catch(e => console.error('ERROR:', e.message))
