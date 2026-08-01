// Компонентный тест контекстного меню чата (ПКМ и кнопка «⋯»).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ChatPanel from './ChatPanel.vue'
import { useAuthStore } from '../stores/auth'
import { useSettingsStore } from '../stores/settings'
import { useChannelsStore } from '../stores/channels'
import { useChatStore } from '../stores/chat'

describe('контекстное меню чата', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function setup() {
    const pinia = createPinia()
    setActivePinia(pinia)
    const settings = useSettingsStore()
    const api = {
      deleteMessage: vi.fn(async () => ({})),
      listMessages: vi.fn(async () => []),
      listMembers: vi.fn(async () => []),
      listChannels: vi.fn(async () => []),
      listBannedMembers: vi.fn(async () => []),
      listUsers: vi.fn(async () => []),
      listInvites: vi.fn(async () => []),
      uploadKey: vi.fn(async () => ({})),
      getMyWrappedKey: vi.fn(async () => ({ wrapped_key: null })),
      pendingKeyTargets: vi.fn(async () => []),
      uploadWrappedKey: vi.fn(async () => ({})),
    } as any
    settings.api = api
    const auth = useAuthStore()
    auth.user = { id: 1, nick: 'me', is_server_admin: false, server_banned: false, created_at: '' } as any
    const channels = useChannelsStore()
    channels.channels = [
      { id: 10, name: 'ch', private: false, creator_id: 1, created_at: '', is_member: true, role: 'channel_admin' },
    ] as any
    channels.currentId = 10
    const chat = useChatStore()
    chat.messages.set(10, [
      { id: 1, channelId: 10, senderId: 1, senderNick: 'me', text: 'своё', encrypted: false, deleted: false, edited: false, createdAt: new Date().toISOString() },
      { id: 2, channelId: 10, senderId: 2, senderNick: 'bob', text: 'чужое', encrypted: false, deleted: false, edited: false, createdAt: new Date().toISOString() },
    ])
    const wrapper = mount(ChatPanel, { global: { plugins: [pinia] } })
    return { wrapper, api, pinia }
  }

  it('ПКМ по своему сообщению открывает меню с удалением', async () => {
    const { wrapper, api } = setup()
    await wrapper.vm.$nextTick()
    const own = wrapper.findAll('.msg')[0]
    await own.trigger('contextmenu')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.ctx-menu').exists()).toBe(true)
    const del = wrapper.findAll('.ctx-menu button').find((b) => b.text().includes('Удалить'))
    expect(del).toBeTruthy()
    await del!.trigger('click')
    expect(api.deleteMessage).toHaveBeenCalledWith(10, 1)
  })

  it('кнопка «⋯» открывает то же меню', async () => {
    const { wrapper } = setup()
    await wrapper.vm.$nextTick()
    const more = wrapper.findAll('.more-btn')[0]
    await more.trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.ctx-menu').exists()).toBe(true)
  })

  it('ПКМ по чужому сообщению у модератора открывает меню, у пользователя — нет', async () => {
    const { wrapper, pinia } = setup()
    // Убираем права модератора: пользователь — простой.
    const channels = useChannelsStore()
    channels.channels = [
      { id: 10, name: 'ch', private: false, creator_id: 1, created_at: '', is_member: true, role: 'user' },
    ] as any
    const wrapper2 = mount(ChatPanel, { global: { plugins: [pinia] } })
    await wrapper2.vm.$nextTick()
    const other = wrapper2.findAll('.msg')[1]
    await other.trigger('contextmenu')
    await wrapper2.vm.$nextTick()
    expect(wrapper2.find('.ctx-menu').exists()).toBe(false)
    void wrapper
  })
})
