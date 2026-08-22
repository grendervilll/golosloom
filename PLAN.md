# Plan: Migration of Golosloom to New Architecture

## Current Architecture

| Component | Stack | ~LOC |
|---|---|---|
| Server | Go, SQLite, Gorilla WebSocket, JWT | 3 500 |
| Web | Vue 3, Pinia, Vite, Tailwind, @noble/curves | 5 000 |
| Desktop (Tauri) | Tauri 2 + Rust (keyring), frontend from web/ | 50 |
| Desktop (Qt) | Qt6/C++17, OpenSSL, GStreamer | 4 000 |
| Mobile | Flutter, cryptography, livekit_client, FCM | 4 500 |
| Deploy | Docker Compose (5 services), Caddy, coturn | 700 |

Key characteristics:
- Go-server is a monolith: REST + WebSocket + LiveKit tokens + push + files
- E2E: custom X25519 + AES-256-GCM (not Signal Protocol), channel key wrapped per-device via ephemeral ECDH
- WebSocket: Gorilla + hand-rolled hub with channel join/leave, presence, typing, call signaling
- desktop-qt/ is a full native C++17 client with its own crypto and UI

## Target Architecture

```
+-----------------------------------------------------+
|                        Clients                       |
|  +----------+  +---------------+  +----------------+|
|  | Web      |  | Desktop       |  | Mobile         ||
|  | Vue 3 +  |  | Electron +    |  | Flutter +      ||
|  | LiveKit  |  | Vue (shared   |  | livekit_client ||
|  | JS SDK + |  | code from     |  | + flutter_webrtc||
|  |Centrifuge|  | web/) +       |  | + libsignal    ||
|  | JS SDK + |  | libsignal JS  |  | (Dart FFI) +   ||
|  | libsignal|  | + safeStorage |  | Centrifuge     ||
|  | JS       |  |               |  | Dart SDK       ||
|  +----+-----+  +------+--------+  +--------+-------+|
|       |               |                    |         |
+-------+---------------+--------------------+---------+
        |               |                    |
   +----v---------------v--------------------v----+
   |              Caddy (TLS + reverse proxy)      |
   +--+--------------+----------------+------------+
      |              |                |
+-----v----+  +------v-------+  +----v------+
| Go API   |  | Centrifugo   |  | LiveKit   |
| Backend  |  | (Go)         |  | SFU       |
|          |  |              |  |           |
| REST     |  | pub/sub +    |  | Media     |
| only     |  | presence +   |  | relay     |
| No       |  | push + hist  |  |           |
| crypto   |  |              |  |           |
+----+-----+  +--------------+  +-----------+
     |
+----v----+
| SQLite  |
+---------+
```

---

## Phase 1: Server -- Centrifugo + REST API Update

### 1.1 Files to delete

| File | Reason |
|---|---|
| internal/hub/ (hub.go, hub_test.go) | WebSocket hub replaced by Centrifugo pub/sub |
| internal/api/ws.go | WebSocket handler, read/write pumps |
| internal/api/push.go | Web Push moves to Centrifugo push adapter |
| internal/api/fcm.go | FCM gateway moves to Centrifugo push adapter |
| internal/api/call_reconcile.go | Call reconciliation via WS -> Centrifugo presence on call:{id} |
| gorilla/websocket from go.mod | WebSocket transport no longer needed |

**Important**: During migration, `internal/api/ws.go` and `internal/hub/` are NOT deleted immediately.
They are marked deprecated and removed in Phase 7 cleanup (step 6) AFTER all clients have migrated.
This ensures desktop-qt (old Qt client) and any un-updated clients keep working until everyone migrates.

### 1.2 New code

#### New package: internal/centrifugo/

**client.go** -- HTTP client for publishing events to Centrifugo.
Uses net/http POST to Centrifugo HTTP API (POST /api with X-API-Key header).
The centrifuge-go library is NOT needed -- it is a client SDK for subscribers,
but the server is a publisher.

```go
package centrifugo

// Centrifugo HTTP API: https://centrifugo.dev/v5/server/http_api/

type Client struct {
    baseURL    string // http://centrifugo:8000
    apiKey     string
    httpClient *http.Client
}

func (c *Client) Publish(channel string, data []byte) error
func (c *Client) Broadcast(channels []string, data []byte) error
func (c *Client) Presence(channel string) (*PresenceResult, error)
func (c *Client) History(channel string, count int) (*HistoryResult, error)

// Disconnect forces disconnection of all client connections for a user.
// Used on ban, logout, device deletion.
// POST /api with {"method": "disconnect", "user": "user_id_string"}
func (c *Client) Disconnect(userID string) error
```

**auth.go** -- Centrifugo JWT generation for clients:

Uses **subscription tokens** (Centrifugo v5 feature) instead of hardcoded channel
list in connection JWT. This allows dynamic channel joins without reconnecting.

```go
// Connection JWT -- does NOT contain channel list:
// {
//   "sub": "user_id",
//   "exp": <timestamp>,   // short TTL: 1 hour
//   "info": {"nick": "...", "is_server_admin": bool}
// }
func GenerateCentrifugoConnectionToken(userID int64, nick string,
    isServerAdmin bool, secret string) (string, error)

// Subscription token -- per-channel, issued on demand:
// {
//   "sub": "user_id",
//   "exp": <timestamp>,   // short TTL: 1 hour
//   "channel": "channel:1"
// }
// Issued by POST /api/centrifugo/subscribe after verifying membership.
func GenerateCentrifugoSubscriptionToken(userID int64, channel string,
    secret string) (string, error)
```

