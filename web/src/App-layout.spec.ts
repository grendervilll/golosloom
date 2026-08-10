// Регрессионный тест раскладки: Toaster (vue-sonner) рендерит <section> в потоке,
// и внутри flex-контейнера .app-root он попадал бы под правило .app-root > * { flex: 1 }
// и сжимал интерфейс в левую половину экрана.
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'

describe('корневая раскладка', () => {
  it('Toaster вне .app-root, внутри только RouterView', async () => {
    const pinia = createPinia()
    const wrapper = mount(App, { global: { plugins: [pinia, router] } })
    await router.isReady()
    await wrapper.vm.$nextTick()
    const root = wrapper.find('.app-root')
    expect(root.exists()).toBe(true)
    expect(root.element.children.length).toBe(1)
    const toaster = wrapper.find('section[aria-live="polite"]')
    expect(toaster.exists()).toBe(true)
    expect(toaster.element.parentElement?.classList.contains('app-root')).toBe(false)
  })
})
