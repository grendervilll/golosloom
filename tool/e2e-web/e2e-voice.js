// E2E: голосовые/видео-сообщения и плеер (автозапуск, шкала, перемотка,
// скорость), попап видео. Запуск: node e2e-voice.js (нужен dev-сервер и
// go-сервер на :8080, Chromium из ms-playwright).
const { chromium } = require('playwright-core')
const { EXE, BASE, ok, register, createChannel, finish } = require('./helpers')

;(async () => {
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--disable-web-security'],
  })
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))

  await register(page, 'voice' + Date.now().toString().slice(-6))
  console.log('registered')
  await createChannel(page, 'Звонок')

  // ПКМ по кнопке отправки → режим микрофона.
  await page.click('.send-btn', { button: 'right', force: true })
  await page.waitForSelector('.send-btn.mode-mic', { timeout: 3000 })
  ok('ПКМ переключил в режим микрофона', true)

  await page.click('.send-btn')
  await page.waitForSelector('.rec-hint', { timeout: 3000 })
  ok('запись голоса началась (индикатор)', true)
  await page.waitForTimeout(3000)
  await page.click('.send-btn')
  await page.waitForSelector('.voice-card', { timeout: 10000 })
  ok('голосовое сообщение появилось в чате', true)

  // Автозапуск плеера.
  await page.click('.voice-card')
  await page.waitForSelector('.audio-player', { timeout: 3000 })
  await page.waitForTimeout(1200)
  const t1 = await page.evaluate(() => {
    const a = document.querySelector('.audio-player audio')
    const r = document.querySelector('.ap-range')
    return a && r ? { dur: a.duration, cur: a.currentTime, paused: a.paused, max: r.max, val: r.value } : null
  })
  ok('длительность определена (>1с)', t1 && t1.dur > 1, 'dur=' + t1?.dur)
  ok('воспроизведение идёт (currentTime>0)', t1 && t1.cur > 0, 'cur=' + t1?.cur)
  ok('шкала заполняется (max=длительность)', t1 && Number(t1.max) === t1.dur && Number(t1.val) > 0, `max=${t1?.max} val=${t1?.val}`)

  // Перемотка.
  await page.evaluate(() => {
    const r = document.querySelector('.ap-range')
    const a = document.querySelector('.audio-player audio')
    if (r && a) {
      r.value = String(Number(r.max) * 0.5)
      r.dispatchEvent(new Event('input', { bubbles: true }))
    }
  })
  await page.waitForTimeout(400)
  const afterSeek = await page.evaluate(() => document.querySelector('.audio-player audio')?.currentTime || 0)
  ok('перемотка работает (~50%)', Math.abs(afterSeek - t1.dur * 0.5) < 0.6, 'afterSeek=' + afterSeek)

  // Скорость.
  await page.click('.speed-btn')
  await page.waitForSelector('.speed-drop', { timeout: 2000 })
  await page.click('.speed-drop button:nth-child(2)')
  await page.click('.speed-btn')
  await page.getByPlaceholder('Своя скорость…').fill('2')
  await page.click('.speed-ok')
  const rate = await page.evaluate(() => document.querySelector('.audio-player audio')?.playbackRate || 0)
  ok('скорость 2х применена', rate === 2, 'rate=' + rate)
  await page.click('.speed-btn')
  await page.getByPlaceholder('Своя скорость…').fill('5')
  await page.click('.speed-ok')
  const errText = await page.textContent('.speed-error').catch(() => null)
  ok('ошибка при скорости >3х', (errText || '').includes('Нельзя ускорить больше чем в 3 раза'), 'err=' + errText)
  await page.click('.audio-player .close')
  await page.waitForSelector('.audio-player', { state: 'detached', timeout: 3000 })

  // Видео-сообщение.
  for (let i = 0; i < 3 && !(await page.$('.send-btn.mode-cam')); i++) {
    await page.click('.send-btn', { button: 'right', force: true })
    await page.waitForTimeout(200)
  }
  await page.waitForSelector('.send-btn.mode-cam', { timeout: 3000 })
  ok('ПКМ переключил в режим камеры', true)
  await page.click('.send-btn')
  await page.waitForSelector('.rec-hint', { timeout: 4000 })
  await page.waitForTimeout(3000)
  await page.click('.send-btn')
  await page.waitForSelector('.att-video-btn', { timeout: 15000 })
  ok('видео-сообщение появилось в чате', true)

  await page.click('.att-video-btn')
  await page.waitForSelector('.vpop', { timeout: 3000 })
  await page.waitForTimeout(1500)
  const v = await page.evaluate(() => {
    const vid = document.querySelector('.vpop video')
    const r = document.querySelector('.vpop-range')
    return vid && r ? { dur: vid.duration, cur: vid.currentTime, paused: vid.paused, max: r.max } : null
  })
  ok('попап видео открылся', !!v)
  ok('длительность видео определена (>1с)', v && v.dur > 1, 'dur=' + v?.dur)
  ok('видео играет (currentTime>0)', v && v.cur > 0, 'cur=' + v?.cur)
  await page.keyboard.press('Escape')
  await page.waitForSelector('.vpop', { state: 'detached', timeout: 3000 })

  await browser.close()
  finish()
})().catch((e) => { console.error('E2E ERROR:', e); process.exit(1) })