#### New package: internal/devices/

**devices.go** -- CRUD for Signal Protocol devices.
Server stores ONLY public keys. Ratchet state is NOT stored -- it lives only on clients.

```go
package devices

type Device struct {
    ID             int64
    UserID         int64
    DeviceID       string   // UUID
    IdentityKey    []byte   // 32 bytes, public X25519
    SignedPreKey   []byte   // 32 bytes
    OneTimePreKeys [][]byte // pool, 32 bytes each
}

// POST   /api/devices                    -- register device
// DELETE /api/devices/{device_id}        -- delete device
// GET    /api/users/{id}/devices         -- list user devices (public keys)
// GET    /api/devices/{device_id}/prekey  -- consume one one-time pre-key (atomic SELECT+DELETE)
// POST   /api/devices/{device_id}/prekeys -- upload new batch of one-time pre-keys (replenishment)

// Cleanup: one-time pre-keys of devices not connected for > 90 days are
// purged by hourly cleanup job (startCleanupJobs in server.go).
// Also cleaned up via ON DELETE CASCADE when user is deleted.
```

#### Database migration

```sql
-- Rename old devices table (kept for backward compatibility during migration)
ALTER TABLE devices RENAME TO devices_legacy;

-- New devices table for Signal Protocol
CREATE TABLE devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    identity_key BLOB NOT NULL,
    signed_pre_key BLOB NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, device_id)
);

-- One-time pre-key pool
CREATE TABLE one_time_pre_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    pre_key BLOB NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, device_id, pre_key)
);

-- Add protocol_version to messages (existing messages get version=1)
ALTER TABLE messages ADD COLUMN protocol_version INTEGER NOT NULL DEFAULT 1;
-- NOTE: iv column is kept for now -- needed to decrypt protocol_version=1 messages.
-- iv is dropped in Phase 7 cleanup AFTER all clients migrated.

-- channel_keys: NOT dropped yet -- needed by old clients during migration.
-- Dropped in Phase 7 cleanup (step 8) AFTER all clients migrated and protocol_version=1 disabled.
-- DROP TABLE IF EXISTS channel_keys;  -- deferred to Phase 7
```

### 1.3 Updated code

#### internal/api/router.go -- endpoints

| Endpoint | Description | Status |
|---|---|---|
| POST /api/devices | Register device (identity key + signed pre-key + one-time pre-keys) | NEW |
| DELETE /api/devices/{device_id} | Delete device | NEW |
| GET /api/users/{id}/devices | List user devices | NEW |
| GET /api/devices/{device_id}/prekey | Consume one one-time pre-key (atomic SELECT+DELETE) | NEW |
| POST /api/devices/{device_id}/prekeys | Upload new batch of one-time pre-keys (replenishment) | NEW |
| POST /api/centrifugo/token | Issue Centrifugo connection JWT to client | NEW |
| POST /api/centrifugo/subscribe | Issue Centrifugo subscription token for a channel | NEW |
| POST /api/users/key | Old device registration | DELETED |
| POST /api/channels/{id}/keys/wrap | Wrap key for device | DELETED |
| GET /api/channels/{id}/keys/me | Get wrapped key | DELETED |
| GET /api/channels/{id}/keys/pending | Pending devices | DELETED |
| GET /api/channels/{id}/keys/backup | Key backup | DELETED |
| PUT /api/channels/{id}/keys/backup | Upload key backup | DELETED |

#### One-time pre-key lifecycle

```
Client                          Server
  |                               |
  | POST /api/devices             |
  | {identity_key, signed_pre_key,|
  |  pre_keys: [k1,k2,...,k100]}  |
  |------------------------------>|  Store in devices + one_time_pre_keys
  |                               |
  | ... time passes, pre-keys     |
  | consumed by other devices ... |
  |                               |
  | (server checks pool size)     |
  | if COUNT(*) < 20:             |
  |   publish session.needed     |
  |   on user:{id}               |
  |                               |
  |<-- session.needed event ------|
  |                               |
  | POST /api/devices/{id}/prekeys|
  | {pre_keys: [k101,...,k120]}   |
  |------------------------------>|  Append to one_time_pre_keys
  |                               |
  | Other device requests key:    |
  | GET /api/devices/{id}/prekey  |
  |<------------------------------|  SELECT one key + DELETE in same tx
  | {pre_key: "base64..."}        |
```

#### Centrifugo channel table

