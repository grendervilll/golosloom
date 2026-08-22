import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { sounds } from './audio/sounds'
import './style.css'

// Разблокировка аудио жестом пользователя: без этого браузеры не дают
// заиграть звук входящего звонка, приходящий по WebSocket.
function unlockAudio() {
  sounds.unlock()
}
window.addEventListener('pointerdown', unlockAudio)
window.addEventListener('touchstart', unlockAudio)
window.addEventListener('keydown', unlockAudio)

// PWA: service worker только для http(s) (в Electron не нужен).
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  })
}

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
