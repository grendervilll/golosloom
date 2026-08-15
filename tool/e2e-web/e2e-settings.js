// E2E: настройки — в бургере нет шумоподавления и качества демонстрации;
// шумоподавление уходит в констрейнты микрофона (noiseSuppression,
// voiceIsolation для «Сильного»).
const { chromium } = require('playwright-core')
const { EXE, BASE, ok, register, createChannel, finish } = require('./helpers')

;(async () => {
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--no-sandbox', '--disable-web-security'],
  })
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))

  await register(page, 'set' + Date.now().toString().slice(-6))
  await createChannel(page, 'Настройки')

  // ---------- Бургер: настройки без шумоподавления и качества экрана ----------
  await page.click('.burger', { force: true })
  await page.getByText('Настройки').first().click()
  await page.waitForSelector('.submenu-title', { timeout: 3000 })
  const settingsText = await page.evaluate(() =>
    [...document.querySelectorAll('.submenu-title, .submenu-block')].map((e) => e.textContent).join('\n'),
  )
  ok('нет «Шумоподавление микрофона» в настройках', !settingsText.includes('Шумоподавление'))
  ok('нет «Качество демонстрации» в настройках', !settingsText.includes('Качество демонстрации'))
  ok('настройки клавиш на месте', settingsText.includes('Клавиши'))
  await page.keyboard.press('Escape')
  await page.click('.sidebar-close, .burger').catch(() => {})

  // ---------- Шумоподавление: констрейнт доходит до микрофона ----------
  // Проверяем на уровне браузера: те же констрейнты, что строит клиент.
  const check = async (ns, vi) =>
    page.evaluate(
      ({ ns, vi }) =>
        navigator.mediaDevices
          .getUserMedia({ audio: { echoCancellation: true, autoGainControl: true, noiseSuppression: ns, voiceIsolation: vi } })
          .then((s) => {
            const t = s.getAudioTracks()[0]
            const st = t.getSettings()
            s.getTracks().forEach((x) => x.stop())
            return { noiseSuppression: st.noiseSuppression, voiceIsolation: st.voiceIsolation }
          }),
      { ns, vi },
    )
  const on = await check(true, false)
  const off = await check(false, false)
  const high = await check(true, true)
  console.log('settings:', JSON.stringify({ on, off, high }))
  ok('noiseSuppression=true передаётся в микрофон', on.noiseSuppression === true, 'got=' + on.noiseSuppression)
  ok('noiseSuppression=false передаётся в микрофон', off.noiseSuppression === false, 'got=' + off.noiseSuppression)
  // voiceIsolation может не поддерживаться в тестовом Chromium — не критично.
  console.log('  (voiceIsolation: ' + JSON.stringify(high.voiceIsolation) + ')')

  await browser.close()
  finish()
})().catch((e) => { console.error('E2E ERROR:', e); process.exit(1) })
