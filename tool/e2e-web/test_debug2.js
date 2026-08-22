const { chromium } = require('playwright-core')
const BASE = process.env.BASE_URL || 'http://localhost:8080'
const PASS = 'TestPass12345!@#'
const CHROME = '/Users/alex/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

;(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'], headless: true })
  const ts = Date.now()

  // User1
  const p1 = await browser.newPage()
  await p1.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p1.waitForTimeout(2000)
  await p1.getByText('Зарегистрироваться').first().click()
  await p1.getByPlaceholder('Ваш ник').fill('d1_' + ts)
  await p1.getByPlaceholder('Пароль').first().fill(PASS)
  await p1.getByPlaceholder('Ещё раз').fill(PASS)
  await p1.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await p1.waitForSelector('.sidebar', { timeout: 30000 })

  await p1.click('.add-btn')
  await p1.waitForSelector('input[placeholder="Название канала"]')
  await p1.fill('input[placeholder="Название канала"]', 'dbg-' + ts)
  await p1.getByRole('button', { name: 'Создать' }).click()
  await p1.waitForTimeout(3000)

  await p1.locator('textarea').click()
  await p1.locator('textarea').fill('Msg1')
  await p1.keyboard.press('Enter')
  await p1.waitForTimeout(3000)

  const chId = await p1.evaluate(async () => {
    const t = localStorage.getItem('golosloom-token')
    const chs = await fetch('/api/channels', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    return chs.find(c => c.is_member && c.name.startsWith('dbg-'))?.id
  })
  console.log('Channel:', chId)

  // User2
  const p2 = await browser.newPage()
  await p2.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p2.waitForTimeout(2000)
  await p2.getByText('Зарегистрироваться').first().click()
  await p2.getByPlaceholder('Ваш ник').fill('d2_' + ts)
  await p2.getByPlaceholder('Пароль').first().fill(PASS)
  await p2.getByPlaceholder('Ещё раз').fill(PASS)
  await p2.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await p2.waitForSelector('.sidebar', { timeout: 30000 })

  // Join + reload + wait
  await p2.evaluate(async (id) => {
    const t = localStorage.getItem('golosloom-token')
    await fetch('/api/channels/' + id + '/join', { method: 'POST', headers: { Authorization: 'Bearer ' + t } })
  }, chId)
  await p2.reload({ waitUntil: 'load' })
  await p2.waitForTimeout(8000)

  // Click channel
  await p2.locator('.chat-list .chat-row').filter({ hasText: 'dbg-' }).first().click()
  await p2.waitForTimeout(5000)

  // Check key status
  const keyStatus = await p2.evaluate(async (id) => {
    const t = localStorage.getItem('golosloom-token')
    const msgs = await fetch('/api/channels/' + id + '/messages', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    return { msgCount: msgs.length }
  }, chId)
  console.log('Before send:', JSON.stringify(keyStatus))

  // Send
  await p2.locator('textarea').click()
  await p2.locator('textarea').fill('Msg2')
  await p2.keyboard.press('Enter')
  await p2.waitForTimeout(5000)

  const after = await p2.evaluate(async (id) => {
    const t = localStorage.getItem('golosloom-token')
    const msgs = await fetch('/api/channels/' + id + '/messages', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json())
    return { count: msgs.length, senders: msgs.map(m => m.sender_nick) }
  }, chId)
  console.log('After send:', JSON.stringify(after))

  await browser.close()
})().catch(e => console.error('ERROR:', e.message))