| Centrifugo Channel | Event | Purpose |
|---|---|---|
| channel:{id} | message.new | New message in channel |
| channel:{id} | message.edited | Message edited |
| channel:{id} | message.deleted | Message deleted |
| channel:{id} | typing | Typing indicator |
| channel:{id} | member.banned | Member banned |
| channel:{id} | member.unbanned | Member unbanned |
| channel:{id} | role.changed | Member role changed |
| channel:{id} | member.kicked | Member kicked |
| channel:{id} | channel.deleted | Channel deleted |
| user:{id} | call.invite | Call invitation |
| user:{id} | call.started | Call started |
| user:{id} | call.ended | Call ended |
| user:{id} | call.participants | Participant list updated |
| user:{id} | call.invite.timeout | Call auto-declined |
| user:{id} | punch | Punch call participant |
| user:{id} | invite.new | New channel invite |
| user:{id} | invite.pending | Invites on connect |
| user:{id} | invite.updated | Invite status changed |
| user:{id} | device.registered | New device registered |
| user:{id} | session.needed | Signal Protocol pre-key refresh request (pool < 20) |
| user:{id} | kicked | User kicked from channel |
| user:{id} | banned | User banned in channel |
| user:{id} | server_banned | User banned on server |
| call:{id} | presence | Who is currently in the call (Centrifugo presence) |

**Note**: `call:{id}` does NOT include `punch` event. All call signaling (punch, participants update, call end) goes through REST API -> server publishes to Centrifugo. Client cannot publish directly to call:{id}.

#### Centrifugo namespaces

```json
{
  "namespaces": [
    {
      "name": "channel",
      "presence": true,
      "join_leave": true,
      "history_size": 100,
      "history_ttl": "24h",
      "allow_publish_for_subscriber": false
    },
    {
      "name": "user",
      "presence": false,
      "join_leave": false,
      "history_size": 0,
      "allow_publish_for_subscriber": false
    },
    {
      "name": "call",
      "presence": true,
      "join_leave": true,
      "history_size": 0,
      "history_ttl": "0",
      "allow_publish_for_subscriber": false
    }
  ]
}
```

**Security note**: `allow_publish_for_subscriber: false` for ALL namespaces.
All events go through REST API -> server publishes to Centrifugo.
This ensures rate limiting and authorization on the server side.
No client can publish fake events or spam directly.

#### Centrifugo JWT -- subscription tokens

Connection JWT (no channel list):

```json
{
  "sub": "123",
  "exp": 1700000000,
  "info": {"nick": "alex", "is_server_admin": false}
}
```

Subscription tokens (per-channel, issued on demand):

```json
{
  "sub": "123",
  "exp": 1700000000,
  "channel": "channel:1"
}
```

Flow: client connects with connection JWT, then for each channel it wants to
subscribe to, calls POST /api/centrifugo/subscribe -> server verifies membership
-> issues subscription token -> client subscribes with that token.
This allows dynamic channel joins without reconnecting.

#### Update internal/api/server.go

```go
type Server struct {
    Cfg       config.Config
    Store     *store.Store
    Centi     *centrifugo.Client  // replaces Hub *hub.Hub
    startedAt time.Time
    // rate limiters, dedup -- unchanged
    // push, fcm -- removed (Centrifugo handles push)
}
```

#### Update internal/config/config.go

```go
type Config struct {
    // ... existing fields ...
    CentrifugoURL     string // http://centrifugo:8000
    CentrifugoAPIKey  string // X-API-Key for HTTP API
    CentrifugoSecret  string // HMAC secret for Centrifugo JWT (SEPARATE from JWTSecret)
}
```

#### Update internal/api/handlers_calls.go

```go
// Before: s.Hub.Broadcast(channelID, wsMsg{Type: "call.invite", Data: ...})
// After:
s.Centi.Publish("channel:"+strconv.FormatInt(channelID, 10), centrifugoEvent{
    Type: "call.invite",
    Data: map[string]interface{}{...},
})
```

#### Centrifugo Disconnect on ban/logout

```go
// When banning a user:
func (s *Server) handleAdminServerBan(w http.ResponseWriter, r *http.Request) {
    // ... ban logic ...
    _ = s.Centi.Disconnect(strconv.FormatInt(userID, 10))  // force disconnect
    // ... send banned event ...
}

// When a device is deleted:
func (s *Server) handleDeleteDevice(w http.ResponseWriter, r *http.Request) {
    // ... delete device ...
    // No disconnect needed -- device-specific sessions are gone
}
```

#### Delete internal/api/ws.go

**DEPRECATED** -- marked for deletion in Phase 7 cleanup.
During migration, this file is kept but new clients use Centrifugo.
Old clients (desktop-qt) continue using /ws endpoint.

#### Update internal/api/handlers_messages.go

```go
// Before: ciphertext BLOB, iv BLOB -- AES-256-GCM with shared channel key
// After:  ciphertext BLOB -- Signal Protocol message
//   protocol_version INTEGER -- 1 = old, 2 = Signal Protocol
//   iv kept for protocol_version=1, ignored for protocol_version=2
```

Migration: existing messages stay in old format (protocol_version=1),
client decrypts both formats. New messages use protocol_version=2.

#### Update internal/api/middleware.go

Delete requireCentrifugoAuth -- not needed. API server authenticates via its own JWT (requireAuth).
Centrifugo JWT is issued to clients separately via POST /api/centrifugo/token.

### 1.4 Event publishing flow

```
Go API Server                    Centrifugo
     |                               |
     |  POST /api                     |
     |  X-API-Key: <key>              |
     |  {"channel":"channel:1",       |
     |   "data":{"type":"message.new"}}|
     |------------------------------->|
     |                               |  broadcast subscribers
     |                               |-----------------> client 1
     |                               |-----------------> client 2
     |                               |
     |  POST /api                     |
     |  {"channel":"user:123",        |
     |   "data":{"type":"call.invite"}}|
     |------------------------------->|
     |                               |  deliver to user
     |                               |-----------------> client 123
```

