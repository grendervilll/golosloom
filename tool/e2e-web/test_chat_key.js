// E2E test: chat message exchange (key exchange + encryption)
const { chromium } = require('playwright-core')
const BASE = process.env.BASE_URL || 'http://localhost:8080'
const PASS = 'TestPass12345!@#'
const CHROME = '/Users/alex/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

;(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'], headless: true })
  const ts = Date.now()
  const msg = 'test_msg_' + ts

  // --- User1: register + create channel ---
  const p1 = await browser.newPage()
  p1.on('console', m => { const t = m.text(); if (t.includes('channels') || t.includes('chat') || t.includes('key')) console.log('[p1]', t.slice(0, 200)) })
  await p1.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p1.waitForTimeout(2000)
  await p1.getByText('Зарегистрироваться').first().click()
  await p1.getByPlaceholder('Ваш ник').fill('chat1_' + ts)
  await p1.getByPlaceholder('Пароль').first().fill(PASS)
  await p1.getByPlaceholder('Ещё раз').fill(PASS)
  await p1.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await p1.waitForSelector('.sidebar', { timeout: 30000 })
  await p1.waitForTimeout(20000) // wait for key upload + sync

  // Create channel
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
  p2.on('console', m => { const t = m.text(); if (t.includes('channels') || t.includes('chat') || t.includes('key')) console.log('[p2]', t.slice(0, 200)) })
  await p2.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p2.waitForTimeout(2000)
  await p2.getByText('Зарегистрироваться').first().click()
  await p2.getByPlaceholder('Ваш ник').fill('chat2_' + ts)
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

  // Open channel
  await p2.locator('.chat-list .chat-row').last().click()
  await p2.waitForTimeout(8000) // wait for key exchange + history load

  // Check if p2 has key
  const p2HasKey = await p2.evaluate(async (chId) => {
    // Check if messages are decrypted (not encrypted placeholder)
    const msgs = document.querySelectorAll('.message-text')
    for (const m of msgs) {
      if (m.textContent && !m.textContent.includes('[зашифровано]') && m.textContent.trim().length > 0) {
        return true
      }
    }
    return false
  }, chId)
  console.log('p2 has decrypted messages:', p2HasKey)

  // --- User2 sends a message ---
  const textarea = p2.locator('textarea').first()
  await textarea.fill(msg)
  await p2.locator('button[title="Отправить"], button:has(svg)').last().click()
  await p2.waitForTimeout(5000)

  // Check if message appears in p2's chat
  const p2sent = await p2.evaluate((msg) => {
    const msgs = document.querySelectorAll('.message-text')
    for (const m of msgs) {
      if (m.textContent?.includes(msg)) return true
    }
    return false
  }, msg)
  console.log('p2 sent message visible:', p2sent)

  // --- Check if p1 received the message ---
  await p1.waitForTimeout(5000)
  const p1received = await p1.evaluate((msg) => {
    const msgs = document.querySelectorAll('.message-text')
    for (const m of msgs) {
      if (m.textContent?.includes(msg)) return true
    }
    return false
  }, msg)
  console.log('p1 received message:', p1received)

  // --- User1 sends a message back ---
  const p1msg = 'reply_' + ts
  const textarea1 = p1.locator('textarea').first()
  await textarea1.fill(p1msg)
  await p1.locator('button[title="Отправить"], button:has(svg)').last().click()
  await p1.waitForTimeout(5000)

  const p2receivedReply = await p2.evaluate((msg) => {
    const msgs = document.querySelectorAll('.message-text')
    for (const m of msgs) {
      if (m.textContent?.includes(msg)) return true
    }
    return false
  }, p1msg)
  console.log('p2 received reply:', p2receivedReply)

  // Summary
  console.log('---')
  console.log('RESULT:', p2HasKey && p2sent && p1received && p2receivedReply ? 'PASS' : 'FAIL')

  await browser.close()
})().catch(e => console.error('ERROR:', e.message))
