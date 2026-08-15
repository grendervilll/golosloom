// E2E: админ-панель — плитки диска на вкладке «Сервер» (занято/свободно),
// файлы в отдельном попапе, выбор («Выбрать»/«Выбрать всё»), удаление
// выбранного, ПКМ-меню не выходит за экран, переход к сообщению.
const { chromium } = require('playwright-core')
const { EXE, BASE, PNG_B64, ok, register, createChannel, finish } = require('./helpers')

async function dragFile(page, name, type, data) {
  const dt = await page.evaluateHandle((f) => {
    const dt = new DataTransfer()
    const bytes = f.data.startsWith('b64:')
      ? Uint8Array.from(atob(f.data.slice(4)), (c) => c.charCodeAt(0))
      : new TextEncoder().encode(f.data)
    dt.items.add(new File([bytes], f.name, { type: f.type }))
    return dt
  }, { name, type, data })
  await page.dispatchEvent('.chat-panel', 'dragenter', { dataTransfer: dt })
  await page.dispatchEvent('.chat-panel', 'dragover', { dataTransfer: dt })
  await page.dispatchEvent('.chat-panel', 'drop', { dataTransfer: dt })
}

async function openAdmin(page) {
  for (let i = 0; i < 2; i++) {
    await page.click('.burger', { force: true })
    try {
      await page.getByText('Админ панель сервера').first().waitFor({ timeout: 1500 })
      await page.getByText('Админ панель сервера').first().click()
      await page.getByRole('button', { name: 'Сервер', exact: true }).waitFor({ timeout: 5000 })
      return
    } catch {
      /* меню было открыто — повторяем */
    }
  }
  throw new Error('не удалось открыть админ-панель')
}

;(async () => {
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--no-sandbox', '--disable-web-security'],
  })
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  page.on('dialog', (d) => d.accept())

  await register(page, 'adm' + Date.now().toString().slice(-6))
  await createChannel(page, 'Файлы')
  console.log('registered, channel created')

  // Файлы в чат (дроп открывает область, отправка Enter'ом).
  const send = async (name, type, data) => {
    await dragFile(page, name, type, data)
    await page.waitForSelector('.paste-area', { timeout: 3000 })
    await page.press('textarea', 'Enter')
  }
  await send('main.go', 'text/plain', 'package main\nfunc main() { println("hi") }\n')
  await page.waitForSelector('.file-card .file-name:has-text("main.go")', { timeout: 10000 })
  await send('фото.png', 'image/png', 'b64:' + PNG_B64)
  await page.waitForSelector('.att-img', { timeout: 10000 })
  await send('заметки.txt', 'text/plain', 'обычный текст')
  await page.waitForSelector('.file-card .file-name:has-text("заметки.txt")', { timeout: 10000 })

  // ---------- Плитки диска на вкладке «Сервер» ----------
  await openAdmin(page)
  await page.getByRole('button', { name: 'Сервер', exact: true }).click()
  await page.waitForSelector('.disk-tile', { timeout: 5000 })
  const tiles = await page.evaluate(() =>
    [...document.querySelectorAll('.disk-tile')].map((t) => t.textContent.trim()),
  )
  console.log('tiles:', JSON.stringify(tiles))
  ok('две плитки: БД и файлы пользователей', tiles.length === 2)
  ok('в плитке числа «занято / свободно»',
    tiles.every((t) => /\d/.test(t) && t.includes('/')), tiles.join(' | '))

  // ---------- Файлы в отдельном попапе ----------
  await page.getByRole('button', { name: 'Файлы', exact: true }).click()
  await page.waitForSelector('.files-body .file-tile', { timeout: 8000 })
  ok('файлы открылись отдельным попапом', await page.locator('.file-tile').first().isVisible())

  const counts = async (cat) => {
    await page.locator('.file-cats button', { hasText: cat }).click()
    await page.waitForTimeout(200)
    return await page.locator('.files-body .file-tile').count()
  }
  ok('«Все»: 3 файла', (await counts('Все')) === 3)
  ok('«Фото»: 1 файл', (await counts('Фото')) === 1)
  ok('«Текстовые»: 2 файла', (await counts('Текстовые')) === 2)
  await page.locator('.file-cats button', { hasText: 'Все' }).click()
  await page.waitForTimeout(200)

  // ПКМ-меню видно на экране.
  const tile = page.locator('.files-body .file-tile').last()
  const box = await tile.boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
  await page.waitForSelector('.files-ctx', { timeout: 3000 })
  const menuBox = await page.locator('.files-ctx').boundingBox()
  ok('ПКМ-меню видно на экране', menuBox && menuBox.x >= 0 && menuBox.x + menuBox.width <= 1280, JSON.stringify(menuBox))
  await page.click('.files-body', { position: { x: 5, y: 5 } })
  await page.waitForSelector('.files-ctx', { state: 'detached', timeout: 3000 })

  // ---------- Выбор и удаление ----------
  await page.getByRole('button', { name: 'Выбрать', exact: true }).click()
  await page.waitForSelector('.select-btn.active', { timeout: 3000 })
  ok('«Выбрать» превратилась в «Выбрать всё»', await page.getByRole('button', { name: 'Выбрать всё' }).isVisible())
  await page.locator('.files-body .file-tile').first().click()
  ok('клик выделяет файл по одному', (await page.locator('.file-tile.sel').count()) === 1)
  ok('при одном выборе кнопка «Удалить»', ((await page.textContent('.del-btn')) || '').trim() === 'Удалить')
  await page.getByRole('button', { name: 'Выбрать всё' }).click()
  ok('«Выбрать всё» выделило все файлы', (await page.locator('.file-tile.sel').count()) === 3)
  ok('при нескольких — «Удалить выбранное»', ((await page.textContent('.del-btn')) || '').trim() === 'Удалить выбранное')
  await page.locator('.file-cats button', { hasText: 'Фото' }).click()
  await page.waitForTimeout(200)
  ok('смена категории сбросила выбор', (await page.locator('.file-tile.sel').count()) === 0)
  await page.getByRole('button', { name: 'Выбрать всё' }).click()
  ok('в «Фото» выбрано только фото', (await page.locator('.file-tile.sel').count()) === 1)
  await page.click('.del-btn')
  await page.waitForTimeout(1200)
  ok('фото удалено', (await page.locator('.files-body .file-tile').count()) === 0)
  await page.locator('.file-cats button', { hasText: 'Все' }).click()
  await page.waitForTimeout(200)
  ok('в «Все» осталось 2 файла', (await page.locator('.files-body .file-tile').count()) === 2)
  await page.keyboard.press('Escape')
  await page.waitForSelector('.att-deleted', { timeout: 8000 })
  ok('в чате пометка об удалении файла', (await page.textContent('.att-deleted')).includes('Файл был удалён'))

  // ---------- Переход к сообщению ----------
  await openAdmin(page)
  await page.getByRole('button', { name: 'Файлы', exact: true }).click()
  await page.waitForSelector('.files-body .file-tile', { timeout: 8000 })
  const txt = page.locator('.files-body .file-tile', { hasText: 'заметки.txt' })
  const b = await txt.boundingBox()
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' })
  await page.getByRole('button', { name: 'Перейти к сообщению' }).click()
  await page.waitForSelector('.msg.flash', { timeout: 8000 })
  ok('переход к сообщению работает из отдельного попапа', true)

  await browser.close()
  finish()
})().catch((e) => { console.error('E2E ERROR:', e); process.exit(1) })
