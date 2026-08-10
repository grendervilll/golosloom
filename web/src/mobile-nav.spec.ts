import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import MainView from './views/MainView.vue'
import { useAuthStore } from './stores/auth'
import { useSettingsStore } from './stores/settings'
import { router } from './router'

describe('мобильная навигация', () => {
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
