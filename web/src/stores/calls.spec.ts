// Тесты звонков: инициация, приём, отклонение, вход позже, пинок, двойной звонок.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCallStore } from './calls'
import { useAuthStore } from './auth'
import { useSettingsStore } from './settings'
import type { Call } from '../api/types'

const failConnect = vi.hoisted(() => ({ value: false }))

vi.mock('livekit-client', () => ({
  Room: class {
    connect = vi.fn(async () => {
      if (failConnect.value) throw new Error('could not establish signal connection')
    })
    disconnect = vi.fn()
    on = vi.fn()
    localParticipant = {
      setMicrophoneEnabled: vi.fn(async () => {}),
      setCameraEnabled: vi.fn(async () => {}),
      setScreenShareEnabled: vi.fn(async () => {}),
      videoTrackPublications: new Map(),
      identity: '1',
      name: 'u1',
    }
    remoteParticipants = new Map()
  },
  RoomEvent: {
    TrackSubscribed: 'TrackSubscribed',
    TrackUnsubscribed: 'TrackUnsubscribed',
    ParticipantDisconnected: 'ParticipantDisconnected',
  },
  Track: { Kind: { Audio: 'audio', Video: 'video' }, Source: { ScreenShare: 'screen' } },
  AudioPresets: { musicHighQuality: { maxBitrate: 96000 } },
}))

function mockApi() {
  return {
    createCall: vi.fn(async () => ({ call: { id: 1, channel_id: 10, initiator_id: 1, status: 'ringing', created_at: '', participants: [1] }, token: 'tok' })),
    acceptCall: vi.fn(async () => ({ call: { id: 1, channel_id: 10, initiator_id: 1, status: 'active', created_at: '', participants: [1, 2] }, token: 'tok' })),
    declineCall: vi.fn(async () => ({})),
    joinCall: vi.fn(async () => ({ call: {}, token: 'tok' })),
    leaveCall: vi.fn(async () => ({})),
    listCalls: vi.fn(async () => []),
    listMessages: vi.fn(async () => []),
    listMembers: vi.fn(async () => []),
    listChannels: vi.fn(async () => []),
    listUsers: vi.fn(async () => []),
    listInvites: vi.fn(async () => []),
    uploadKey: vi.fn(async () => ({})),
    getMyWrappedKey: vi.fn(async () => ({ wrapped_key: null })),
    pendingKeyTargets: vi.fn(async () => []),
    uploadWrappedKey: vi.fn(async () => ({})),
    config: vi.fn(async () => ({ ws_path: '/ws', livekit_url: 'ws://lk', max_message_len: 2000, turn: {} })),
  }
}

const call = (over: Partial<Call> = {}): Call => ({
  id: 1,
  channel_id: 10,
  initiator_id: 1,
  status: 'ringing',
  created_at: '',
  participants: [1],
  ...over,
})

