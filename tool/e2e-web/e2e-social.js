// E2E: личные сообщения, закрепление/перемещение/открепление чатов,
// сообщества (создание, публикация контента, подписка, отписка, readonly,
// счётчик подписчиков). Два пользователя в отдельных контекстах.
const { chromium } = require('playwright-core')
const { EXE, BASE, PNG_B64, ok, register, createChannel, finish } = require('./helpers')

async function pasteFiles(page, files) {
  await page.evaluate((filesInit) => {
    const dt = new DataTransfer()
    for (const f of filesInit) {
      let bytes
      if (f.data.startsWith('b64:')) bytes = Uint8Array.from(atob(f.data.slice(4)), (c) => c.charCodeAt(0))
      else bytes = new TextEncoder().encode(f.data)
      dt.items.add(new File([bytes], f.name, { type: f.type }))
    }
    const textarea = document.querySelector('textarea')
    const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'clipboardData', { value: dt })
    textarea.dispatchEvent(ev)
  }, files)
}

async function openBurgerItem(page, label) {
  await page.click('.burger', { force: true })
  await page.getByText(label).first().click()
}

// Ввод в чат: fill() во время переключения канала нестабилен (DOM-чарн) —
// печатаем клавиатурой.
async function typeChat(page, text) {
  await page.click('.input-pill textarea')
  await page.keyboard.type(text)
}

// Переключение кнопки отправки в режим микрофона/камеры (ПКМ) и запись.
async function recordAndSend(page, mode, ms, text) {
  for (let i = 0; i < 3 && !(await page.$(`.send-btn.mode-${mode}`)); i++) {
    await page.click('.send-btn', { button: 'right', force: true })
    await page.waitForTimeout(200)
  }
  await page.waitForSelector(`.send-btn.mode-${mode}`, { timeout: 3000 })
  if (text) await typeChat(page, text)
  await page.click('.send-btn')
  await page.waitForSelector('.rec-hint', { timeout: 4000 })
  await page.waitForTimeout(ms)
  await page.click('.send-btn')
}

