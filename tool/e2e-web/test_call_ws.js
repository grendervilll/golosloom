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
    if (t.includes('WebSocket') || t.includes('centrifuge') || t.includes('connect') || t.includes('subscribe'))
      console.log('[' + m.type() + ']', t.slice(0, 200))
  })

  await p.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p.waitForTimeout(2000)
  await p.getByText('Зарегистрироваться').first().click()
  await p.getByPlaceholder('Ваш ник').fill('cw_' + ts)
  await p.getByPlaceholder('Пароль').first().fill(PASS)
  await p.getByPlaceholder('Ещё раз').fill(PASS)
  await p.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await p.waitForSelector('.sidebar', { timeout: 30000 })
  console.log('=== REGISTERED ===')

  await p.waitForTimeout(15000)

  const state = await p.evaluate(() => {
    const s = window.__pinia?.state?.value
    return {
      connected: s?.auth?.connected,
      userId: s?.auth?.user?.id,
      token: s?.auth?.token ? 'yes' : 'no',
    }
  })
  console.log('State:', JSON.stringify(state))

  await browser.close()
})().catch(e => console.error('ERROR:', e.message))
