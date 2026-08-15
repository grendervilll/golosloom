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
  // Вызывается при 401: токен истёк (TTL сутки) или пароль сменили —
  // приложение разлогинивается.
  onUnauthorized: (() => void) | null = null
  // Короткоживущий файловый токен (5 минут, только для файлов): в URL
  // файлов попадает он, а не основной JWT. Обновляется заранее.
  private fileToken: { value: string; expiresAt: number } | null = null
  private fileTokenTimer: number | null = null
  // Растёт при каждом обновлении файлового токена (для перепривязки src).
  fileTokenVersion = 0

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
    let res: Response
    try {
      res = await fetch(this.baseUrl + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
    } catch (e: any) {
      throw new Error(`Не удалось подключиться к серверу (${this.baseUrl || 'адрес не задан'})`)
    }
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
      // Токен истёк (TTL — сутки) или пароль сменили: разлогиниваемся.
      if (res.status === 401) this.onUnauthorized?.()
      const err: HttpError = {
        status: res.status,
        message: (data && data.error) || `Ошибка ${res.status}`,
      }
      throw err
    }
    if (!text) {
      throw new Error('Пустой ответ сервера — проверьте адрес сервера')
    }
    if (data === null) {
      throw new Error('Некорректный ответ сервера — проверьте адрес сервера')
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

  // --- Web Push-уведомления ---
  pushSubscribe(endpoint: string, p256dh: string, auth: string) {
    return this.post('/api/push/subscribe', { endpoint, p256dh, auth })
  }
  pushUnsubscribe(endpoint: string) {
    return this.request('DELETE', '/api/push/subscribe', { endpoint })
  }

  // --- Админ-панель: мониторинг и бэкапы ---
  adminStats() {
    return this.get('/api/admin/stats')
  }
  adminGetRegistration() {
    return this.get('/api/admin/settings/registration')
  }
  adminSetRegistration(enabled: boolean) {
    return this.post('/api/admin/settings/registration', { enabled })
  }
  // Приглашение на регистрацию (одноразовое, 5 минут). channelId —
  // канал, доступ к которому получит зарегистрировавшийся.
  createRegistrationInvite(channelId?: number) {
    return this.post('/api/registration/invites', channelId ? { channel_id: channelId } : {})
  }
  // Скачивание бэкапа базы данных (бинарный файл).
  async adminBackup(): Promise<Blob> {
    const headers: Record<string, string> = {}
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`
    const res = await fetch(this.baseUrl + '/api/admin/backup', { method: 'GET', headers })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(text || `Ошибка бэкапа: ${res.status}`)
    }
    return res.blob()
  }
  // Восстановление базы данных из загруженного файла.
  async adminRestore(file: File): Promise<void> {
    const form = new FormData()
    form.append('file', file)
    const headers: Record<string, string> = {}
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`
    const res = await fetch(this.baseUrl + '/api/admin/restore', { method: 'POST', headers, body: form })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(text || `Ошибка восстановления: ${res.status}`)
    }
  }

  // --- Аватары (ограничение сервера — 5 МБ) ---
  async uploadAvatar(file: File): Promise<void> {
    const form = new FormData()
    form.append('file', file)
    const headers: Record<string, string> = {}
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`
    const res = await fetch(this.baseUrl + '/api/me/avatar', { method: 'POST', headers, body: form })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(text || `Ошибка загрузки: ${res.status}`)
    }
  }
  async deleteAvatar(): Promise<void> {
    const headers: Record<string, string> = {}
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`
    const res = await fetch(this.baseUrl + '/api/me/avatar', { method: 'DELETE', headers })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(text || `Ошибка удаления: ${res.status}`)
    }
  }

  // --- Аутентификация ---
  register(nick: string, password: string, invite?: string) {
    return this.post('/api/register', { nick, password, invite: invite || undefined })
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
  listBannedMembers(id: number) {
    return this.get(`/api/channels/${id}/banned`)
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

  // --- GIF (прокси к Giphy на сервере) ---
  gifSearch(q: string, limit = 24) {
    return this.get(`/api/gifs/search?q=${encodeURIComponent(q)}&limit=${limit}`)
  }

  // --- Сообщения ---
  listMessages(channelId: number, before = 0, limit = 50) {
    return this.get(`/api/channels/${channelId}/messages?before=${before}&limit=${limit}`)
  }
  // sendMessage отправляет зашифрованное сообщение с одним или несколькими
  // вложениями (attachmentIds). Пустой ciphertext при вложениях допустим.
  sendMessage(
    channelId: number,
    ciphertext: Uint8Array,
    iv: Uint8Array,
    attachmentIds: number[],
    replyToId = 0,
  ) {
    return this.post(`/api/channels/${channelId}/messages`, {
      ciphertext: Array.from(ciphertext),
      iv: Array.from(iv),
      attachment_ids: attachmentIds,
      reply_to_id: replyToId || undefined,
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

  // --- Файлы (вложения сообщений, максимум 100 МБ) ---
  // Загрузка файла в канал; вернёт { id, filename, mime, size }.
  async uploadFile(channelId: number, file: File): Promise<Attachment> {
    const form = new FormData()
    form.append('file', file)
    const headers: Record<string, string> = {}
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`
    const res = await fetch(this.baseUrl + `/api/channels/${channelId}/files`, { method: 'POST', headers, body: form })
    if (res.status === 401) this.onUnauthorized?.()
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      let msg = `Ошибка загрузки файла: ${res.status}`
      try {
        const j = JSON.parse(text)
        if (j?.error) msg = j.error
      } catch {
        /* not json */
      }
      throw new Error(msg)
    }
    return (await res.json()) as Attachment
  }
  // URL файла для <img>/<video>/просмотра. Токен в query — браузерные теги
  // не умеют слать Authorization. Используется только короткоживущий
  // файловый токен (5 минут), основной JWT в URL не попадает.
  fileUrl(fileId: number): string {
    const t = this.fileToken?.value
    if (!t) void this.ensureFileToken()
    return this.baseUrl + `/api/files/${fileId}?token=${encodeURIComponent(t || '')}`
  }
  // URL принудительного скачивания.
  downloadUrl(fileId: number): string {
    const t = this.fileToken?.value
    if (!t) void this.ensureFileToken()
    return this.baseUrl + `/api/files/${fileId}?download=1${t ? '&token=' + encodeURIComponent(t) : ''}`
  }

  // --- Файловый токен (scope=file, живёт 5 минут) ---
  // Запрашивается у сервера и переиспользуется; при истечении обновляется.
  async ensureFileToken(): Promise<string> {
    const ft = this.fileToken
    // Заранее обновляемся за 60 секунд до истечения.
    if (ft && ft.expiresAt - Date.now() > 60_000) return ft.value
    try {
      const res = await this.get('/api/files/token')
      const value = res?.token as string | undefined
      const expiresIn = Number(res?.expires_in ?? 300)
      if (!value) return this.fileToken?.value || ''
      this.fileToken = { value, expiresAt: Date.now() + expiresIn * 1000 }
      this.fileTokenVersion++
      return value
    } catch {
      return this.fileToken?.value || ''
    }
  }
  // Периодическое обновление файлового токена (раз в 4 минуты) —
  // на 5-минутном токене это оставляет запас.
  startFileTokenRefresh(): void {
    if (this.fileTokenTimer !== null) return
    void this.ensureFileToken()
    this.fileTokenTimer = window.setInterval(() => void this.ensureFileToken(), 4 * 60_000)
  }
  stopFileTokenRefresh(): void {
    if (this.fileTokenTimer !== null) {
      clearInterval(this.fileTokenTimer)
      this.fileTokenTimer = null
    }
  }

  // --- Звонки ---
  createCall(channelId: number, targetIds: number[], deviceId = '') {
    return this.post('/api/calls', { channel_id: channelId, target_ids: targetIds, device_id: deviceId })
  }
  listCalls(channelId: number) {
    return this.get(`/api/channels/${channelId}/calls`)
  }
  acceptCall(callId: number, deviceId = '') {
    return this.post(`/api/calls/${callId}/accept`, { device_id: deviceId })
  }
  declineCall(callId: number) {
    return this.post(`/api/calls/${callId}/decline`)
  }
  joinCall(callId: number, deviceId = '') {
    return this.post(`/api/calls/${callId}/join`, { device_id: deviceId })
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
  adminListChannels() {
    return this.get('/api/admin/channels')
  }
  // Все файлы сервера (вкладка «Файлы» в админ-панели).
  adminListFiles() {
    return this.get('/api/admin/files')
  }
  // Полное удаление файла с сервера (сообщение остаётся).
  adminDeleteFile(fileId: number) {
    return this.delete(`/api/admin/files/${fileId}`)
  }
}

// Простая типизация ответа /api/config без импорта типов
export interface ServerConfigShape {
  ws_path: string
  livekit_url: string
  max_message_len: number
  vapid_public_key?: string
  turn: { urls: string[]; username: string; credential: string }
}