### 1.5 Signal Protocol: 1:1 vs Group encryption

#### 1:1 chats
Full Double Ratchet per device pair. Each message is encrypted separately for
each of the recipient's devices. Forward secrecy and post-compromise security.

#### Group chats -- Sender Keys (group ratchet)
For groups, use **Sender Keys** to avoid N*M encryption overhead:

- Each sender has ONE sender key per group (one ciphertext per message, not N*M)
- Sender key is distributed to all group members via their device sessions (X3DH)
- Sender key is rotated when:
  - A new member joins the group
  - A member leaves or is kicked
  - A device is deleted
- Forward secrecy is achieved through key rotation, not per-message ratchet

**Tradeoff**: Between rotations, if a sender key is compromised, messages in that
window can be decrypted. For a small group of friends, this is acceptable.

**Implementation**:
- `web/src/crypto/signal.ts`: `encryptGroupMessage(groupId, plaintext)` uses sender key
- `web/src/crypto/signal.ts`: `decryptGroupMessage(groupId, senderId, ciphertext)` uses sender key
- Sender keys stored locally in IndexedDB (web) / secure storage (mobile)
- Group membership changes trigger sender key rotation via `session.needed` event

#### Multi-device key delivery flow (Sender Keys)

When a new device joins, existing group members must deliver the current Sender Key:

1. New device registers (POST /api/devices) with identity key + signed pre-key + one-time pre-keys
2. Existing members detect new device via `device.registered` event on `user:{id}`
3. Each existing member sends the current Sender Key to the new device via 1:1 Double Ratchet message
4. New device receives Sender Keys for all groups it belongs to and can decrypt new group messages
5. New device CANNOT decrypt old messages sent before it joined (by design -- forward secrecy)

This is handled automatically by the client: on `device.registered` event, iterate
joined groups and re-send Sender Key to the new device via encrypted 1:1 message.

#### Signed pre-key rotation (future consideration)

Signal Protocol recommends rotating signed pre-keys periodically (e.g., weekly/monthly)
and keeping old signed pre-keys for some time to decrypt messages sent before rotation.
For initial implementation: single signed pre-key per device is acceptable.
Future improvement: add `signed_pre_keys_history` table or `previous_signed_pre_key` field
with TTL (e.g., keep last 3 rotated keys for 30 days).

---

## Phase 2: Delete desktop-qt

- Delete entire desktop-qt/ directory
- Delete Qt workflow from .github/workflows/ (if any)
- Update README.md -- remove Qt client references
- **Only after all users have migrated to Electron or other clients**

---

## Phase 3: Web Client -- Centrifuge JS + libsignal JS

### 3.1 Replace WebSocket

| Deleted | Replacement |
|---|---|
| web/src/api/ws.ts (WsClient, 61 lines) | centrifuge npm package |

New file web/src/api/centrifuge.ts:

```typescript
import { Centrifuge } from 'centrifuge';

// Connect to Centrifugo (WebSocket transport) with connection JWT
// Subscribe to channels using subscription tokens (per-channel JWT)
// Auto-reconnect, presence, history, join/leave
```

Install: npm install centrifuge

### 3.2 Replace crypto

| Deleted | Replacement |
|---|---|
| web/src/crypto/crypto.ts (X25519 + AES-256-GCM) | libsignal JS SDK |

Packages to evaluate (audit before integration):

| Package | Type | Pros | Cons |
|---|---|---|---|
| @signalapp/libsignal-client | Rust + WASM | Official, full compatibility | Requires WASM build, harder deploy |
| @open-e2ee/signal-protocol-sdk | Pure TypeScript | No native modules, easy deploy | Community, need to check Sesame support |
| libsignal-protocol-typescript | Pure TypeScript | Easy integration | Old, may not support Sesame |

**Recommendation**: start with @open-e2ee/signal-protocol-sdk (pure TS, no WASM).
If it does not support Sesame/group ratchet -- fallback to @signalapp/libsignal-client (WASM).

New file web/src/crypto/signal.ts:

```typescript
// Identity key pair generation
// Signed pre-key generation
// One-time pre-key generation (batch of 100, replenish when < 20)
// Session establishment (X3DH)
// Message encryption/decryption (Double Ratchet) -- for 1:1
// Group encryption (Sender Keys) -- for groups
```

Update web/src/crypto/storage.ts:
- Store identity key, sessions, pre-keys in IndexedDB
- Data format compatible with libsignal
- Data volume: identity key (~64 bytes), N sessions (~200-400 bytes each), pre-keys pool (100-200 x 32 bytes) -- for a small group this is kilobytes, IndexedDB handles it easily

### 3.3 File encryption

Files are encrypted BEFORE upload, independent of Signal Protocol:

1. Client generates random **file key** (32 bytes, AES-256-GCM)
2. Encrypts file content with file key (AES-256-GCM, random IV)
3. Uploads ciphertext to server (POST /api/files) -> receives `file_id`
4. Encrypts **file key** via Signal Protocol (included in message or as separate message)
5. Sends message with `file_id` + encrypted file key
6. Recipient: decrypts file key via Signal Protocol -> downloads file -> decrypts with file key

Server stores only ciphertext -- cannot read file contents.

