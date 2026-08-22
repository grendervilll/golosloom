const { chromium } = require('playwright-core')
const BASE = process.env.BASE_URL || 'http://localhost:8080'
const PASS = 'Test12345!@#'
const CHROME = '/Users/alex/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

;(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'], headless: true })
  const p = await browser.newPage()
  p.on('console', m => console.log('[' + m.type() + ']', m.text().slice(0, 100)))
  
  await p.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p.waitForTimeout(3000)
  
  // Проверяем что на странице
  const bodyText = await p.locator('body').textContent()
  console.log('Page text:', bodyText.slice(0, 200))
  
  // Пробуем войти
  await p.getByPlaceholder('Ваш ник').fill('testuser1')
  await p.getByPlaceholder('Пароль').first().fill(PASS)
  await p.getByRole('button', { name: 'Войти' }).click()
  await p.waitForTimeout(5000)
  
  // Проверяем URL
  console.log('URL:', p.url())
  
  // Проверяем есть ли sidebar
  const hasSidebar = await p.locator('.sidebar').isVisible({ timeout: 3000 }).catch(() => false)
  console.log('Sidebar visible:', hasSidebar)
  
  // Проверяем ошибки
  const errorText = await p.locator('.error-text, .error').first().textContent().catch(() => 'none')
  console.log('Error:', errorText)
  
  await browser.close()
})().catch(e => console.error('ERROR:', e.message))