describe('звонки', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  function setup() {
    const settings = useSettingsStore()
    const api = mockApi() as any
    settings.api = api
    settings.serverConfig = { ws_path: '/ws', livekit_url: 'ws://lk', max_message_len: 2000, turn: { urls: [], username: '', credential: '' } }
    const auth = useAuthStore()
    auth.user = { id: 1, nick: 'u1', is_server_admin: false, server_banned: false, created_at: '' } as any
    return { api, settings }
  }

  it('инициирует звонок и подключается к LiveKit', async () => {
    const { api } = setup()
    const calls = useCallStore()
    await calls.initiate(10, [2, 3])
    expect(api.createCall).toHaveBeenCalledWith(10, [2, 3], expect.any(String))
    expect(calls.connectedCallId).toBe(1)
    expect(calls.micOn).toBe(true) // микрофон включается автоматически
    expect(calls.ringingCall).toBeUndefined()
  })

  it('обрабатывает входящий вызов без дублей', async () => {
    setup()
    const calls = useCallStore()
    calls.handleCallInvite({ call_id: 1, channel_id: 10, initiator_id: 2, initiator_nick: 'bob' })
    expect(calls.ringingCall?.id).toBe(1)
    // Повторное событие того же вызова не создаёт второй звонок.
    calls.handleCallInvite({ call_id: 1, channel_id: 10, initiator_id: 2, initiator_nick: 'bob' })
    expect(calls.calls.filter((c) => c.id === 1)).toHaveLength(1)
  })

  it('принимает входящий вызов', async () => {
    const { api } = setup()
    const calls = useCallStore()
    calls.handleCallInvite({ call_id: 1, channel_id: 10, initiator_id: 2, initiator_nick: 'bob' })
    await calls.accept(call())
    expect(api.acceptCall).toHaveBeenCalledWith(1, expect.any(String))
    expect(calls.ringingCall).toBeUndefined()
    expect(calls.connectedCallId).toBe(1)
  })

  it('отклоняет входящий вызов и прекращает звонок', async () => {
    const { api } = setup()
    const calls = useCallStore()
    calls.handleCallInvite({ call_id: 1, channel_id: 10, initiator_id: 2, initiator_nick: 'bob' })
    await calls.decline(call())
    expect(api.declineCall).toHaveBeenCalledWith(1)
    expect(calls.ringingCall).toBeUndefined()
  })

  it('входит в ранее отклонённый звонок через /join', async () => {
    const { api } = setup()
    const calls = useCallStore()
    calls.handleCallInvite({ call_id: 1, channel_id: 10, initiator_id: 2, initiator_nick: 'bob' })
    await calls.decline(call())
    calls.calls[0].status = 'active'
    await calls.join(1)
    expect(api.joinCall).toHaveBeenCalledWith(1, expect.any(String))
    expect(calls.connectedCallId).toBe(1)
  })

  it('при завершении звонка отключается от комнаты', async () => {
    setup()
    const calls = useCallStore()
    calls.handleCallInvite({ call_id: 1, channel_id: 10, initiator_id: 2, initiator_nick: 'bob' })
    await calls.accept(call())
    calls.handleCallEnded({ call_id: 1 })
    expect(calls.calls).toHaveLength(0)
    expect(calls.connectedCallId).toBe(0)
  })

  it('выход из звонка уведомляет сервер и отключает комнату', async () => {
    const { api } = setup()
    const calls = useCallStore()
    await calls.initiate(10, [2])
    await calls.leave()
    expect(api.leaveCall).toHaveBeenCalledWith(1)
    expect(calls.connectedCallId).toBe(0)
  })

  it('кнопка "Пнуть" срабатывает не чаще раза в 10 секунд', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1000000)
    setup()
    const calls = useCallStore()
    await calls.initiate(10, [2])
    const auth = useAuthStore()
    const sendSpy = vi.spyOn(auth.ws, 'send')
    await calls.punch(2)
    expect(sendSpy).toHaveBeenCalledTimes(1)
    await calls.punch(2)
    expect(sendSpy).toHaveBeenCalledTimes(1)
    vi.setSystemTime(1000000 + 11000)
    await calls.punch(2)
    expect(sendSpy).toHaveBeenCalledTimes(2)
  })

  it('показывает кнопку "Войти в звонок" после отклонения', async () => {
    setup()
    const calls = useCallStore()
    calls.handleCallInvite({ call_id: 1, channel_id: 10, initiator_id: 2, initiator_nick: 'bob' })
    expect(calls.canJoinCall).toBe(false)
    await calls.decline(call())
    calls.calls[0].status = 'active'
    expect(calls.canJoinCall).toBe(true)
  })

  it('переключает микрофон, камеру и экран', async () => {
    setup()
    const calls = useCallStore()
    await calls.initiate(10, [2])
    await calls.toggleMic()
    expect(calls.micOn).toBe(false)
    await calls.toggleMic()
    expect(calls.micOn).toBe(true)
    await calls.toggleCam()
    expect(calls.camOn).toBe(true)
    await calls.toggleScreen('720p30')
    expect(calls.screenOn).toBe(true)
    await calls.toggleScreen('720p30')
    expect(calls.screenOn).toBe(false)
  })

  it('демонстрация экрана передаёт разрешение с frameRate и стабильный fps', async () => {
    setup()
    const calls = useCallStore()
    await calls.initiate(10, [2])
    await calls.toggleScreen('1080p60')
    const room = (window as any).__golosloomRoom
    const [enabled, options, publish] = room.localParticipant.setScreenShareEnabled.mock.calls[0]
    expect(enabled).toBe(true)
    expect(options.resolution).toEqual({ width: 1920, height: 1080, frameRate: 60 })
    expect(options.contentHint).toBe('detail')
    expect(publish.degradationPreference).toBe('maintain-framerate')
    expect(publish.videoEncoding.maxBitrate).toBe(6_000_000)
    expect(publish.videoEncoding.maxFramerate).toBe(60)
  })

  it('при ошибке подключения к LiveKit звонок отменяется на сервере', async () => {
    failConnect.value = true
    try {
      const { api } = setup()
      const calls = useCallStore()
      await expect(calls.initiate(10, [2])).rejects.toThrow('signal connection')
      expect(api.leaveCall).toHaveBeenCalled()
      expect(calls.calls).toHaveLength(0)
      expect(calls.connectedCallId).toBe(0)
    } finally {
      failConnect.value = false
    }
  })

  it('при ошибке подключения при приёме звонок отменяется', async () => {
    failConnect.value = true
    try {
      const { api } = setup()
      const calls = useCallStore()
      calls.handleCallInvite({ call_id: 1, channel_id: 10, initiator_id: 2, initiator_nick: 'bob' })
      await expect(calls.accept(call())).rejects.toThrow('signal connection')
      expect(api.leaveCall).toHaveBeenCalled()
      expect(calls.calls).toHaveLength(0)
    } finally {
      failConnect.value = false
    }
  })
})