```typescript
// In signal.ts:
function encryptFileKey(fileKey: Uint8Array, recipientSession: Session): Uint8Array
function decryptFileKey(encryptedKey: Uint8Array, senderId: string): Uint8Array
```

### 3.4 Update stores

**auth.ts**:
- After login: generate/load identity keys
- Register device on server (POST /api/devices)
- Get Centrifugo connection token (POST /api/centrifugo/token)
- Connect to Centrifugo

**channels.ts**:
- Delete: syncKeys(), initChannelKey(), handleKeyNeeded(), getKek(), submitKek(), uploadBackup()
- Add: initSession(), establishSession(), fetchDevices(), fetchOneTimePreKey()
- On join channel: POST /api/centrifugo/subscribe -> get subscription token -> subscribe
- Pre-key replenishment: monitor session.needed event, upload new batch via POST /api/devices/{id}/prekeys

**chat.ts**:
- toChatMessage() -- uses libsignal for decryption (both v1 legacy and v2 Signal)
- send() -- encrypts via Signal Protocol (v2)
- Dual-mode support: protocol_version=1 (old AES-GCM) + protocol_version=2 (Signal Protocol)
- File attachments: encrypt file key, include in message

**calls.ts**:
- Calls via Centrifugo channels instead of WS
- LiveKit integration unchanged

### 3.5 Unchanged

- All Vue components (UI)
- LiveKit integration (room, media, participant management)
- Pinia stores structure -- only internals change
- Router (/, /login, /register)
- All tests (updated for new API)

---

## Phase 4: Desktop -- Tauri to Electron

### 4.1 New desktop/ structure

```
desktop/
+-- package.json              # electron, vue, centrifuge, libsignal
+-- electron-builder.yml      # NSIS, DMG, AppImage build config
+-- electron/
|   +-- main.ts               # Electron main process
|   +-- preload.ts            # secureStorage API (contextBridge)
|   +-- updater.ts            # auto-update via GitHub Releases
|   +-- tray.ts               # system tray
+-- src/                      # COPY from web/src at build time (NOT symlink)
+-- dist/                     # built output (web/dist copied here by prebuild)
+-- resources/                # icons (.icns, .ico, .png)
```

### 4.2 Dev vs Production

**Development mode:**
- `src/` is copied from `web/src` via `npm run prebuild` script
- Vite dev server runs from `web/` (hot reload)
- Electron loads `http://localhost:5173`

**Production build pipeline:**
1. `cd web && npm run build` -> `web/dist/`
2. `cp -r web/dist desktop/dist` (or configure Vite outDir)
3. `cd desktop && npm run build` (electron-builder)
4. Electron loads `file://...desktop/dist/index.html`

### 4.3 Electron main process

```typescript
// app.whenReady() -> BrowserWindow loads dist/index.html
// IPC handlers:
//   secure:get(key)    -> safeStorage.decrypt()
//   secure:set(key, v) -> safeStorage.encrypt()
//   secure:delete(key) -> safeStorage.delete()
// System tray, menu, native notifications
// Window management (minimize to tray, close to tray)
```

### 4.4 Safe storage -- Linux fallback

On Linux safeStorage uses libsecret. If gnome-keyring/kwallet is unavailable,
fallback to encrypted file with password:

```typescript
// macOS: Keychain -- OK
// Windows: DPAPI -- OK
// Linux: libsecret -> if unavailable -> encrypted file (~/.config/golosloom/keys.enc)
```

### 4.5 Build

- electron-builder for NSIS (Windows), DMG (macOS), AppImage/deb (Linux)
- GitHub Actions workflow similar to current Tauri one (4 jobs: macOS, Windows x86/arm64, Linux x86/arm64)
- Auto-update via GitHub Releases + electron-updater
- src/ -- COPY from web/src at build time (script in package.json prebuild), NOT symlink (symlink breaks during electron-builder packaging)
- **dist/ MUST be in .gitignore** -- it contains built frontend output, should not be committed
- **Bundle size**: Electron is ~150-200 MB per platform (vs Tauri ~10-20 MB). With asar packaging, electron-builder compresses to ~80-100 MB. Not an issue for distributing to friends, but worth noting.

### 4.6 Deleted

- Current desktop/ (Tauri + Rust)
- desktop/src-tauri/ entirely
- .github/workflows/build-desktop.yml -- rewritten for Electron

---

## Phase 5: Mobile -- Centrifuge Dart SDK + libsignal Dart

### 5.1 Replace WebSocket

| Deleted | Replacement |
|---|---|
| web_socket_channel from pubspec.yaml | Centrifuge Dart SDK |

Package options:

| Package | Status |
|---|---|
| centrifuge (pub.dev) | Community port, check activity (last commit, tests) |
| HTTP-based client (SSE/HTTP-streaming) | Fallback, simpler but no WebSocket |

