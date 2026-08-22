# Протокол клиент-сервер Golosloom

Спецификация для реализации клиентов (веб, десктоп, мобильный Flutter).
Сервер: Go, единственный источник истины — код в `server/` и эталонная
реализация клиента в `web/src/`.

## 1. Обзор

- Транспорт: REST (JSON) + WebSocket, всё поверх HTTPS.
- Аутентификация: JWT (HS256), передаётся в `Authorization: Bearer <token>`.
  В WebSocket — query-параметр `token`.
- Шифрование: E2E на клиенте. Сервер хранит только шифротексты и обёрнутые
  ключи и не может расшифровать сообщения.
- Медиа: LiveKit (SFU) + coturn (TURN). Токены LiveKit выдаёт Go-сервер.

## 2. Авторизация

### POST /api/register
```json
{ "nick": "alex", "password": "secret123", "invite": "одноразовый_токен (необязательно)" }
```
- 201 → объект пользователя `{id, nick, is_server_admin, server_banned, created_at}`
- Регистрация может быть запрещена (403) — тогда нужен `invite`.

### POST /api/login
```json
{ "nick": "alex", "password": "secret123" }
```
- 200 → `{ "token": "<jwt>" }`

Rate limit: 20 попыток/15 мин с IP; блокировка ника на 15 мин после 8 неудач.
Ответы 429.

### GET /api/config (без auth)
```json
{
  "ws_path": "/ws",
  "livekit_url": "wss://домен",
  "max_message_len": 2000,
  "vapid_public_key": "base64url (пуши; пусто — пуши выключены)",
  "turn": { "urls": [...], "username": "...", "credential": "..." }
}
```

### GET /api/me
Возвращает текущего пользователя (как при регистрации).

## 3. REST API (все, кроме /api/config, требуют Bearer-токен)

Каналы:
- `GET /api/channels` → список `{id, name, private, creator_id, created_at, is_member, role}`
- `POST /api/channels` `{name, private}` → канал (создатель — участник)
- `GET /api/channels/{id}` ; `DELETE /api/channels/{id}`
- `POST /api/channels/{id}/join` (вступить, для публичных)
- `GET /api/channels/{id}/members` → `[{user_id, nick, role, is_server_admin, online, ban_reason?}]`
- `GET /api/channels/{id}/banned` ; `POST .../members/{uid}/ban {reason}` ;
  `DELETE .../members/{uid}/ban` ; `POST .../members/{uid}/kick {reason}` ;
  `POST .../members/{uid}/role {role: user|channel_moderator|channel_admin}`
- `GET/POST /api/channels/{id}/permissions` — права групп
- `POST /api/channels/{id}/invites {user_id}` — приглашение в канал

Сообщения (всё в base64, стандартный алфавит с `+/` и `=`):
- `GET /api/channels/{id}/messages` → `[{id, channel_id, sender_id, sender_nick,
  ciphertext, iv, created_at, edited_at?, deleted, deleted_by?, history?}]`
  (порядок — по id; пагинация: ?before_id=&limit=)
- `POST /api/channels/{id}/messages` `{ciphertext, iv}` → 201, сообщение
- `PATCH /api/channels/{id}/messages/{mid}` `{ciphertext, iv}` — правка
- `DELETE /api/channels/{id}/messages/{mid}` — удаление (мягкое, deleted=true)

Ключи:
- `POST /api/users/key` `{device_id, public_key}` — регистрация устройства
- `GET /api/channels/{id}/keys/me?device_id=` → `{wrapped_key: base64|null}`
- `GET /api/channels/{id}/keys/pending` → `[{user_id, device_id, public_key}]`
- `POST /api/channels/{id}/keys/wrap` `{user_id, device_id, wrapped_key}`
  (wrapped_key — base64)

Звонки:
- `POST /api/calls` `{channel_id, target_user_ids: []}` (пустой — всем)
- `GET /api/channels/{id}/calls` ; `POST /api/calls/{id}/accept` ;
  `POST /api/calls/{id}/decline` ; `POST /api/calls/{id}/join` ;
  `POST /api/calls/{id}/leave`
- Каждый эндпоинт звонка отдаёт `{call_id, token}` — токен LiveKit для входа в комнату.

Приглашения:
- `POST /api/registration/invites` `{channel_id?}` → одноразовая ссылка на регистрацию
- `GET /api/invites` ; `POST /api/invites/{id}/accept` ; `POST /api/invites/{id}/decline`

GIF: `GET /api/gifs/search?q=` (прокси, ключ на сервере).

## 4. WebSocket

Подключение: `wss://домен/ws?token=<jwt>`.
Кадры — JSON-текст: `{"type": "...", "data": {...}}`.

