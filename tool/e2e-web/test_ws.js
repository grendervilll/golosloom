const { chromium } = require('playwright-core')
const BASE = process.env.BASE_URL || 'http://localhost:8080'
const PASS = 'Test12345!@#'
const CHROME = '/Users/alex/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

;(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'], headless: true })
  const p = await browser.newPage()
  const wsErrors = []
  p.on('console', m => { if (m.text().includes('WebSocket')) wsErrors.push(m.text().slice(0, 80)) })
  
  await p.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p.waitForTimeout(2000)
  await p.getByPlaceholder('Ваш ник').fill('testuser1')
  await p.getByPlaceholder('Пароль').first().fill(PASS)
  await p.getByRole('button', { name: 'Войти' }).click()
  await p.waitForSelector('.sidebar', { timeout: 30000 })
  
  // Ждём 10 секунд для WebSocket подключения
  await p.waitForTimeout(10000)
  
  console.log('WebSocket errors:', wsErrors.length)
  if (wsErrors.length > 0) {
    console.log('First error:', wsErrors[0])
  } else {
    console.log('NO WebSocket errors - connection OK!')
  }
  
  await browser.close()
})().catch(e => console.error('ERROR:', e.message))