**Recommendation**: check centrifuge on pub.dev. If inactive -- write a lightweight
WebSocket client for Centrifugo on Dart. Centrifugo uses a standard WebSocket with
JSON protocol (https://centrifugo.dev/v5/concepts/protocol/) -- implementation is
straightforward (~200-300 lines). HTTP streaming is a last-resort fallback but has
higher latency, no auto-reconnect, and slower presence updates.

### 5.2 Replace crypto

| Deleted | Replacement |
|---|---|
| cryptography package | libsignal (Dart FFI or custom port) |

**Audit before integration** -- must check:

1. libsignal_protocol_dart on pub.dev:
   - Last commit -- if > 6 months, be cautious
   - Test coverage
   - Supports Double Ratchet + X3DH + Sender Keys?
   - Format compatibility with libsignal JS (byte-for-byte ciphertext match)
   - Cross-platform tests (crypto vectors between JS and Dart)

2. If libsignal_protocol_dart is not suitable:
   - **FFI to libsignal Rust** -- compile Rust core for iOS/Android, most reliable but harder build (Flutter Rust Bridge or manual FFI)
   - **Custom Dart port** -- X25519 + AES-256-GCM + HKDF already in package:cryptography, implement X3DH + Double Ratchet manually

3. **Critical**: web (libsignal JS) and mobile (libsignal Dart) MUST produce byte-for-byte compatible ciphertexts. Verified via crypto vector tests.

### 5.3 Group encryption -- Sender Keys

Same approach as web (Phase 3.3):
- 1:1 chats: full Double Ratchet per device pair
- Group chats: Sender Keys (one ciphertext per message, key rotated on membership changes)

### 5.4 File encryption

Same approach as web (Phase 3.3):
- Random file key, AES-256-GCM encrypt before upload
- File key encrypted via Signal Protocol in message
- Server stores only ciphertext

### 5.5 Update pubspec.yaml

```yaml
dependencies:
  # Removed:
  # cryptography: ^2.9.0        # replaced by libsignal
  # web_socket_channel: ^3.0.3  # replaced by centrifuge

  # Added:
  centrifuge: ^x.x.x            # or HTTP-based client
  # libsignal_protocol_dart: ^x.x.x  # after audit
```

### 5.6 Updated files

**crypto.dart** -- full rewrite:
- Identity key generation (X25519)
- X3DH key agreement
- Double Ratchet encrypt/decrypt (1:1)
- Sender Keys encrypt/decrypt (groups)
- Pre-key pool management (generate batch, replenish when low)
- File key encrypt/decrypt
- Base64 utils (keep)

**key_store.dart** -- expanded:
- Store identity keys in flutter_secure_storage
- Store sessions, pre-keys, sender keys
- Format: JSON in secure storage (Android Keystore / iOS Keychain)

**session.dart**:
- Initialize Signal Protocol
- Register device on server
- Connect to Centrifugo instead of WebSocket
- Delete: key sync via key wrapping (old protocol)
- Pre-key replenishment: listen for session.needed, upload new batch

**chat_store.dart**:
- Encrypt/decrypt via libsignal
- Dual-mode: protocol_version=1 (old) + protocol_version=2 (Signal)
- Optimistic send preserved

**call_service.dart**:
- Calls via Centrifugo channels
- LiveKit unchanged

**push_service.dart**:
- Simplified: Centrifugo handles push delivery
- Firebase stays for Android
- **iOS push**: Centrifugo does not send APNs directly. Solution: Firebase as intermediary (FCM automatically routes to APNs for iOS tokens) -- already works in current config

### 5.7 Unchanged

- LiveKit integration (livekit_client)
- UI components and screens
- Adaptive design
- Russian-language interface

---

## Phase 6: Deployment

### 6.1 Docker Compose -- add Centrifugo

```yaml
centrifugo:
  image: centrifugo/centrifugo:v5
  container_name: golosloom-centrifugo
  restart: unless-stopped
  command: --config /etc/centrifugo/config.json
  volumes:
    - ./centrifugo.json:/etc/centrifugo/config.json:ro
    - ./fcm-service-account.json:/fcm-service-account.json:ro
  ports:
    - "8000:8000"   # HTTP API (for Go backend)
  networks:
    - golosloom
  mem_limit: 384m
  memswap_limit: 512m
  logging: *default-logging
  healthcheck:
    test: ["CMD", "wget", "-qO-", "http://localhost:8000/health"]
    interval: 30s
    timeout: 5s
    retries: 3
    start_period: 10s
```

**Note**: `fcm-service-account.json` volume added for Firebase Cloud Messaging.

**Memory note**: 384m with 512m memswap for headroom.

**Redis** (optional): Centrifugo stores history in memory by default -- lost on restart.
For persistence, add Redis:

```yaml
redis:
  image: redis:7-alpine
  container_name: golosloom-redis
  restart: unless-stopped
  networks:
    - golosloom
  mem_limit: 128m
```

For now memory engine is OK -- message history is in SQLite on Go server,
Centrifugo is used for real-time event delivery.

**When to add Redis**: when concurrent WebSocket connections exceed ~500,
or when persistent Centrifugo history across restarts is needed (e.g., for
offline message delivery via Centrifugo history instead of REST API poll).

### 6.2 Centrifugo config (deploy/centrifugo.json)

```json
{
  "http_address": "0.0.0.0:8000",
  "api_key": "<random_generated>",
  "admin_key": "<random_generated>",
  "token_hmac_secret_key": "<CENTRIFUGO_SECRET -- SEPARATE from JWT_SECRET>",
  "namespaces": [
    {
      "name": "channel",
      "presence": true,
      "join_leave": true,
      "history_size": 100,
      "history_ttl": "24h",
      "allow_publish_for_subscriber": false
    },
    {
      "name": "user",
      "presence": false,
      "join_leave": false,
      "history_size": 0,
      "allow_publish_for_subscriber": false
    },
    {
      "name": "call",
      "presence": true,
      "join_leave": true,
      "history_size": 0,
      "history_ttl": "0",
      "allow_publish_for_subscriber": false
    }
  ],
  "client_connection_limit": 20,
  "presence": true,
  "join_leave": true,
  "push_enabled": true,
  "web_push": {
    "vapid_public_key": "<from_VAPID_PUBLIC_KEY>",
    "vapid_private_key": "<from_VAPID_PRIVATE_KEY>",
    "vapid_subject": "mailto:admin@example.com"
  },
  "firebase": {
    "enabled": true,
    "service_account_file": "/fcm-service-account.json"
  }
}
```

Key changes from previous version:
- `allow_publish_for_subscriber: false` for ALL namespaces (including call)
- `client_connection_limit: 20` (was 10)
- `token_hmac_secret_key` uses SEPARATE `CENTRIFUGO_SECRET` (not JWT_SECRET)

### 6.3 Caddyfile update

```caddyfile
{$DOMAIN} {
    encode zstd gzip

    log {
        output file /data/access.log {
            roll_size 50mb
            roll_keep 3
        }
        format filter {
            wrap json
            request>uri query {
                delete token
            }
        }
    }

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "no-referrer"
        X-Robots-Tag "noindex, nofollow"
        # CSP: wss: for Centrifugo + LiveKit, turns: turn: for TURN/STUN
        Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; media-src 'self' blob: https:; connect-src 'self' wss: https: turns: turn: stun:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    }

    # LiveKit: unchanged
    handle /rtc {
        reverse_proxy host.docker.internal:7880
    }
    handle /rtc/* {
        reverse_proxy host.docker.internal:7880
    }
    handle /twirp/* {
        reverse_proxy host.docker.internal:7880
    }

    # API: unchanged
    handle /api/* {
        reverse_proxy server:8080
    }

    # WebSocket: KEPT during migration (deprecated, removed in Phase 7)
    handle /ws {
        reverse_proxy server:8080
    }

    # Centrifugo: WebSocket + HTTP streaming for clients
    handle /centrifugo {
        reverse_proxy centrifugo:8000
    }
    handle /centrifugo/* {
        reverse_proxy centrifugo:8000
    }

    # Block Centrifugo admin panel from internet (access via SSH tunnel only)
    handle /centrifugo/admin {
        respond 403
    }
    handle /centrifugo/admin/* {
        respond 403
    }

    # SPA: unchanged
    handle {
        root * /srv
        file_server
        try_files {path} /index.html
    }
}
```

Changes from current:
1. Added `handle /centrifugo` and `handle /centrifugo/*` -> reverse_proxy centrifugo:8000
2. **KEPT** `handle /ws` -> reverse_proxy server:8080 (deprecated, for desktop-qt during migration)
3. Updated CSP: added `turns: turn: stun:` for TURN/STUN, added `https:` for general HTTPS
4. Log filter already strips `token` from query -- works for Centrifugo auth too

### 6.4 Environment variables (.env)

Added to .env.example:

```
# Centrifugo (SEPARATE secret from JWT_SECRET)
CENTRIFUGO_URL=http://centrifugo:8000
CENTRIFUGO_API_KEY=<generated_random>
CENTRIFUGO_ADMIN_KEY=<generated_random>
CENTRIFUGO_SECRET=<generated_random_different_from_JWT_SECRET>
```

### 6.5 Updated docker-compose.yml -- Go server env

Add to server service environment:

```yaml
environment:
  - CENTRIFUGO_URL=http://centrifugo:8000
  - CENTRIFUGO_API_KEY=${CENTRIFUGO_API_KEY}
  - CENTRIFUGO_SECRET=${CENTRIFUGO_SECRET}
```

### 6.6 install.sh updates

- Generate Centrifugo API key, admin key, and SECRET (separate from JWT_SECRET)
- Generate centrifugo.json from template (with real keys)
- Copy fcm-service-account.json to /opt/golosloom/
- Add centrifugo.json to /opt/golosloom/
- Add Centrifugo service to docker-compose
- Open port 8000 internally (not exposed to internet -- Caddy proxies)
- **VAPID_SUBJECT**: ask for email during install (or default to `mailto:admin@{DOMAIN}`) -- currently hardcoded as `mailto:admin@example.com` placeholder

---

## Phase 7: Testing and Data Migration

### 7.1 Dual-mode message decryption

Client supports both formats during migration:

```go
// Server-side (handlers_messages.go):
type Message struct {
    // ...
    Ciphertext       []byte
    ProtocolVersion  int  // 1 = old AES-GCM, 2 = Signal Protocol
    // iv kept for protocol_version=1, ignored for protocol_version=2
}
```

Client decryption logic:

```typescript
function decryptMessage(msg: Message, channelKey?: Uint8Array): string {
    if (msg.protocol_version === 1 && channelKey) {
        // Legacy: AES-256-GCM with shared channel key
        return aesGcmDecrypt(channelKey, msg.iv, msg.ciphertext);
    }
    if (msg.protocol_version === 2) {
        // Signal Protocol: Double Ratchet (1:1) or Sender Keys (group)
        return signalDecrypt(msg.sender_id, msg.ciphertext);
    }
    throw new Error('Unable to decrypt');
}
```

### 7.2 Crypto vector tests

Critical: web (libsignal JS) and mobile (libsignal Dart) MUST produce byte-for-byte compatible ciphertexts.

Test plan:
1. Generate test vectors on web (libsignal JS): encrypt known plaintext with known keys
2. Decrypt on mobile (libsignal Dart) -- verify plaintext matches
3. Generate test vectors on mobile -- decrypt on web
4. Automate in CI: shared test vector file, both platforms run against it

### 7.3 Backward compatibility

During migration period:
- Old clients (before migration) CANNOT read new Signal Protocol messages
- New clients CAN read old AES-GCM messages (dual-mode)
- Recommendation: coordinate update release -- all clients update within a short window
- Server enforces protocol_version=2 for all new messages after migration

### 7.4 Test checklist

| Test | What to verify |
|---|---|
| Crypto vectors | JS <-> Dart byte-for-byte compatibility |
| Signal Protocol handshake | X3DH between two devices works |
| Multi-device key delivery | New device gets all channel keys |
| Pre-key replenishment | Pool < 20 triggers session.needed, client uploads new batch |
| Centrifugo connection | All clients connect with connection JWT |
| Centrifugo subscription | Clients subscribe to channels with subscription tokens |
| Centrifugo disconnect | User banned -> all connections dropped |
| Presence | Online/offline status correct |
| Call flow | Invite -> accept -> LiveKit room -> leave -> ended |
| Call signaling via REST | All call events go through API, not client publish |
| Push notifications | Web Push (browser) + FCM (Android) + APNs via FCM (iOS) |
| Message history | Old messages (protocol_version=1) decrypt correctly |
| New messages | protocol_version=2 encrypts/decrypts correctly |
| Group encryption | Sender Keys work, key rotates on membership change |
| File encryption | File key encrypted via Signal, server stores only ciphertext |
| Device deletion | Removing device invalidates its sessions |
| Admin panel | Stats, user management, channel management still work |
| Rate limiting | Existing limits preserved |
| Auth | JWT login/register still work |
| Legacy WS | desktop-qt still works via /ws during migration |

### 7.5 Migration order

1. Deploy new server (Phase 1) -- backward compatible, /ws endpoint KEPT (deprecated)
2. Deploy new web client (Phase 3) -- dual-mode, reads both formats, uses Centrifugo
3. Deploy new mobile client (Phase 5) -- dual-mode, uses Centrifugo
4. Deploy new desktop client Electron (Phase 4) -- dual-mode, uses Centrifugo
5. Delete desktop-qt (Phase 2) -- AFTER all users migrated
6. **Remove /ws endpoint and delete ws.go, hub/** -- only after step 5
7. Disable protocol_version=1 on server -- enforce Signal Protocol for all new messages.
   Mechanism: POST /api/channels/{id}/messages with protocol_version=1 returns
   403 with error `{"error": "protocol_version_1_deprecated"}`.
   This forces all clients to use protocol_version=2 (Signal Protocol).
8. Clean up old code: DROP TABLE devices_legacy, DROP TABLE channel_keys, drop iv column from messages (after backup)

**Migration completion criteria**: Step 6 (/ws removal) is safe when there have been
ZERO /ws connections in Caddy access logs for the last 7 consecutive days.
Check: `grep '/ws' /data/access.log | tail -1` -- if oldest entry is > 7 days old, safe to remove.

**Critical**: Step 6 (/ws removal) MUST happen after step 5 (desktop-qt removal).
If /ws is removed before desktop-qt users migrate, they lose connectivity.

### 7.6 Cleanup SQL (Phase 7, step 8)

```sql
-- After all clients migrated and protocol_version=1 is disabled:
DROP TABLE IF EXISTS devices_legacy;
DROP TABLE IF EXISTS channel_keys;
-- iv column stays (needed to read old messages forever, unless we re-encrypt history)
-- If clean start was chosen: DELETE FROM messages WHERE protocol_version = 1;
```

---

## Summary of technology choices

| Component | Before | After |
|---|---|---|
| Real-time transport | Gorilla WebSocket (Go) | Centrifugo (Go) |
| Pub/sub | Hand-rolled hub | Centrifugo namespaces |
| Push notifications | Custom Web Push + FCM gateway | Centrifugo push adapters |
| E2E encryption (1:1) | X25519 + AES-256-GCM (custom) | Signal Protocol (X3DH + Double Ratchet) |
| E2E encryption (group) | Shared channel key + per-device wrap | Signal Protocol Sender Keys |
| Desktop wrapper | Tauri 2 + Rust | Electron + Node.js |
| Desktop key storage | Rust keyring crate | Electron safeStorage |
| Mobile real-time | web_socket_channel | Centrifuge Dart SDK |
| Mobile crypto | cryptography package | libsignal (Dart FFI or custom port) |
| File encryption | Shared channel key | Per-file AES key + Signal Protocol key exchange |
| Server crypto | Server-side key wrapping | Server is crypto-blind (relay only) |
| Centrifugo auth | Hardcoded channel list in JWT | Subscription tokens (per-channel) |
| Pre-key management | N/A | Server stores pool, replenishment via session.needed |
