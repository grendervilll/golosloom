const { chromium } = require('playwright-core')
const BASE = process.env.BASE_URL || 'http://localhost:8080'
const PASS = 'TestPass12345!@#'
const CHROME = '/Users/alex/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

;(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'], headless: true })
  const ts = Date.now()

  // Register user
  const p = await browser.newPage()
  p.on('console', m => { if (m.text().includes('chat') || m.text().includes('key')) console.log('[' + m.type() + ']', m.text().slice(0, 150)) })
  await p.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p.waitForTimeout(2000)
  await p.getByText('Зарегистрироваться').first().click()
  await p.getByPlaceholder('Ваш ник').fill('send_' + ts)
  await p.getByPlaceholder('Пароль').first().fill(PASS)
  await p.getByPlaceholder('Ещё раз').fill(PASS)
  await p.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await p.waitForSelector('.sidebar', { timeout: 30000 })

  // Create channel
  await p.click('.add-btn')
  await p.waitForSelector('input[placeholder="Название канала"]')
  await p.fill('input[placeholder="Название канала"]', 'send-' + ts)
  await p.getByRole('button', { name: 'Создать' }).click()
  await p.waitForTimeout(3000)

  // Send message
  await p.locator('textarea').click()
  await p.locator('textarea').fill('Test message')
  await p.keyboard.press('Enter')
  await p.waitForTimeout(3000)

  // Check result
  const result = await p.evaluate(async () => {
    const t = localStorage.getItem('golosloom-token')
    const chs = await fetch('/api/channels', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    const ch = chs.find(c => c.is_member && c.name.startsWith('send-'))
    if (!ch) return { error: 'no channel' }
    const msgs = await fetch('/api/channels/' + ch.id + '/messages', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    return { count: msgs.length, channel: ch.id }
  })
  console.log('Result:', JSON.stringify(result))

  await browser.close()
})().catch(e => console.error('ERROR:', e.message))
