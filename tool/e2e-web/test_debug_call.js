const { chromium } = require('playwright-core')
const BASE = process.env.BASE_URL || 'http://localhost:8080'
const PASS = 'TestPass12345!@#'
const CHROME = '/Users/alex/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

;(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'], headless: true })
  const ts = Date.now()
  const p = await browser.newPage()
  p.on('console', m => console.log('[' + m.type() + ']', m.text().slice(0, 200)))

  await p.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p.waitForTimeout(2000)
  await p.getByText('Зарегистрироваться').first().click()
  await p.getByPlaceholder('Ваш ник').fill('fd_' + ts)
  await p.getByPlaceholder('Пароль').first().fill(PASS)
  await p.getByPlaceholder('Ещё раз').fill(PASS)
  await p.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await p.waitForSelector('.sidebar', { timeout: 30000 })
  await p.waitForTimeout(15000)

  // Test centrifugo subscribe directly
  const token = await p.evaluate(() => localStorage.getItem('golosloom-token'))
  const userId = await p.evaluate(async () => {
    const t = localStorage.getItem('golosloom-token')
    return (await fetch('/api/me', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())).id
  })
  console.log('User ID:', userId)

  // Test subscribe to user channel
  const subResult = await p.evaluate(async (userId) => {
    const t = localStorage.getItem('golosloom-token')
    const r = await fetch('/api/centrifugo/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
      body: JSON.stringify({ channel: 'user:' + userId })
    }).then(r => r.json())
    return r
  }, userId)
  console.log('Subscribe result:', JSON.stringify(subResult))

  await browser.close()
})().catch(e => console.error('ERROR:', e.message))
