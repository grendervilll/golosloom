// Общее для E2E-наборов: константы и хелперы.
const fs = require('fs')
const path = require('path')

const EXE =
  process.env.CHROME_EXE ||
  '/Users/alex/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

const BASE = process.env.BASE_URL || 'http://localhost:5173'

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

let fails = 0
function ok(name, cond, extra = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''))
  if (!cond) fails++
}

async function register(page, nick) {
  await page.goto(BASE, { waitUntil: 'load' })
  await page.getByText('Зарегистрироваться').first().click().catch(() => {})
  await page.getByPlaceholder('Ваш ник').fill(nick)
  await page.getByPlaceholder('Пароль').first().fill('Passw0rd!x123')
  await page.getByPlaceholder('Ещё раз').fill('Passw0rd!x123')
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await page.waitForSelector('.sidebar', { timeout: 10000 })
}

async function createChannel(page, name) {
  await page.click('.add-btn')
  await page.waitForSelector('input[placeholder="Название канала"]')
  await page.fill('input[placeholder="Название канала"]', name)
  await page.getByRole('button', { name: 'Создать' }).click()
  await page.waitForSelector('.chat-row', { timeout: 8000 })
  await page.waitForSelector('.bg-black\\/60', { state: 'detached', timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(500)
}

function launch(browser) {
  return browser.newPage()
}

function finish() {
  console.log(fails === 0 ? '\nALL PASSED' : '\nFAILURES: ' + fails)
  process.exit(fails === 0 ? 0 : 1)
}

module.exports = { EXE, BASE, PNG_B64, ok, register, createChannel, launch, finish, fs, path }
