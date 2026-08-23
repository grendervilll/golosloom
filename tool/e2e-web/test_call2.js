const { chromium } = require('playwright-core')
const BASE = process.env.BASE_URL || 'http://localhost:8080'
const PASS = 'TestPass12345!@#'
const CHROME = '/Users/alex/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

;(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'], headless: true })
  const ts = Date.now()
  const p = await browser.newPage()
  p.on('console', m => {
    const t = m.text()
    if (t.includes('WebSocket') || t.includes('centrifuge') || t.includes('user:'))
      console.log('[' + m.type() + ']', t.slice(0, 200))
  })

  // Register
  await p.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p.waitForTimeout(2000)
  await p.getByText('Зарегистрироваться').first().click()
  await p.getByPlaceholder('Ваш ник').fill('cw2_' + ts)
  await p.getByPlaceholder('Пароль').first().fill(PASS)
  await p.getByPlaceholder('Ещё раз').fill(PASS)
  await p.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await p.waitForSelector('.sidebar', { timeout: 30000 })

  // Wait for WebSocket
  await p.waitForTimeout(15000)

  // Check if centrifuge is connected
  const info = await p.evaluate(() => {
    const store = window.__pinia
    if (!store) return { error: 'no pinia' }
    const state = store.state.value
    return {
      connected: state.auth?.connected,
      userId: state.auth?.user?.id,
    }
  })
  console.log('Auth:', JSON.stringify(info))

  // Test: try to trigger a call invite via API
  const token = await p.evaluate(() => localStorage.getItem('golosloom-token'))
  console.log('Token:', token ? 'yes' : 'no')

  // Create a channel and try to call
  await p.click('.add-btn')
  await p.waitForSelector('input[placeholder="Название канала"]')
  await p.fill('input[placeholder="Название канала"]', 'call-test-' + ts)
  await p.getByRole('button', { name: 'Создать' }).click()
  await p.waitForTimeout(3000)

  // Get channel ID
  const chId = await p.evaluate(async () => {
    const t = localStorage.getItem('golosloom-token')
    const chs = await fetch('/api/channels', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    return chs.find(c => c.is_member && c.name.startsWith('call-test-'))?.id
  })
  console.log('Channel:', chId)

  // Send a message to verify
  if (chId) {
    await p.locator('textarea').click()
    await p.locator('textarea').fill('Test call')
    await p.keyboard.press('Enter')
    await p.waitForTimeout(3000)
    const msgs = await p.evaluate(async (id) => {
      const t = localStorage.getItem('golosloom-token')
      return (await fetch('/api/channels/' + id + '/messages', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())).length
    }, chId)
    console.log('Messages:', msgs)
  }

  await browser.close()
  console.log('=== DONE ===')
})().catch(e => console.error('ERROR:', e.message))
