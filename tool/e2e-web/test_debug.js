const { chromium } = require('playwright-core')
const BASE = 'https://gl.netbird.mhspx.ru'
const PASS = 'Test12345!@#'
const CHROME = '/Users/alex/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

;(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'], headless: true })
  const p = await browser.newPage()
  p.on('console', m => { if (m.text().includes('chat') || m.text().includes('key') || m.text().includes('send')) console.log('[' + m.type() + ']', m.text().slice(0, 150)) })
  
  await p.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p.waitForTimeout(2000)
  await p.getByText('Зарегистрироваться').first().click()
  await p.getByPlaceholder('Ваш ник').fill('dbg_' + Date.now().toString().slice(-6))
  await p.getByPlaceholder('Пароль').first().fill(PASS)
  await p.getByPlaceholder('Ещё раз').fill(PASS)
  await p.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await p.waitForSelector('.sidebar', { timeout: 30000 })
  
  // Входим в канал 472
  await p.locator('.chat-list .chat-row').filter({ hasText: 'TEST-' }).first().click()
  await p.waitForTimeout(5000)
  
  // Отправляем
  await p.locator('textarea').click()
  await p.locator('textarea').fill('Debug test')
  await p.keyboard.press('Enter')
  await p.waitForTimeout(3000)
  
  // Проверяем
  const result = await p.evaluate(async () => {
    const t = localStorage.getItem('golosloom-token')
    const me = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    const chs = await fetch('/api/channels', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    const ch = chs.find(c => c.is_member && c.name.startsWith('TEST-'))
    if (!ch) return { error: 'no channel' }
    const msgs = await fetch('/api/channels/' + ch.id + '/messages', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    // Пробуем отправить через API напрямую
    const ct = btoa(String.fromCharCode(1,2,3))
    const sendRes = await fetch('/api/channels/' + ch.id + '/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
      body: JSON.stringify({ ciphertext: ct, iv: 'aXY=', protocol_version: 2 })
    }).then(r => r.json())
    return { msgs: msgs.length, sendRes: sendRes }
  })
  console.log('Result:', JSON.stringify(result))
  
  await browser.close()
})().catch(e => console.error('ERROR:', e.message))