;(async () => {
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--no-sandbox', '--disable-web-security'],
  })
  const pageA = await browser.newPage()
  const pageB = await browser.newPage()
  pageA.on('pageerror', (e) => console.log('[pageerror A]', e.message))
  pageB.on('pageerror', (e) => console.log('[pageerror B]', e.message))
  pageA.on('dialog', (d) => d.accept())
  pageB.on('dialog', (d) => d.accept())

  await register(pageA, 'Ann' + Date.now().toString().slice(-4))
  console.log('A registered (admin)')
  await createChannel(pageA, 'Общий канал')
  await register(pageB, 'Bob' + Date.now().toString().slice(-4))
  console.log('B registered')

  // ================= ЛИЧНЫЕ СООБЩЕНИЯ =================
  // A ищет B по нику.
  await openBurgerItem(pageA, 'Найти контакт')
  await pageA.waitForSelector('.search-input', { timeout: 3000 })
  await pageA.fill('.search-input', 'Bob')
  await pageA.waitForSelector('.search-row', { timeout: 5000 })
  const bobRow = pageA.locator('.search-row', { hasText: 'Bob' }).first()
  await bobRow.click()
  // Переключение на DM асинхронное — ждём заголовок личного чата
  // (ник в канале хранится в нижнем регистре).
  await pageA.waitForFunction(
    () => document.querySelector('.chat-head h2')?.textContent.toLowerCase().includes('и bob'),
    null,
    { timeout: 10000 },
  )
  const dmName = await pageA.textContent('.chat-head h2')
  ok('DM с Бобом создан', (dmName || '').toLowerCase().includes('и bob'), 'name=' + dmName)

  // Ждём полной загрузки канала (история пуста) — отправка до этого гоняется.
  await pageA.waitForSelector('.muted.empty', { timeout: 8000 })

  // A пишет в DM.
  await typeChat(pageA, 'привет, Боб! это личный чат')
  await pageA.press('textarea', 'Enter')
  await pageA.waitForSelector('.msg .text:has-text("привет, Боб!")', { timeout: 8000 })
  ok('A отправил сообщение в DM', true)

  // B: перезагрузка → DM виден, сообщение получено после открытия.
  await pageB.reload({ waitUntil: 'load' })
  await pageB.waitForSelector('.chat-row', { timeout: 10000 })
  await pageB.locator('.chat-row:has(.kind-ico)').first().click()
  await pageB.waitForSelector('.msg .text:has-text("привет, Боб!")', { timeout: 8000 })
  ok('B видит DM и сообщение', true)
  await typeChat(pageB, 'привет, Ann! отвечаю')
  await pageB.press('textarea', 'Enter')
  await pageB.waitForSelector('.msg .text:has-text("привет, Ann!")', { timeout: 8000 })
  await pageA.waitForSelector('.msg .text:has-text("привет, Ann!")', { timeout: 8000 })
  ok('B ответил, A получил ответ в DM', true)

  // Звонок в DM: кнопка есть, пикер показывает участника.
  await pageA.click('.chat-head .icon-btn[title*="Позвонить"]')
  await pageA.waitForSelector('[role="dialog"]', { timeout: 5000 })
  await pageA.waitForTimeout(400)
  const callTargets = await pageA.evaluate(() => document.body.innerText.toLowerCase().includes('bob'))
  ok('в DM доступен звонок (пикер с участником)', callTargets)
  await pageA.keyboard.press('Escape')
  await pageA.waitForTimeout(400)

  // ================= ЗАКРЕПЛЕНИЕ =================
  const pinnedNames = () =>
    pageA.evaluate(() =>
      [...document.querySelectorAll('.pinned-row .chat-name')].map((e) => e.textContent.trim()),
    )

  // Закрепляем DM (ПКМ → Закрепить).
  const dmRow = pageA.locator('.chat-row:has(.kind-ico)').first()
  await dmRow.click({ button: 'right' })
  await pageA.waitForSelector('.row-ctx', { timeout: 3000 })
  await pageA.getByRole('button', { name: 'Закрепить', exact: true }).click()
  await pageA.waitForSelector('.pinned-row', { timeout: 3000 })
  ok('DM закреплён (появилась секция «Закреплённые»)', true)

  // Закрепляем «Общий канал».
  const chanRow = pageA.locator('.chat-row', { hasText: 'общий канал' }).first()
  await chanRow.click({ button: 'right' })
  await pageA.getByRole('button', { name: 'Закрепить', exact: true }).click()
  await pageA.waitForTimeout(500)
  ok('закреплены оба чата', (await pageA.locator('.pinned-row').count()) === 2)

  // Порядок: DM закреплён раньше — он выше.
  const order1 = await pinnedNames()
  ok('порядок закреплённых: DM выше канала', order1[0].includes('и bob') && order1[1].includes('общий канал'), order1.join(' | '))

  // Перемещение: тянем DM (nth 0) на место канала (nth 1).
  const dt = await pageA.evaluateHandle(() => new DataTransfer())
  await pageA.locator('.pinned-row').nth(0).dispatchEvent('dragstart', { dataTransfer: dt })
  await pageA.locator('.pinned-row').nth(1).dispatchEvent('dragover', { dataTransfer: dt })
  await pageA.locator('.pinned-row').nth(1).dispatchEvent('drop', { dataTransfer: dt })
  await pageA.waitForTimeout(400)
  const order2 = await pinnedNames()
  ok('перемещение работает: канал выше DM', order2[0].includes('общий канал') && order2[1].includes('и bob'), order2.join(' | '))

  // Перезагрузка: порядок сохранился.
  await pageA.reload({ waitUntil: 'load' })
  await pageA.waitForSelector('.pinned-row', { timeout: 10000 })
  const order3 = await pinnedNames()
  ok('порядок закреплённых сохранился после перезагрузки', order3[0].includes('общий канал') && order3[1].includes('и bob'), order3.join(' | '))

  // Открепление канала.
  const chanRow2 = pageA.locator('.pinned-row', { hasText: 'общий канал' }).first()
  await chanRow2.click({ button: 'right' })
  await pageA.waitForSelector('.row-ctx', { timeout: 3000 })
  await pageA.getByRole('button', { name: 'Открепить', exact: true }).click()
  await pageA.waitForTimeout(400)
  const names4 = await pinnedNames()
  ok('открепление работает', names4.length === 1 && names4[0].includes('и bob'), names4.join(' | '))

  // ================= СООБЩЕСТВА =================
  // Создание сообщества.
  await openBurgerItem(pageA, 'Создать сообщество')
  await pageA.fill('input[placeholder="Название сообщества"]', 'Секта Енотов')
  await pageA.getByRole('button', { name: 'Создать', exact: true }).click()
  await pageA.waitForSelector('.readonly-bar', { timeout: 8000 }).catch(() => {})
  await pageA.waitForSelector('.chat-head h2:has-text("Секта Енотов")', { timeout: 8000 })
  ok('сообщество создано и открыто', true)
  await pageA.waitForSelector('.subs-count', { timeout: 5000 })
  const subs1 = await pageA.textContent('.subs-count')
  ok('счётчик: 1 подписчик', (subs1 || '').includes('1 подписчик'), subs1)

  // Публикация: просто текст.
  await typeChat(pageA, 'Добро пожаловать в сообщество')
  await pageA.press('textarea', 'Enter')
  await pageA.waitForSelector('.msg .text:has-text("Добро пожаловать")', { timeout: 8000 })
  ok('текст опубликован', true)

  // Текст + голосовое.
  await recordAndSend(pageA, 'mic', 2500, 'текст с голосовым')
  await pageA.waitForSelector('.voice-card', { timeout: 15000 })
  ok('голосовое с текстом опубликовано', true)

  // Текст + видео.
  await recordAndSend(pageA, 'cam', 2500, 'текст с видео')
  await pageA.waitForSelector('.att-video-btn', { timeout: 20000 })
  ok('видео с текстом опубликовано', true)

  // Текст + изображение.
  await pageA.click('textarea')
  await pasteFiles(pageA, [{ name: 'фото1.png', type: 'image/png', data: 'b64:' + PNG_B64 }])
  await pageA.waitForSelector('.paste-area', { timeout: 3000 })
  await typeChat(pageA, 'текст с картинкой')
  await pageA.press('textarea', 'Enter')
  await pageA.waitForSelector('.msg .text:has-text("текст с картинкой")', { timeout: 10000 })
  ok('текст + изображение опубликовано', true)

  // Просто изображение.
  await pasteFiles(pageA, [{ name: 'фото2.png', type: 'image/png', data: 'b64:' + PNG_B64 }])
  await pageA.waitForSelector('.paste-area', { timeout: 3000 })
  await pageA.press('textarea', 'Enter')
  await pageA.waitForFunction(() => document.querySelectorAll('.att-img').length >= 2, null, { timeout: 10000 })
  ok('изображение без текста опубликовано', true)

  // Изменение сообщения.
  const firstTextMsg = pageA.locator('.msg .text:has-text("Добро пожаловать")').first()
  await firstTextMsg.click({ button: 'right' })
  await pageA.waitForSelector('.ctx-menu', { timeout: 3000 })
  await pageA.getByRole('button', { name: 'Изменить сообщение' }).click()
  await typeChat(pageA, 'Добро пожаловать (обновлено)')
  await pageA.press('textarea', 'Enter')
  await pageA.waitForSelector('.msg .text:has-text("обновлено")', { timeout: 8000 })
  const edited = await pageA.evaluate(() => document.body.innerText.includes('изменено'))
  ok('сообщение изменено (метка «изменено»)', edited)

  // B: сообщества не видно.
  const bHasCommunity = await pageB.evaluate(() => document.body.innerText.includes('Секта Енотов'))
  ok('B не видит сообщество до подписки', !bHasCommunity)

  // B ищет сообщество по названию и подписывается.
  await openBurgerItem(pageB, 'Найти контакт')
  await pageB.waitForSelector('.search-input', { timeout: 3000 })
  await pageB.fill('.search-input', 'Секта')
  await pageB.waitForSelector('.search-row', { timeout: 5000 })
  const commRow = pageB.locator('.search-row', { hasText: 'Секта Енотов' }).first()
  const commId = (await commRow.textContent()).match(/ID (\d+)/)?.[1]
  ok('в результатах поиска виден ID сообщества', !!commId, 'id=' + commId)
  await commRow.click()
  await pageB.waitForSelector('.chat-head h2:has-text("Секта Енотов")', { timeout: 8000 })
  ok('B подписался и открыл сообщество', true)

  // B видит контент, но не может писать (readonly).
  await pageB.waitForSelector('.msg .text:has-text("обновлено")', { timeout: 10000 })
  ok('B читает сообщения сообщества', true)
  const roBar = await pageB.locator('.readonly-bar').count()
  const noInput = await pageB.locator('textarea').count()
  ok('B не может писать (readonly, без поля ввода)', roBar === 1 && noInput === 0)

  // Счётчик у A стал 2.
  await pageA.reload({ waitUntil: 'load' })
  await pageA.waitForSelector('.subs-count', { timeout: 10000 })
  const subs2 = await pageA.textContent('.subs-count')
  ok('счётчик: 2 подписчика', (subs2 || '').includes('2 подписчика'), subs2)

  // Поиск по ID.
  await openBurgerItem(pageB, 'Найти контакт')
  await pageB.fill('.search-input', commId || '3')
  await pageB.waitForTimeout(700)
  const idRow = await pageB.locator('.search-row', { hasText: 'Секта Енотов' }).count()
  ok('сообщество находится по ID', idRow > 0)
  await pageB.keyboard.press('Escape')
  await pageB.waitForTimeout(400)

  // B отписывается.
  const commRowB = pageB.locator('.chat-row', { hasText: 'Секта Енотов' }).first()
  await commRowB.click({ button: 'right' })
  await pageB.waitForSelector('.row-ctx', { timeout: 3000 })
  await pageB.getByRole('button', { name: 'Отписаться от сообщества' }).click()
  await pageB.waitForTimeout(1000)
  const bStillSees = await pageB.evaluate(() => document.querySelector('.sidebar')?.innerText.includes('Секта Енотов'))
  ok('B отписался: сообщества больше нет в меню', !bStillSees)

  // Счётчик вернулся к 1.
  await pageA.reload({ waitUntil: 'load' })
  await pageA.waitForSelector('.subs-count', { timeout: 10000 })
  const subs3 = await pageA.textContent('.subs-count')
  ok('счётчик снова 1 подписчик', (subs3 || '').includes('1 подписчик'), subs3)

  // Скрытые ссылки: сам B всё ещё не участник.
  const notMember = await pageB.locator('.chat-row', { hasText: 'Секта Енотов' }).count()
  ok('после отписки сообщество пропало из меню B', notMember === 0)

  await browser.close()
  finish()
})().catch((e) => { console.error('E2E ERROR:', e); process.exit(1) })