Клиент → сервер:
- `ping` (сервер отвечает `pong`)
- `channel.join` `{channel_id}` — подписка на события канала (обязательно!)
- `channel.leave` `{channel_id}`
- `call.punch` `{call_id, target_user_id}`

Сервер → клиент (данные):
- `presence` `{user_id, online, nick}` — в каналах пользователя
- `message.new` `{...сообщение...}` (ciphertext/iv, не расшифровано!)
- `message.edited` / `message.deleted` — то же по формату сообщения
- `invite.new` `{invite, channel_name}` ; `invite.pending` (при входе) ;
  `invite.updated`
- `call.invite` `{call_id, channel_id, initiator_id, initiator_nick}`
- `call.started` `{call_id}` ; `call.ended` `{call_id}` ;
  `call.participants` `{call_id, participants: [user_id...]}` ;
  `call.invite.timeout` `{call_id}` — звонок отклонён автоматически
- `punch` `{call_id, by_user_id, by_nick}`
- `device.registered` `{device_id}` — новое устройство пользователя
- `kicked` `{reason}` ; `banned` `{reason}` ; `server_banned` `{reason}`
- `channel.deleted` `{channel_id}` ; `role.changed` ; `member.banned` ;
  `member.unbanned`
- `key.needed` `{channel_id, user_id, device_id, public_key}` — просят
  обернуть ключ канала для устройства
- `key.granted` `{channel_id}` — ключ для нашего устройства готов

Ping/pong: сервер шлёт WS-ping каждые 30с, read deadline 90с.

## 5. Криптография

Ключи: X25519 (устройство), AES-256-GCM (канал, 32 байта).

### Устройство
- `device_id` — UUID (строка).
- Пара: приватный X25519 (32 байта), публичный (32 байта).
- Публичный регистрируется на сервере. **Пара не персистится** — при каждом
  запуске клиент создаёт новую (сервер хранит до 8 последних устройств).

### Обёртка ключа канала для устройства (wrap)
Формат: `ephemeralPublicKey(32) || iv(12) || AES-GCM-шифротекст(+16 tag)`.
1. Эфемерный X25519: `ephemeral = randomPrivate(); ephemeralPub = getPublic(ephemeral)`
2. `shared = x25519(ephemeral, peerPublicKey)`
3. `aesKey = SHA-256(shared)` → AES-256-GCM
4. `ciphertext = AES-GCM(aesKey, iv, channelKey)` (iv — 12 случайных байт)

Распаковка: `shared = x25519(myPrivate, ephemeralPub)`, далее то же.

### Сообщение
`ciphertext = AES-256-GCM(channelKey, iv, utf8(plaintext))`, iv — 12 байт.
Длина лимита: `max_message_len` (2000) + 16.

### Синхронизация ключей (критичный сценарий)
1. При старте клиент регистрирует устройство: `POST /api/users/key`.
2. `syncKeys(channel)`:
   - `GET keys/me?device_id=` — если есть обёрнутый ключ → распаковать,
     сохранить локально, перечитать историю.
   - Если локальный ключ канала есть — взять `GET keys/pending` и для КАЖДОГО
     устройства (кроме своего) обернуть ключ и `POST keys/wrap`.
3. Событие `device.registered` (своё или чужое) → повторный syncKeys всех
   каналов. Событие `key.needed` → обернуть для конкретного устройства.
4. Таймер: пока канал открыт, syncKeys каждые 7 секунд (страховка).
5. Создатель канала: если локального ключа нет (новый канал) —
   `generateChannelKey()` + wrap для себя + `POST keys/wrap`.

Хранилище клиента: веб — IndexedDB под мастер-ключом WebCrypto
(non-extractable); Electron — safeStorage (macOS Keychain / Windows DPAPI / Linux libsecret);
мобильный — flutter_secure_storage.

## 6. Звонки (LiveKit)

- `POST /api/calls` → сервер создаёт звонок и приглашения (`call.invite`).
- `accept`/`join` возвращают `{call_id, token}` — JWT LiveKit.
- Комната LiveKit: имя = `call-<call_id>` (identity = `userID:deviceID`).
- Медиа всегда через TURN (`turn.urls` из /api/config + временные
  учётные данные оттуда же; TTL ~1 час).
- Завершение: участников < 2 → сервер завершает (`call.ended`).

## 7. Пуш-уведомления (Web Push)

- `POST /api/push/subscribe` `{endpoint, p256dh, auth}` (auth required)
- `DELETE /api/push/subscribe` `{endpoint}`
- Сервер шлёт пуш только если у пользователя НЕТ активного WS-соединения.
- Payload: `{"title", "body", "tag"}` — текст сообщений НЕ передаётся (E2E).
- Мобильный нативный клиент: HMS Push (Huawei без GMS) / FCM — серверная
  часть для нативных пушей добавляется отдельно (гейтвей).
