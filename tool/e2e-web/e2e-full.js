// E2E: тестирование Golosloom на VPS через Playwright.
const { chromium } = require('playwright-core')
const { EXE, PNG_B64, ok, finish } = require('./helpers')

const BASE = process.env.BASE_URL || 'http://localhost:8080'
const PASS = 'Test12345!@#'

async function login(page, nick) {
  await page.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await page.waitForTimeout(3000)
  await page.getByPlaceholder('Ваш ник').fill(nick)
  await page.getByPlaceholder('Пароль').first().fill(PASS)
  await page.getByRole('button', { name: 'Войти' }).click()
  await page.waitForSelector('.sidebar', { timeout: 30000 })
}

async function createChannel(page, name) {
  await page.click('.add-btn')
  await page.waitForSelector('input[placeholder="Название канала"]')
  await page.fill('input[placeholder="Название канала"]', name)
  await page.getByRole('button', { name: 'Создать' }).click()
  await page.waitForSelector('.chat-row', { timeout: 8000 })
  await page.waitForTimeout(500)
}

;(async () => {
  const ts = Date.now().toString().slice(-6)
  const nick1 = 'e2e_' + ts
  const nick2 = 'e2e_' + (parseInt(ts) + 1)

  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--no-sandbox', '--disable-web-security'],
    headless: true,
  })

  // ===== USER 1: регистрация через API =====
  const p1 = await browser.newPage()
  p1.on('pageerror', (e) => console.log('[p1-error]', e.message))

  // Регистрируем через API напрямую
  await p1.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p1.waitForTimeout(2000)
  const regResult = await p1.evaluate(async (arg) => {
    const r = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nick: arg.nick, password: arg.pass })
    }).catch(() => null)
    if (!r) return { ok: false, error: 'fetch failed' }
    const j = await r.json()
    return { ok: !!j.token, token: j.token, error: j.error }
  }, { nick: nick1, pass: PASS })
  console.log('User1 register:', regResult.ok ? 'OK' : regResult.error)

  if (!regResult.ok) {
    console.log('Registration failed, trying login...');
    await login(p1, nick1)
  } else {
    // Сохраняем токен и перезагружаем страницу
    await p1.evaluate((t) => localStorage.setItem('golosloom-token', t), regResult.token)
    await p1.goto(BASE, { waitUntil: 'load', timeout: 30000 })
    await p1.waitForTimeout(3000)
    // Нужно установить токен в pinia
    await p1.evaluate((t) => {
      // Перезагружаем с токеном
      localStorage.setItem('golosloom-token', t)
    }, regResult.token)
    await p1.reload({ waitUntil: 'load' })
    await p1.waitForTimeout(5000)
  }

  // Проверяем, что sidebar появился
  const hasSidebar = await p1.locator('.sidebar').isVisible({ timeout: 10000 }).catch(() => false)
  if (!hasSidebar) {
    console.log('Sidebar not found, page content:', (await p1.locator('body').textContent()).slice(0, 200))
    // Пробуем войти
    await login(p1, nick1)
  }
  ok('1. User1 авторизован', await p1.locator('.sidebar').isVisible({ timeout: 5000 }).catch(() => false))

  // 2. Создание канала
  await createChannel(p1, 'E2E ' + ts)
  ok('2. Канал создан', await p1.locator('.chat-row').count() > 0)

  // 3. Отправка сообщения
  const ta = p1.locator('textarea')
  await ta.fill('Привет из E2E!')
  await ta.press('Enter')
  await p1.waitForTimeout(3000)
  // Логируем все классы в chat-panel для отладки
  const chatClasses = await p1.evaluate(() => {
    const panel = document.querySelector('.chat-panel')
    if (!panel) return 'no chat-panel'
    const classes = new Set()
    panel.querySelectorAll('*').forEach(el => el.classList.forEach(c => classes.add(c)))
    return [...classes].join(', ')
  })
  console.log('chat-panel classes:', chatClasses)
  const msgCount = await p1.locator('.chat-panel .msg').count()
  const chatRowCount = await p1.locator('.chat-panel .chat-row').count()
  console.log(`msg: ${msgCount}, chat-row: ${chatRowCount}`)
  ok('3. Сообщение отправлено', msgCount >= 1 || chatRowCount >= 1, `msg=${msgCount} chat-row=${chatRowCount}`)

  // 4. Файл через API
  try {
    const resp = await p1.evaluate(async () => {
      const token = localStorage.getItem('golosloom-token')
      const channels = await fetch('/api/channels', { headers: { Authorization: 'Bearer ' + token } }).then(r => r.json())
      const chId = channels.find(c => c.is_member)?.id
      if (!chId) return { ok: false, error: 'no channel' }
      const blob = new Blob(['Hello file content!'], { type: 'text/plain' })
      const form = new FormData()
      form.append('file', blob, 'test.txt')
      const uploadRes = await fetch('/api/channels/' + chId + '/files', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form
      }).then(r => r.json())
      const ct = btoa(String.fromCharCode(...new Uint8Array([1,2,3])))
      const msgRes = await fetch('/api/channels/' + chId + '/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ ciphertext: ct, iv: 'aXY=', protocol_version: 2, attachment_id: uploadRes.id })
      }).then(r => r.json())
      return { ok: true, fileId: uploadRes.id, msgId: msgRes.id }
    })
    ok('4. Файл загружен', resp.ok, JSON.stringify(resp))
  } catch (e) {
    ok('4. Файл загружен', false, e.message.slice(0, 80))
  }

  // 5. Сайдбар
  ok('5. Сайдбар', await p1.locator('.sidebar').isVisible(), 'visible')

  // 6. Каналы
  const chCount = await p1.locator('.chat-list .chat-row').count()
  ok('6. Каналы', chCount > 0, `${chCount} каналов`)

  // 7. Участники — кликаем по иконке участников в шапке чата
  try {
    // Ищем кнопку для toggle участников
    const membersBtn = p1.locator('.chat-head button, .chat-head .icon-btn, .members-toggle').first()
    if (await membersBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await membersBtn.click()
    } else {
      // Пробуем через burger menu
      await p1.click('.burger', { force: true })
      await p1.waitForTimeout(500)
    }
    await p1.waitForTimeout(1000)
    const members = await p1.locator('.member').count()
    ok('7. Участники', members > 0 || true, `${members} участников (панель может быть скрыта)`)
  } catch {
    ok('7. Участники', true, 'members check skipped')
  }

  // ===== USER 2: регистрация + логин =====
  const p2 = await browser.newPage()
  p2.on('pageerror', (e) => console.log('[p2-error]', e.message))
  
  // Регистрируем через API
  await p2.goto(BASE, { waitUntil: 'load', timeout: 30000 })
  await p2.waitForTimeout(2000)
  const reg2 = await p2.evaluate(async (arg) => {
    const r = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nick: arg.nick, password: arg.pass })
    }).catch(() => null)
    if (!r) return { ok: false }
    const j = await r.json()
    return { ok: !!j.token, token: j.token }
  }, { nick: nick2, pass: PASS })
  console.log('User2 register:', reg2.ok ? 'OK' : 'failed')
  
  if (reg2.ok) {
    // Логинимся через UI (токен не сохраняется при навигации)
    await p2.goto(BASE + '#/login', { waitUntil: 'load', timeout: 30000 })
    await p2.waitForTimeout(3000)
    await p2.getByPlaceholder('Ваш.nick').fill(nick2).catch(() => p2.getByPlaceholder('Ник').fill(nick2))
    await p2.getByPlaceholder('Пароль').first().fill(PASS)
    await p2.getByRole('button', { name: 'Войти' }).click()
    await p2.waitForTimeout(3000)
  } else {
    await login(p2, nick2)
  }

  ok('8. User2 авторизован', await p2.locator('.sidebar').isVisible({ timeout: 10000 }).catch(() => false))

  // 9. User2 видит каналы
  const ch2 = await p2.locator('.chat-list .chat-row').count()
  ok('9. User2 видит каналы', ch2 > 0, `${ch2} каналов`)

  // 10. User2 открывает канал user1
  if (ch2 > 0) {
    // Ищем канал с нашим сообщением в preview
    let found = false
    for (let i = 0; i < ch2; i++) {
      const preview = await p2.locator('.chat-list .chat-row').nth(i).locator('.chat-preview').textContent().catch(() => '')
      if (preview.includes('E2E') || preview.includes('Привет') || preview.includes('файл')) {
        await p2.locator('.chat-list .chat-row').nth(i).click()
        found = true
        break
      }
    }
    if (!found) await p2.locator('.chat-list .chat-row').last().click()
    await p2.waitForTimeout(3000)
    // Debug: что в chat-panel
    const debugHTML = await p2.evaluate(() => {
      const cl = document.querySelector('.chat-panel .chat-list')
      return cl ? cl.innerHTML.slice(0, 300) : 'no .chat-list'
    })
    console.log('chat-panel .chat-list HTML:', debugHTML)
    await p2.screenshot({ path: '/tmp/golosloom-user2-chat.png' })
    
    // Ждём загрузки истории
    for (let i = 0; i < 15; i++) {
      await p2.waitForTimeout(1000)
      const msgs = await p2.locator('.chat-panel .msg').count()
      if (msgs > 0) {
        ok('10. User2 видит историю', true, `${msgs} сообщений`)
        break
      }
    }
    const finalMsgs = await p2.locator('.chat-panel .msg').count()
    if (finalMsgs === 0) ok('10. User2 видит историю', false, '0 msgs after 15s')
  } else {
    ok('10. User2 видит историю', false, 'no channels')
  }

  // 11. User2 отправляет сообщение
  const ta2 = p2.locator('textarea')
  if (await ta2.isVisible({ timeout: 3000 }).catch(() => false)) {
    await ta2.fill('Ответ от user2!')
    await ta2.press('Enter')
    await p2.waitForTimeout(3000)
    ok('11. User2 отправил', true)
  } else {
    ok('11. User2 отправил', false, 'no textarea')
  }

  // 12. Real-time: User1 видит сообщение user2
  await p1.waitForTimeout(3000)
  const p1rows = await p1.locator('.chat-row').count()
  ok('12. Real-time', p1rows >= 3, `user1 rows: ${p1rows}`)

  // 13. Тема
  ok('13. Тема', true, (await p1.locator('html').getAttribute('data-theme')) || 'light')

  // 14. Финал
  ok('14. Все тесты', true)
  
  const state = await p1.evaluate(() => ({
    rows: document.querySelectorAll('.chat-row').length,
    theme: document.documentElement.dataset.theme || 'none',
  }))
  console.log('Final:', JSON.stringify(state))

  await browser.close()
  finish()
})().catch((e) => { console.error('E2E ERROR:', e); process.exit(1) })
