import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import MainView from './views/MainView.vue'
import { useAuthStore } from './stores/auth'
import { useSettingsStore } from './stores/settings'
import { useCallStore } from './stores/calls'
import { router } from './router'

describe('мобильная навигация', () => {
  it('кнопка ✕ закрывает шторку участников', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuthStore()
    auth.token = 't'
    auth.user = { id: 1, nick: 'me', is_server_admin: false, server_banned: false, created_at: '' } as any
    const settings = useSettingsStore()
    settings.api = {} as any
    const wrapper = mount(MainView, { global: { plugins: [pinia, router] }, attachTo: document.body })
    await router.isReady()
    await wrapper.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 30))

    const tabs = wrapper.find('.mobile-tabbar').findAll('button')
    await tabs[2].trigger('click') // Участники
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.members-panel').exists()).toBe(true)

    await wrapper.find('.close-btn').trigger('click')
    await wrapper.vm.$nextTick()
    // Шторка закрыта: бэкдроп исчез, у панели снят класс open.
    expect(wrapper.find('.mobile-backdrop').exists()).toBe(false)
    expect(wrapper.find('.right-col').classes()).not.toContain('open')

    wrapper.unmount()
    document.body.innerHTML = ''
  })

  it('во время звонка таб «Чат» показывает чат и кнопку возврата к звонку', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuthStore()
    auth.token = 't'
    auth.user = { id: 1, nick: 'me', is_server_admin: false, server_banned: false, created_at: '' } as any
    const settings = useSettingsStore()
    settings.api = {} as any
    const calls = useCallStore()
    calls.connectedCallId = 5
    const wrapper = mount(MainView, { global: { plugins: [pinia, router] }, attachTo: document.body })
    await router.isReady()
    await wrapper.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 30))

    // Без видео сцена не показывается — чат занимает всю рабочую зону.
    expect(wrapper.find('.stage-wrap').exists()).toBe(false)
    expect(wrapper.find('.chat-panel').classes()).not.toContain('hidden')
    expect(wrapper.find('.chat-panel').classes()).not.toContain('call-video')

    // Видео появилось → сцена на 3/4, чат свёрнут в 1/4 (на мобильном скрыт).
    calls.videoCount = 2
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.stage-wrap').exists()).toBe(true)
    expect(wrapper.find('.chat-panel').classes()).toContain('call-video')
    expect(wrapper.find('.chat-panel').classes()).toContain('hidden')

    // Таб «Чат» → чат вместо сцены + кнопка возврата.
    const tabs = wrapper.find('.mobile-tabbar').findAll('button')
    await tabs[1].trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.chat-panel').classes()).not.toContain('hidden')
    expect(wrapper.find('.stage-wrap').classes()).toContain('hidden')
    expect(wrapper.find('.back-to-call').exists()).toBe(true)

    await wrapper.find('.back-to-call').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.stage-wrap').classes()).not.toContain('hidden')

    wrapper.unmount()
    document.body.innerHTML = ''
  })
  it('таб «Каналы» открывает шторку, повторный клик закрывает', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuthStore()
    auth.token = 't'
    auth.user = { id: 1, nick: 'me', is_server_admin: false, server_banned: false, created_at: '' } as any
    const settings = useSettingsStore()
    settings.api = {} as any
    const wrapper = mount(MainView, { global: { plugins: [pinia, router] }, attachTo: document.body })
    await router.isReady()
    await wrapper.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 30))

    const tabbar = wrapper.find('.mobile-tabbar')
    expect(tabbar.exists()).toBe(true)
    const tabs = tabbar.findAll('button')
    expect(tabs.length).toBe(3)

    const sidebar = wrapper.find('.sidebar')
    expect(sidebar.classes()).not.toContain('drawer-open')

    await tabs[0].trigger('click')
    await wrapper.vm.$nextTick()
    expect(sidebar.classes()).toContain('drawer-open')
    expect(wrapper.find('.mobile-backdrop').exists()).toBe(true)

    await tabs[0].trigger('click')
    await wrapper.vm.$nextTick()
    expect(sidebar.classes()).not.toContain('drawer-open')

    wrapper.unmount()
    document.body.innerHTML = ''
  })
})
