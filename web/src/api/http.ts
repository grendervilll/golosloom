// HTTP-клиент к Go-серверу.
// Базовый адрес сервера хранится в настройках (вводится при первом запуске
// в Tauri; в вебе подставляется автоматически из адресной строки).

export interface HttpError {
  status: number
  message: string
}

export class ApiClient {
  baseUrl: string
  private token: string | null = null

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  setToken(token: string | null) {
    this.token = token
  }

  getToken(): string | null {
    return this.token
  }

  private async request(method: string, path: string, body?: unknown): Promise<any> {
    const headers: Record<string, string> = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`
    const res = await fetch(this.baseUrl + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    let data: any = null
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = null
      }
    }
    if (!res.ok) {
      const err: HttpError = {
        status: res.status,
        message: (data && data.error) || `Ошибка ${res.status}`,
      }
      throw err
    }
    return data
  }

  get(path: string) {
    return this.request('GET', path)
  }
  post(path: string, body?: unknown) {
    return this.request('POST', path, body ?? {})
  }
  patch(path: string, body?: unknown) {
    return this.request('PATCH', path, body ?? {})
  }
  delete(path: string) {
    return this.request('DELETE', path)
  }

  // --- Аутентификация ---
  register(nick: string, password: string) {
    return this.post('/api/register', { nick, password })
  }
  login(nick: string, password: string) {
    return this.post('/api/login', { nick, password })
  }
  me() {
    return this.get('/api/me')
  }

  // --- Конфигурация ---
  config() {
    return this.get('/api/config') as Promise<ServerConfigShape>
  }

  // --- Пользователи ---
  uploadKey(deviceId: string, publicKey: string) {
    return this.post('/api/users/key', { device_id: deviceId, public_key: publicKey })
  }
  listUsers() {
    return this.get('/api/users')
  }

  // --- Каналы ---
  createChannel(name: string, isPrivate: boolean) {
    return this.post('/api/channels', { name, private: isPrivate })
  }
  listChannels() {
    return this.get('/api/channels')
  }
  getChannel(id: number) {
    return this.get(`/api/channels/${id}`)
  }
  deleteChannel(id: number) {
    return this.delete(`/api/channels/${id}`)
  }
  joinChannel(id: number) {
    return this.post(`/api/channels/${id}/join`)
  }
  listMembers(id: number) {
    return this.get(`/api/channels/${id}/members`)
  }
  setRole(channelId: number, userId: number, role: string) {
    return this.post(`/api/channels/${channelId}/members/${userId}/role`, { role })
  }
  banMember(channelId: number, userId: number, reason: string) {
    return this.post(`/api/channels/${channelId}/members/${userId}/ban`, { reason })
  }
  unbanMember(channelId: number, userId: number) {
    return this.delete(`/api/channels/${channelId}/members/${userId}/ban`)
  }
  kickMember(channelId: number, userId: number, reason: string) {
    return this.post(`/api/channels/${channelId}/members/${userId}/kick`, { reason })
  }
  getPermissions(channelId: number) {
    return this.get(`/api/channels/${channelId}/permissions`)
  }
  setPermission(channelId: number, role: string, permission: string, allowed: boolean) {
    return this.post(`/api/channels/${channelId}/permissions`, { role, permission, allowed })
  }

  // --- Приглашения ---
  inviteToChannel(channelId: number, userId: number) {
    return this.post(`/api/channels/${channelId}/invites`, { user_id: userId })
  }
  listInvites() {
    return this.get('/api/invites')
  }
  acceptInvite(id: number) {
    return this.post(`/api/invites/${id}/accept`)
  }
  declineInvite(id: number) {
    return this.post(`/api/invites/${id}/decline`)
  }

  // --- Ключи каналов ---
  uploadWrappedKey(channelId: number, userId: number, deviceId: string, wrappedKey: Uint8Array) {
    return this.post(`/api/channels/${channelId}/keys/wrap`, {
      user_id: userId,
      device_id: deviceId,
      wrapped_key: Array.from(wrappedKey),
    })
  }
  getMyWrappedKey(channelId: number, deviceId: string) {
    return this.get(`/api/channels/${channelId}/keys/me?device_id=${encodeURIComponent(deviceId)}`)
  }
  pendingKeyTargets(channelId: number) {
    return this.get(`/api/channels/${channelId}/keys/pending`)
  }

  // --- Сообщения ---
  listMessages(channelId: number, before = 0, limit = 50) {
    return this.get(`/api/channels/${channelId}/messages?before=${before}&limit=${limit}`)
  }
  sendMessage(channelId: number, ciphertext: Uint8Array, iv: Uint8Array) {
    return this.post(`/api/channels/${channelId}/messages`, {
      ciphertext: Array.from(ciphertext),
      iv: Array.from(iv),
    })
  }
  editMessage(channelId: number, messageId: number, ciphertext: Uint8Array, iv: Uint8Array) {
    return this.patch(`/api/channels/${channelId}/messages/${messageId}`, {
      ciphertext: Array.from(ciphertext),
      iv: Array.from(iv),
    })
  }
  deleteMessage(channelId: number, messageId: number) {
    return this.delete(`/api/channels/${channelId}/messages/${messageId}`)
  }

  // --- Звонки ---
  createCall(channelId: number, targetIds: number[]) {
    return this.post('/api/calls', { channel_id: channelId, target_ids: targetIds })
  }
  listCalls(channelId: number) {
    return this.get(`/api/channels/${channelId}/calls`)
  }
  acceptCall(callId: number) {
    return this.post(`/api/calls/${callId}/accept`)
  }
  declineCall(callId: number) {
    return this.post(`/api/calls/${callId}/decline`)
  }
  joinCall(callId: number) {
    return this.post(`/api/calls/${callId}/join`)
  }
  leaveCall(callId: number) {
    return this.post(`/api/calls/${callId}/leave`)
  }

  // --- Админ панель сервера ---
  adminListUsers() {
    return this.get('/api/admin/users')
  }
  adminCreateUser(nick: string, password: string) {
    return this.post('/api/admin/users', { nick, password })
  }
  adminResetPassword(userId: number, password: string) {
    return this.post(`/api/admin/users/${userId}/password`, { password })
  }
  adminServerBan(userId: number, reason: string) {
    return this.post(`/api/admin/users/${userId}/server-ban`, { reason })
  }
  adminServerUnban(userId: number) {
    return this.delete(`/api/admin/users/${userId}/server-ban`)
  }
  adminSetRegistration(enabled: boolean) {
    return this.post('/api/admin/settings/registration', { enabled })
  }
  adminListChannels() {
    return this.get('/api/admin/channels')
  }
}

// Простая типизация ответа /api/config без импорта типов
export interface ServerConfigShape {
  ws_path: string
  livekit_url: string
  max_message_len: number
  turn: { urls: string[]; username: string; credential: string }
}
