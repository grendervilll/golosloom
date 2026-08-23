// E2E test: chat message exchange (key exchange + encryption)
const { chromium } = require('playwright-core')
const BASE = process.env.BASE_URL || 'http://localhost:8080'
const PASS = 'TestPass12345!@#'
const CHROME = '/Users/alex/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

;(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'], headless: true })
  const ts = Date.now()
  const msg1 = 'msg1_' + ts
  const msg2 = 'msg2_' + ts

  // --- User1: register + create channel ---
  const p1 = await browser.newPage()
  p1.on('console', m => { const t = m.text(); if (t.includes('chat') || t.includes('channels') || t.includes('key')) console.log('[p1]', t.slice(0, 200)) })
  await p1.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p1.waitForTimeout(2000)
  await p1.getByText('Зарегистрироваться').first().click()
  await p1.getByPlaceholder('Ваш ник').fill('ch1_' + ts)
  await p1.getByPlaceholder('Пароль').first().fill(PASS)
  await p1.getByPlaceholder('Ещё раз').fill(PASS)
  await p1.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await p1.waitForSelector('.sidebar', { timeout: 30000 })
  await p1.waitForTimeout(20000) // wait for key upload

  // Create a fresh channel
  await p1.click('.add-btn')
  await p1.waitForSelector('input[placeholder="Название канала"]')
  await p1.fill('input[placeholder="Название канала"]', 'chat-' + ts)
  await p1.getByRole('button', { name: 'Создать' }).click()
  await p1.waitForTimeout(5000)

  const chId = await p1.evaluate(async () => {
    const t = localStorage.getItem('golosloom-token')
    const chs = await fetch('/api/channels', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    return chs.find(c => c.is_member && c.name.startsWith('chat-'))?.id
  })
  console.log('Channel:', chId)

  // --- User2: register + join channel ---
  const p2 = await browser.newPage()
  p2.on('console', m => { const t = m.text(); if (t.includes('chat') || t.includes('channels') || t.includes('key')) console.log('[p2]', t.slice(0, 200)) })
  await p2.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p2.waitForTimeout(2000)
  await p2.getByText('Зарегистрироваться').first().click()
  await p2.getByPlaceholder('Ваш ник').fill('ch2_' + ts)
  await p2.getByPlaceholder('Пароль').first().fill(PASS)
  await p2.getByPlaceholder('Ещё раз').fill(PASS)
  await p2.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await p2.waitForSelector('.sidebar', { timeout: 30000 })
  await p2.waitForTimeout(15000) // wait for key upload

  // Join channel
  await p2.evaluate(async (id) => {
    const t = localStorage.getItem('golosloom-token')
    await fetch('/api/channels/' + id + '/join', { method: 'POST', headers: { Authorization: 'Bearer ' + t } })
  }, chId)
  await p2.reload({ waitUntil: 'load' })
  await p2.waitForTimeout(5000)

  // Open the fresh channel (click last in sidebar which is the new one)
  await p2.locator('.chat-list .chat-row').last().click()
  await p2.waitForTimeout(10000) // wait for key exchange + history load

  // --- User2 sends a message ---
  const textarea2 = p2.locator('textarea').first()
  await textarea2.fill(msg1)
  await p2.locator('.send-btn').click()
  await p2.waitForTimeout(5000)

  // Check if message appears in p2's chat (use .bubble selector)
  const p2sent = await p2.evaluate((msg) => {
    const bubbles = document.querySelectorAll('.bubble')
    for (const b of bubbles) {
      if (b.textContent?.includes(msg)) return true
    }
    return false
  }, msg1)
  console.log('p2 sent message visible:', p2sent)

  // --- Check if p1 received the message ---
  await p1.waitForTimeout(5000)
  const p1received = await p1.evaluate((msg) => {
    const bubbles = document.querySelectorAll('.bubble')
    for (const b of bubbles) {
      if (b.textContent?.includes(msg)) return true
    }
    return false
  }, msg1)
  console.log('p1 received message:', p1received)

  // --- User1 sends a message back ---
  const textarea1 = p1.locator('textarea').first()
  await textarea1.fill(msg2)
  await p1.locator('.send-btn').click()
  await p1.waitForTimeout(5000)

  const p2receivedReply = await p2.evaluate((msg) => {
    const bubbles = document.querySelectorAll('.bubble')
    for (const b of bubbles) {
      if (b.textContent?.includes(msg)) return true
    }
    return false
  }, msg2)
  console.log('p2 received reply:', p2receivedReply)

  // Summary
  console.log('---')
  console.log('RESULT:', p2sent && p1received && p2receivedReply ? 'PASS' : 'FAIL')

  await browser.close()
})().catch(e => console.error('ERROR:', e.message))
