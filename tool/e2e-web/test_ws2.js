const { chromium } = require('playwright-core')
const BASE = process.env.BASE_URL || 'http://localhost:8080'
const PASS = 'Test12345!@#'
const CHROME = '/Users/alex/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

;(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'], headless: true })
  const p = await browser.newPage()
  const wsErrors = []
  p.on('console', m => { if (m.text().includes('WebSocket')) wsErrors.push(m.text()) })
  
  await p.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p.waitForTimeout(2000)
  await p.getByPlaceholder('Ваш ник').fill('testuser1')
  await p.getByPlaceholder('Пароль').first().fill(PASS)
  await p.getByRole('button', { name: 'Войти' }).click()
  await p.waitForSelector('.sidebar', { timeout: 30000 })
  
  await p.waitForTimeout(10000)
  
  console.log('Errors:', wsErrors.length)
  wsErrors.forEach((e, i) => console.log(`[${i}]`, e))
  
  await browser.close()
})().catch(e => console.error('ERROR:', e.message))
