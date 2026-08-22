const { chromium } = require('playwright-core')
const BASE = 'https://gl.netbird.mhspx.ru'
const PASS = 'TestPass12345!@#'
const CHROME = '/Users/alex/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

;(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'], headless: true })
  const p = await browser.newPage()
  
  // Перехватываем все WebSocket подключения
  await p.route('**/*', route => {
    const url = route.request().url()
    if (url.includes('websocket') || url.includes('centrifugo')) {
      console.log('WS REQUEST:', route.request().method(), url)
    }
    route.continue()
  })
  
  await p.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p.waitForTimeout(2000)
  await p.getByPlaceholder('Ваш ник').fill('testuser1')
  await p.getByPlaceholder('Пароль').first().fill(PASS)
  await p.getByRole('button', { name: 'Войти' }).click()
  await p.waitForSelector('.sidebar', { timeout: 30000 })
  
  await p.waitForTimeout(10000)
  
  await browser.close()
})().catch(e => console.error('ERROR:', e.message))
