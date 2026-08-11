package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"

	"golosloom/server/internal/models"
)

var (
	ErrNotFound      = errors.New("не найдено")
	ErrDuplicateNick = errors.New("ник уже занят")
	ErrAlreadyMember = errors.New("пользователь уже в канале")
	ErrBanned        = errors.New("пользователь забанен в канале")
	ErrServerBanned  = errors.New("пользователь забанен на сервере")
)

type Store struct {
	db   *sql.DB
	path string
}

func Open(path string) (*Store, error) {
	if dir := filepath.Dir(path); dir != "." && dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, err
		}
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;`)
	if err != nil {
		db.Close()
		return nil, err
	}
	s := &Store{db: db, path: path}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

// RestoreFromFile заменяет рабочую базу данных файлом-снапшотом
// (валидный SQLite-файл, например созданный VACUUM INTO).
func (s *Store) RestoreFromFile(tmpPath string) error {
	if s.db != nil {
		s.db.Close()
	}
	if err := copyFile(tmpPath, s.path); err != nil {
		return err
	}
	// Снапшот согласован — старые WAL/SHM не нужны.
	_ = os.Remove(s.path + "-wal")
	_ = os.Remove(s.path + "-shm")
	db, err := sql.Open("sqlite", s.path)
	if err != nil {
		return err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;`); err != nil {
		db.Close()
		return err
	}
	s.db = db
	return s.migrate()
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

func (s *Store) Close() error { return s.db.Close() }

// Ping проверяет доступность базы данных (health check).
func (s *Store) Ping() error { return s.db.Ping() }

// SnapshotTo создаёт согласованный снапшот базы данных в указанный файл.
func (s *Store) SnapshotTo(dst string) error {
	q := strings.ReplaceAll(dst, "'", "''")
	_, err := s.db.Exec("VACUUM INTO '" + q + "'")
	return err
}

// CountUsers/CountChannels/CountMessages/CountCalls — общие счётчики
// для админ-мониторинга.
// Exec выполняет произвольный SQL (для тестов и админ-операций).
func (s *Store) Exec(query string) (sql.Result, error) { return s.db.Exec(query) }

// SetServerAdmin устанавливает/снимает флаг админа сервера.
func (s *Store) SetServerAdmin(userID int64, admin bool) error {
	v := 0
	if admin {
		v = 1
	}
	_, err := s.db.Exec(`UPDATE users SET is_server_admin = ? WHERE id = ?`, v, userID)
	return err
}

func (s *Store) CountUsers() (int64, error) {
	var n int64
	err := s.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

func (s *Store) CountChannels() (int64, error) {
	var n int64
	err := s.db.QueryRow(`SELECT COUNT(*) FROM channels`).Scan(&n)
	return n, err
}

func (s *Store) CountMessages() (int64, error) {
	var n int64
	err := s.db.QueryRow(`SELECT COUNT(*) FROM messages`).Scan(&n)
	return n, err
}

func (s *Store) CountCalls() (int64, error) {
	var n int64
	err := s.db.QueryRow(`SELECT COUNT(*) FROM calls`).Scan(&n)
	return n, err
}

func now() string { return time.Now().UTC().Format(time.RFC3339Nano) }

var schema = `
CREATE TABLE IF NOT EXISTS users (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	nick TEXT NOT NULL UNIQUE,
	password_hash TEXT NOT NULL,
	is_server_admin INTEGER NOT NULL DEFAULT 0,
	server_banned INTEGER NOT NULL DEFAULT 0,
	server_ban_reason TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	device_id TEXT NOT NULL,
	public_key TEXT NOT NULL,
	created_at TEXT NOT NULL,
	UNIQUE(user_id, device_id)
);
CREATE TABLE IF NOT EXISTS channels (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	private INTEGER NOT NULL DEFAULT 0,
	creator_id INTEGER NOT NULL REFERENCES users(id),
	created_at TEXT NOT NULL,
	deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS channel_members (
	channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	role TEXT NOT NULL DEFAULT 'user',
	banned INTEGER NOT NULL DEFAULT 0,
	ban_reason TEXT NOT NULL DEFAULT '',
	joined_at TEXT NOT NULL,
	PRIMARY KEY (channel_id, user_id)
);
CREATE TABLE IF NOT EXISTS channel_role_permissions (
	channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
	role TEXT NOT NULL,
	permission TEXT NOT NULL,
	allowed INTEGER NOT NULL DEFAULT 1,
	PRIMARY KEY (channel_id, role, permission)
);
CREATE TABLE IF NOT EXISTS messages (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
	sender_id INTEGER NOT NULL REFERENCES users(id),
	ciphertext BLOB NOT NULL,
	iv BLOB NOT NULL,
	history TEXT NOT NULL DEFAULT '[]',
	deleted INTEGER NOT NULL DEFAULT 0,
	deleted_by INTEGER,
	deleted_at TEXT,
	created_at TEXT NOT NULL,
	edited_at TEXT
);
CREATE TABLE IF NOT EXISTS channel_invites (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	invited_by INTEGER NOT NULL REFERENCES users(id),
	status TEXT NOT NULL DEFAULT 'pending',
	created_at TEXT NOT NULL,
	responded_at TEXT
);
CREATE TABLE IF NOT EXISTS channel_keys (
	channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	device_id TEXT NOT NULL,
	wrapped_key BLOB NOT NULL,
	updated_at TEXT NOT NULL,
	PRIMARY KEY (channel_id, user_id, device_id)
);
CREATE TABLE IF NOT EXISTS calls (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
	initiator_id INTEGER NOT NULL REFERENCES users(id),
	status TEXT NOT NULL,
	created_at TEXT NOT NULL,
	ended_at TEXT
);
CREATE TABLE IF NOT EXISTS call_invites (
	call_id INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	status TEXT NOT NULL DEFAULT 'ringing',
	created_at TEXT NOT NULL,
	responded_at TEXT,
	PRIMARY KEY (call_id, user_id)
);
CREATE TABLE IF NOT EXISTS call_participants (
	call_id INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	joined_at TEXT NOT NULL,
	left_at TEXT,
	PRIMARY KEY (call_id, user_id)
);
CREATE TABLE IF NOT EXISTS settings (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS registration_invites (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	token TEXT NOT NULL UNIQUE,
	channel_id INTEGER,
	created_by INTEGER NOT NULL,
	created_at TEXT NOT NULL,
	expires_at TEXT NOT NULL,
	used_at TEXT
);
CREATE TABLE IF NOT EXISTS push_tokens (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	token TEXT NOT NULL UNIQUE,
	created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	endpoint TEXT NOT NULL UNIQUE,
	p256dh TEXT NOT NULL,
	auth TEXT NOT NULL,
	created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, id);
CREATE INDEX IF NOT EXISTS idx_invites_user ON channel_invites(user_id, status);
CREATE INDEX IF NOT EXISTS idx_call_invites_user ON call_invites(user_id, status);
CREATE INDEX IF NOT EXISTS idx_call_participants_user ON call_participants(user_id);
`

func (s *Store) migrate() error {
	if _, err := s.db.Exec(schema); err != nil {
		return err
	}
	// Миграция: колонка аватара (для старых БД).
	_, _ = s.db.Exec(`ALTER TABLE users ADD COLUMN avatar_at TEXT`)
	return nil
}

func parseTime(s string) (time.Time, error) {
	return time.Parse(time.RFC3339Nano, s)
}

func timeOrNil(s sql.NullString) *time.Time {
	if !s.Valid || s.String == "" {
		return nil
	}
	t, err := parseTime(s.String)
	if err != nil {
		return nil
	}
	return &t
}

func stringPtr(t *time.Time) sql.NullString {
	if t == nil {
		return sql.NullString{}
	}
	return sql.NullString{String: t.UTC().Format(time.RFC3339Nano), Valid: true}
}

// ---------- Settings ----------

const settingRegistration = "registration_enabled"

func (s *Store) IsRegistrationEnabled() bool {
	v, err := s.GetSetting(settingRegistration)
	if err != nil {
		return true
	}
	return v == "true"
}

func (s *Store) SetRegistrationEnabled(enabled bool) error {
	return s.SetSetting(settingRegistration, fmt.Sprintf("%t", enabled))
}

// ---------- Приглашения на регистрацию ----------

const RegistrationInviteTTL = 5 * time.Minute

// CreateRegistrationInvite создаёт одноразовое приглашение на регистрацию,
// действующее 5 минут. channelID — канал, в который новый пользователь
// получит доступ сразу после регистрации (если задан).
func (s *Store) CreateRegistrationInvite(token string, channelID *int64, createdBy int64) error {
	expires := time.Now().UTC().Add(RegistrationInviteTTL).Format(time.RFC3339Nano)
	var ch interface{}
	if channelID != nil {
		ch = *channelID
	}
	_, err := s.db.Exec(
		`INSERT INTO registration_invites (token, channel_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
		token, ch, createdBy, now(), expires,
	)
	return err
}

// ErrInviteInvalid — приглашение недействительно (нет/использовано/истекло).
var ErrInviteInvalid = errors.New("приглашение недействительно или истекло")

// ConsumeRegistrationInvite проверяет и помечает приглашение использованным;
// возвращает канал для автоматического доступа (может быть nil).
func (s *Store) ConsumeRegistrationInvite(token string) (*int64, error) {
	var channelID sql.NullInt64
	var usedAt sql.NullString
	var expiresAt string
	err := s.db.QueryRow(
		`SELECT channel_id, used_at, expires_at FROM registration_invites WHERE token = ?`, token,
	).Scan(&channelID, &usedAt, &expiresAt)
	if err != nil {
		return nil, ErrInviteInvalid
	}
	if usedAt.Valid {
		return nil, ErrInviteInvalid
	}
	expires, err := parseTime(expiresAt)
	if err != nil || time.Now().UTC().After(expires) {
		return nil, ErrInviteInvalid
	}
	if _, err := s.db.Exec(`UPDATE registration_invites SET used_at = ? WHERE token = ? AND used_at IS NULL`, now(), token); err != nil {
		return nil, err
	}
	if !channelID.Valid {
		return nil, nil
	}
	id := channelID.Int64
	return &id, nil
}

func (s *Store) GetSetting(key string) (string, error) {
	var v string
	err := s.db.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&v)
	if err == sql.ErrNoRows {
		return "", ErrNotFound
	}
	return v, err
}

func (s *Store) SetSetting(key, value string) error {
	_, err := s.db.Exec(`INSERT INTO settings (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value)
	return err
}

// ---------- Users ----------

func (s *Store) CreateUser(nick, passwordHash string) (*models.User, error) {
	var first bool
	err := s.db.QueryRow(`SELECT NOT EXISTS(SELECT 1 FROM users)`).Scan(&first)
	if err != nil {
		return nil, err
	}
	var admin int
	if first {
		admin = 1
	}
	res, err := s.db.Exec(`INSERT INTO users (nick, password_hash, is_server_admin, created_at)
		VALUES (?, ?, ?, ?)`, nick, passwordHash, admin, now())
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return nil, ErrDuplicateNick
		}
		return nil, err
	}
	id, _ := res.LastInsertId()
	u := &models.User{ID: id, Nick: nick, IsServerAdmin: admin == 1, CreatedAt: time.Now().UTC()}
	return u, nil
}

func (s *Store) GetUserByID(id int64) (*models.User, error) {
	row := s.db.QueryRow(`SELECT id, nick, is_server_admin, server_banned, server_ban_reason, created_at, avatar_at FROM users WHERE id = ?`, id)
	return scanUser(row)
}

func (s *Store) GetUserByNick(nick string) (*models.User, error) {
	row := s.db.QueryRow(`SELECT id, nick, is_server_admin, server_banned, server_ban_reason, created_at, avatar_at FROM users WHERE nick = ?`, nick)
	return scanUser(row)
}

func scanUser(row *sql.Row) (*models.User, error) {
	var u models.User
	var banned int
	var createdAt string
	var avatarAt sql.NullString
	err := row.Scan(&u.ID, &u.Nick, &u.IsServerAdmin, &banned, &u.ServerBanReason, &createdAt, &avatarAt)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	u.ServerBanned = banned == 1
	if t, err := parseTime(createdAt); err == nil {
		u.CreatedAt = t
	}
	if avatarAt.Valid {
		if t, err := parseTime(avatarAt.String); err == nil {
			u.AvatarAt = &t
		}
	}
	return &u, nil
}

func (s *Store) ListUsers() ([]models.User, error) {
	rows, err := s.db.Query(`SELECT id, nick, is_server_admin, server_banned, server_ban_reason, created_at, avatar_at FROM users ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.User
	for rows.Next() {
		var u models.User
		var banned int
		var createdAt string
		var avatarAt sql.NullString
		if err := rows.Scan(&u.ID, &u.Nick, &u.IsServerAdmin, &banned, &u.ServerBanReason, &createdAt, &avatarAt); err != nil {
			return nil, err
		}
		u.ServerBanned = banned == 1
		if t, err := parseTime(createdAt); err == nil {
			u.CreatedAt = t
		}
		if avatarAt.Valid {
			if t, err := parseTime(avatarAt.String); err == nil {
				u.AvatarAt = &t
			}
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func (s *Store) SetPassword(userID int64, passwordHash string) error {
	res, err := s.db.Exec(`UPDATE users SET password_hash = ? WHERE id = ?`, passwordHash, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) PasswordHash(userID int64) (string, error) {
	var h string
	err := s.db.QueryRow(`SELECT password_hash FROM users WHERE id = ?`, userID).Scan(&h)
	if err == sql.ErrNoRows {
		return "", ErrNotFound
	}
	return h, err
}

func (s *Store) SetServerBan(userID int64, reason string) error {
	u, err := s.GetUserByID(userID)
	if err != nil {
		return err
	}
	if u.IsServerAdmin {
		return errors.New("нельзя забанить админа сервера")
	}
	_, err = s.db.Exec(`UPDATE users SET server_banned = 1, server_ban_reason = ? WHERE id = ?`, reason, userID)
	return err
}

func (s *Store) UnbanServer(userID int64) error {
	res, err := s.db.Exec(`UPDATE users SET server_banned = 0, server_ban_reason = '' WHERE id = ?`, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ---------- Devices ----------

func (s *Store) UpsertDevice(userID int64, deviceID, publicKey string) error {
	_, err := s.db.Exec(`INSERT INTO devices (user_id, device_id, public_key, created_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(user_id, device_id) DO UPDATE SET public_key = excluded.public_key`,
		userID, deviceID, publicKey, now())
	return err
}

func (s *Store) GetDevice(userID int64, deviceID string) (*models.Device, error) {
	var d models.Device
	var createdAt string
	err := s.db.QueryRow(`SELECT id, user_id, device_id, public_key, created_at FROM devices WHERE user_id = ? AND device_id = ?`,
		userID, deviceID).Scan(&d.ID, &d.UserID, &d.DeviceID, &d.PublicKey, &createdAt)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if t, err := parseTime(createdAt); err == nil {
		d.CreatedAt = t
	}
	return &d, nil
}

func (s *Store) UserDevices(userID int64) ([]models.Device, error) {
	rows, err := s.db.Query(`SELECT id, user_id, device_id, public_key, created_at FROM devices WHERE user_id = ? ORDER BY id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Device
	for rows.Next() {
		var d models.Device
		var createdAt string
		if err := rows.Scan(&d.ID, &d.UserID, &d.DeviceID, &d.PublicKey, &createdAt); err != nil {
			return nil, err
		}
		if t, err := parseTime(createdAt); err == nil {
			d.CreatedAt = t
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// ---------- Channels ----------

func (s *Store) CreateChannel(name string, private bool, creatorID int64) (*models.Channel, error) {
	var priv int
	if private {
		priv = 1
	}
	res, err := s.db.Exec(`INSERT INTO channels (name, private, creator_id, created_at) VALUES (?, ?, ?, ?)`,
		name, priv, creatorID, now())
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return s.GetChannel(id)
}

func (s *Store) GetChannel(id int64) (*models.Channel, error) {
	var c models.Channel
	var priv int
	var deletedAt sql.NullString
	var createdAt string
	err := s.db.QueryRow(`SELECT id, name, private, creator_id, created_at, deleted_at FROM channels WHERE id = ?`, id).
		Scan(&c.ID, &c.Name, &priv, &c.CreatorID, &createdAt, &deletedAt)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	c.Private = priv == 1
	c.DeletedAt = timeOrNil(deletedAt)
	if t, err := parseTime(createdAt); err == nil {
		c.CreatedAt = t
	}
	if c.DeletedAt != nil {
		return nil, ErrNotFound
	}
	return &c, nil
}

// ListChannelsForUser возвращает каналы, видимые пользователю:
// публичные (не удалённые) + приватные, где он состоит (принял приглашение).
func (s *Store) ListChannelsForUser(userID int64) ([]models.Channel, error) {
	rows, err := s.db.Query(`
		SELECT c.id, c.name, c.private, c.creator_id, c.created_at
		FROM channels c
		WHERE c.deleted_at IS NULL AND (
			c.private = 0 OR EXISTS (
				SELECT 1 FROM channel_members m
				WHERE m.channel_id = c.id AND m.user_id = ?
			)
		)
		ORDER BY c.id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanChannels(rows)
}

func (s *Store) ListAllChannels() ([]models.Channel, error) {
	rows, err := s.db.Query(`SELECT id, name, private, creator_id, created_at FROM channels WHERE deleted_at IS NULL ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanChannels(rows)
}

func scanChannels(rows *sql.Rows) ([]models.Channel, error) {
	var out []models.Channel
	for rows.Next() {
		var c models.Channel
		var priv int
		var createdAt string
		if err := rows.Scan(&c.ID, &c.Name, &priv, &c.CreatorID, &createdAt); err != nil {
			return nil, err
		}
		c.Private = priv == 1
		if t, err := parseTime(createdAt); err == nil {
			c.CreatedAt = t
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) DeleteChannel(id int64) error {
	_, err := s.db.Exec(`UPDATE channels SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`, now(), id)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`DELETE FROM channel_members WHERE channel_id = ?`, id)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`DELETE FROM channel_invites WHERE channel_id = ?`, id)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`DELETE FROM channel_keys WHERE channel_id = ?`, id)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`DELETE FROM messages WHERE channel_id = ?`, id)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`DELETE FROM channel_role_permissions WHERE channel_id = ?`, id)
	return err
}

// ---------- Members ----------

func (s *Store) AddMember(channelID, userID int64, role models.Role) error {
	_, err := s.db.Exec(`INSERT INTO channel_members (channel_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)
		ON CONFLICT(channel_id, user_id) DO UPDATE SET banned = 0, ban_reason = ''`,
		channelID, userID, role, now())
	return err
}

func (s *Store) GetMember(channelID, userID int64) (*models.ChannelMember, error) {
	var m models.ChannelMember
	var banned int
	var joinedAt string
	err := s.db.QueryRow(`SELECT channel_id, user_id, role, banned, ban_reason, joined_at
		FROM channel_members WHERE channel_id = ? AND user_id = ?`, channelID, userID).
		Scan(&m.ChannelID, &m.UserID, &m.Role, &banned, &m.BanReason, &joinedAt)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	m.Banned = banned == 1
	if t, err := parseTime(joinedAt); err == nil {
		m.JoinedAt = t
	}
	return &m, nil
}

func (s *Store) IsMember(channelID, userID int64) bool {
	m, err := s.GetMember(channelID, userID)
	return err == nil && !m.Banned
}

func (s *Store) SetRole(channelID, userID int64, role models.Role) error {
	res, err := s.db.Exec(`UPDATE channel_members SET role = ? WHERE channel_id = ? AND user_id = ?`, role, channelID, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) SetBanned(channelID, userID int64, reason string) error {
	res, err := s.db.Exec(`UPDATE channel_members SET banned = 1, ban_reason = ? WHERE channel_id = ? AND user_id = ?`,
		reason, channelID, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) Unban(channelID, userID int64) error {
	res, err := s.db.Exec(`UPDATE channel_members SET banned = 0, ban_reason = '' WHERE channel_id = ? AND user_id = ?`,
		channelID, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) ListMembers(channelID int64) ([]models.ChannelMember, error) {
	rows, err := s.db.Query(`SELECT channel_id, user_id, role, banned, ban_reason, joined_at
		FROM channel_members WHERE channel_id = ? AND banned = 0 ORDER BY user_id`, channelID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.ChannelMember
	for rows.Next() {
		var m models.ChannelMember
		var banned int
		var joinedAt string
		if err := rows.Scan(&m.ChannelID, &m.UserID, &m.Role, &banned, &m.BanReason, &joinedAt); err != nil {
			return nil, err
		}
		m.Banned = banned == 1
		if t, err := parseTime(joinedAt); err == nil {
			m.JoinedAt = t
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ListBannedMembers возвращает забаненных участников канала.
func (s *Store) ListBannedMembers(channelID int64) ([]models.ChannelMember, error) {
	rows, err := s.db.Query(`SELECT channel_id, user_id, role, banned, ban_reason, joined_at
		FROM channel_members WHERE channel_id = ? AND banned = 1 ORDER BY user_id`, channelID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.ChannelMember
	for rows.Next() {
		var m models.ChannelMember
		var banned int
		var joinedAt string
		if err := rows.Scan(&m.ChannelID, &m.UserID, &m.Role, &banned, &m.BanReason, &joinedAt); err != nil {
			return nil, err
		}
		m.Banned = banned == 1
		if t, err := parseTime(joinedAt); err == nil {
			m.JoinedAt = t
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *Store) MemberChannelIDs(userID int64) ([]int64, error) {
	rows, err := s.db.Query(`SELECT channel_id FROM channel_members WHERE user_id = ? AND banned = 0`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// HasChannelAdmin проверяет, есть ли в канале админ канала.
func (s *Store) HasChannelAdmin(channelID int64) bool {
	var one int
	err := s.db.QueryRow(`SELECT 1 FROM channel_members WHERE channel_id = ? AND role = 'channel_admin' AND banned = 0 LIMIT 1`, channelID).Scan(&one)
	return err == nil
}

// ---------- Permissions ----------

func (s *Store) SetRolePermission(channelID int64, role models.Role, perm models.Permission, allowed bool) error {
	allowedVal := 1
	if !allowed {
		allowedVal = 0
	}
	_, err := s.db.Exec(`INSERT INTO channel_role_permissions (channel_id, role, permission, allowed) VALUES (?, ?, ?, ?)
		ON CONFLICT(channel_id, role, permission) DO UPDATE SET allowed = excluded.allowed`,
		channelID, role, perm, allowedVal)
	return err
}

func (s *Store) ChannelPermissions(channelID int64) (map[models.Role]map[models.Permission]bool, error) {
	rows, err := s.db.Query(`SELECT role, permission, allowed FROM channel_role_permissions WHERE channel_id = ?`, channelID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[models.Role]map[models.Permission]bool{}
	for rows.Next() {
		var role models.Role
		var perm models.Permission
		var allowed int
		if err := rows.Scan(&role, &perm, &allowed); err != nil {
			return nil, err
		}
		if out[role] == nil {
			out[role] = map[models.Permission]bool{}
		}
		out[role][perm] = allowed == 1
	}
	return out, rows.Err()
}

// ---------- Messages ----------

func (s *Store) CreateMessage(channelID, senderID int64, ciphertext, iv []byte) (*models.Message, error) {
	res, err := s.db.Exec(`INSERT INTO messages (channel_id, sender_id, ciphertext, iv, created_at)
		VALUES (?, ?, ?, ?, ?)`, channelID, senderID, ciphertext, iv, now())
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return s.GetMessage(id)
}

func (s *Store) GetMessage(id int64) (*models.Message, error) {
	row := s.db.QueryRow(`SELECT id, channel_id, sender_id, ciphertext, iv, history, deleted, deleted_by, deleted_at, created_at, edited_at
		FROM messages WHERE id = ?`, id)
	return scanMessage(row)
}

func scanMessage(row *sql.Row) (*models.Message, error) {
	var m models.Message
	var history string
	var deleted int
	var deletedBy sql.NullInt64
	var deletedAt, createdAt, editedAt sql.NullString
	err := row.Scan(&m.ID, &m.ChannelID, &m.SenderID, &m.Ciphertext, &m.IV, &history,
		&deleted, &deletedBy, &deletedAt, &createdAt, &editedAt)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	m.Deleted = deleted == 1
	if deletedBy.Valid {
		m.DeletedBy = &deletedBy.Int64
	}
	m.DeletedAt = timeOrNil(deletedAt)
	if t, err := parseTime(createdAt.String); err == nil {
		m.CreatedAt = t
	}
	m.EditedAt = timeOrNil(editedAt)
	if history != "" && history != "[]" {
		_ = json.Unmarshal([]byte(history), &m.History)
	}
	return &m, nil
}

func (s *Store) ListMessages(channelID, beforeID int64, limit int) ([]models.Message, error) {
	rows, err := s.db.Query(`
		SELECT id, channel_id, sender_id, ciphertext, iv, history, deleted, deleted_by, deleted_at, created_at, edited_at
		FROM messages WHERE channel_id = ? AND (? = 0 OR id < ?)
		ORDER BY id DESC LIMIT ?`, channelID, beforeID, beforeID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Message
	for rows.Next() {
		var m models.Message
		var history string
		var deleted int
		var deletedBy sql.NullInt64
		var deletedAt, createdAt, editedAt sql.NullString
		if err := rows.Scan(&m.ID, &m.ChannelID, &m.SenderID, &m.Ciphertext, &m.IV, &history,
			&deleted, &deletedBy, &deletedAt, &createdAt, &editedAt); err != nil {
			return nil, err
		}
		m.Deleted = deleted == 1
		if deletedBy.Valid {
			m.DeletedBy = &deletedBy.Int64
		}
		m.DeletedAt = timeOrNil(deletedAt)
		if t, err := parseTime(createdAt.String); err == nil {
			m.CreatedAt = t
		}
		m.EditedAt = timeOrNil(editedAt)
		if history != "" && history != "[]" {
			_ = json.Unmarshal([]byte(history), &m.History)
		}
		out = append(out, m)
	}
	// инвертируем порядок: от старых к новым
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, rows.Err()
}

// EditMessage сохраняет новую версию и добавляет предыдущую в историю.
func (s *Store) EditMessage(id int64, ciphertext, iv []byte) (*models.Message, error) {
	m, err := s.GetMessage(id)
	if err != nil {
		return nil, err
	}
	history := m.History
	history = append(history, models.MessageVersion{Ciphertext: m.Ciphertext, IV: m.IV, At: m.CreatedAt})
	hj, err := json.Marshal(history)
	if err != nil {
		return nil, err
	}
	_, err = s.db.Exec(`UPDATE messages SET ciphertext = ?, iv = ?, history = ?, edited_at = ? WHERE id = ?`,
		ciphertext, iv, string(hj), now(), id)
	if err != nil {
		return nil, err
	}
	return s.GetMessage(id)
}

func (s *Store) SetMessageDeleted(id int64, deletedBy int64) error {
	_, err := s.db.Exec(`UPDATE messages SET deleted = 1, deleted_by = ?, deleted_at = ? WHERE id = ?`,
		deletedBy, now(), id)
	return err
}

// ---------- Invites ----------

func (s *Store) CreateInvite(channelID, userID, invitedBy int64) (*models.ChannelInvite, error) {
	existing, err := s.GetPendingInvite(channelID, userID)
	if err == nil && existing != nil {
		return nil, errors.New("приглашение уже отправлено")
	}
	res, err := s.db.Exec(`INSERT INTO channel_invites (channel_id, user_id, invited_by, status, created_at)
		VALUES (?, ?, ?, ?, ?)`, channelID, userID, invitedBy, models.InvitePending, now())
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return s.GetInvite(id)
}

func (s *Store) GetPendingInvite(channelID, userID int64) (*models.ChannelInvite, error) {
	var inv models.ChannelInvite
	var respondedAt sql.NullString
	var createdAt string
	err := s.db.QueryRow(`SELECT id, channel_id, user_id, invited_by, status, created_at, responded_at
		FROM channel_invites WHERE channel_id = ? AND user_id = ? AND status = 'pending'`, channelID, userID).
		Scan(&inv.ID, &inv.ChannelID, &inv.UserID, &inv.InvitedBy, &inv.Status, &createdAt, &respondedAt)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if t, err := parseTime(createdAt); err == nil {
		inv.CreatedAt = t
	}
	inv.RespondedAt = timeOrNil(respondedAt)
	return &inv, nil
}

func (s *Store) GetInvite(id int64) (*models.ChannelInvite, error) {
	var inv models.ChannelInvite
	var respondedAt sql.NullString
	var createdAt string
	err := s.db.QueryRow(`SELECT id, channel_id, user_id, invited_by, status, created_at, responded_at
		FROM channel_invites WHERE id = ?`, id).
		Scan(&inv.ID, &inv.ChannelID, &inv.UserID, &inv.InvitedBy, &inv.Status, &createdAt, &respondedAt)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if t, err := parseTime(createdAt); err == nil {
		inv.CreatedAt = t
	}
	inv.RespondedAt = timeOrNil(respondedAt)
	return &inv, nil
}

func (s *Store) RespondInvite(id int64, status string) error {
	_, err := s.db.Exec(`UPDATE channel_invites SET status = ?, responded_at = ? WHERE id = ?`, status, now(), id)
	return err
}

func (s *Store) PendingInvitesForUser(userID int64) ([]models.ChannelInvite, error) {
	rows, err := s.db.Query(`SELECT id, channel_id, user_id, invited_by, status, created_at, responded_at
		FROM channel_invites WHERE user_id = ? AND status = 'pending' ORDER BY id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.ChannelInvite
	for rows.Next() {
		var inv models.ChannelInvite
		var respondedAt sql.NullString
		var createdAt string
		if err := rows.Scan(&inv.ID, &inv.ChannelID, &inv.UserID, &inv.InvitedBy, &inv.Status, &createdAt, &respondedAt); err != nil {
			return nil, err
		}
		if t, err := parseTime(createdAt); err == nil {
			inv.CreatedAt = t
		}
		inv.RespondedAt = timeOrNil(respondedAt)
		out = append(out, inv)
	}
	return out, rows.Err()
}

// ---------- Channel keys ----------

func (s *Store) UpsertChannelKey(channelID, userID int64, deviceID string, wrapped []byte) error {
	_, err := s.db.Exec(`INSERT INTO channel_keys (channel_id, user_id, device_id, wrapped_key, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(channel_id, user_id, device_id) DO UPDATE SET wrapped_key = excluded.wrapped_key, updated_at = excluded.updated_at`,
		channelID, userID, deviceID, wrapped, now())
	return err
}

func (s *Store) GetChannelKey(channelID, userID int64, deviceID string) ([]byte, error) {
	var wrapped []byte
	err := s.db.QueryRow(`SELECT wrapped_key FROM channel_keys WHERE channel_id = ? AND user_id = ? AND device_id = ?`,
		channelID, userID, deviceID).Scan(&wrapped)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return wrapped, err
}

// PendingKeyTargets возвращает устройства участников канала,
// для которых ещё не сохранён обёрнутый ключ канала.
func (s *Store) PendingKeyTargets(channelID int64) ([]models.Device, error) {
	rows, err := s.db.Query(`
		SELECT d.id, d.user_id, d.device_id, d.public_key, d.created_at
		FROM devices d
		JOIN channel_members m ON m.user_id = d.user_id AND m.channel_id = ? AND m.banned = 0
		WHERE NOT EXISTS (
			SELECT 1 FROM channel_keys k WHERE k.channel_id = ? AND k.user_id = d.user_id AND k.device_id = d.device_id
		)
		ORDER BY d.id`, channelID, channelID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Device
	for rows.Next() {
		var d models.Device
		var createdAt string
		if err := rows.Scan(&d.ID, &d.UserID, &d.DeviceID, &d.PublicKey, &createdAt); err != nil {
			return nil, err
		}
		if t, err := parseTime(createdAt); err == nil {
			d.CreatedAt = t
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// ---------- Calls ----------

func (s *Store) CreateCall(channelID, initiatorID int64) (*models.Call, error) {
	res, err := s.db.Exec(`INSERT INTO calls (channel_id, initiator_id, status, created_at) VALUES (?, ?, ?, ?)`,
		channelID, initiatorID, models.CallRinging, now())
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return s.GetCall(id)
}

func (s *Store) GetCall(id int64) (*models.Call, error) {
	var c models.Call
	var endedAt sql.NullString
	var createdAt string
	err := s.db.QueryRow(`SELECT id, channel_id, initiator_id, status, created_at, ended_at FROM calls WHERE id = ?`, id).
		Scan(&c.ID, &c.ChannelID, &c.InitiatorID, &c.Status, &createdAt, &endedAt)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if t, err := parseTime(createdAt); err == nil {
		c.CreatedAt = t
	}
	c.EndedAt = timeOrNil(endedAt)
	return &c, nil
}

func (s *Store) UpdateCallStatus(id int64, status string) error {
	_, err := s.db.Exec(`UPDATE calls SET status = ? WHERE id = ?`, status, id)
	return err
}

// EndAllActiveCalls завершает все активные звонки (при перезапуске сервера:
// медиа-сервер тоже перезапускается, а «зависшие» звонки иначе навсегда
// заблокировали бы инициаторам новые вызовы).
func (s *Store) EndAllActiveCalls() error {
	_, err := s.db.Exec(`UPDATE calls SET status = ?, ended_at = ? WHERE status != ?`,
		models.CallEnded, now(), models.CallEnded)
	return err
}

func (s *Store) EndCall(id int64) error {
	_, err := s.db.Exec(`UPDATE calls SET status = ?, ended_at = ? WHERE id = ?`, models.CallEnded, now(), id)
	return err
}

// ActiveCallsInChannel возвращает активные (не завершённые) звонки в канале.
func (s *Store) ActiveCallsInChannel(channelID int64) ([]models.Call, error) {
	rows, err := s.db.Query(`SELECT id, channel_id, initiator_id, status, created_at, ended_at
		FROM calls WHERE channel_id = ? AND status != 'ended' ORDER BY id`, channelID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Call
	for rows.Next() {
		var c models.Call
		var endedAt sql.NullString
		var createdAt string
		if err := rows.Scan(&c.ID, &c.ChannelID, &c.InitiatorID, &c.Status, &createdAt, &endedAt); err != nil {
			return nil, err
		}
		if t, err := parseTime(createdAt); err == nil {
			c.CreatedAt = t
		}
		c.EndedAt = timeOrNil(endedAt)
		out = append(out, c)
	}
	return out, rows.Err()
}

// HasRingingCallWithUser есть ли в канале активный звонок, где у пользователя
// уже висит непрочитанное (ringing) приглашение.
func (s *Store) HasRingingCallWithUser(channelID, userID int64) (bool, error) {
	var one int
	err := s.db.QueryRow(`
		SELECT 1 FROM call_invites ci
		JOIN calls c ON c.id = ci.call_id
		WHERE c.channel_id = ? AND ci.user_id = ? AND c.status != 'ended' AND ci.status = 'ringing'
		LIMIT 1`, channelID, userID).Scan(&one)
	if err == sql.ErrNoRows {
		return false, nil
	}
	return err == nil, err
}

// UserInActiveCall есть ли пользователь в любом активном звонке канала.
func (s *Store) UserInActiveCall(channelID, userID int64) (bool, error) {
	var one int
	err := s.db.QueryRow(`
		SELECT 1 FROM call_participants cp
		JOIN calls c ON c.id = cp.call_id
		WHERE c.channel_id = ? AND cp.user_id = ? AND cp.left_at IS NULL AND c.status != 'ended'
		LIMIT 1`, channelID, userID).Scan(&one)
	if err == sql.ErrNoRows {
		return false, nil
	}
	return err == nil, err
}

func (s *Store) CreateCallInvite(callID, userID int64) error {
	_, err := s.db.Exec(`INSERT INTO call_invites (call_id, user_id, status, created_at) VALUES (?, ?, ?, ?)
		ON CONFLICT(call_id, user_id) DO NOTHING`, callID, userID, models.CallInviteRinging, now())
	return err
}

func (s *Store) GetCallInvite(callID, userID int64) (*models.CallInvite, error) {
	var ci models.CallInvite
	var respondedAt sql.NullString
	var createdAt string
	err := s.db.QueryRow(`SELECT call_id, user_id, status, created_at, responded_at
		FROM call_invites WHERE call_id = ? AND user_id = ?`, callID, userID).
		Scan(&ci.CallID, &ci.UserID, &ci.Status, &createdAt, &respondedAt)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if t, err := parseTime(createdAt); err == nil {
		ci.CreatedAt = t
	}
	ci.RespondedAt = timeOrNil(respondedAt)
	return &ci, nil
}

func (s *Store) UpdateCallInviteStatus(callID, userID int64, status string) error {
	_, err := s.db.Exec(`UPDATE call_invites SET status = ?, responded_at = ? WHERE call_id = ? AND user_id = ?`,
		status, now(), callID, userID)
	return err
}

func (s *Store) RingingInvites(callID int64) ([]models.CallInvite, error) {
	rows, err := s.db.Query(`SELECT call_id, user_id, status, created_at, responded_at
		FROM call_invites WHERE call_id = ? AND status = 'ringing'`, callID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.CallInvite
	for rows.Next() {
		var ci models.CallInvite
		var respondedAt sql.NullString
		var createdAt string
		if err := rows.Scan(&ci.CallID, &ci.UserID, &ci.Status, &createdAt, &respondedAt); err != nil {
			return nil, err
		}
		if t, err := parseTime(createdAt); err == nil {
			ci.CreatedAt = t
		}
		ci.RespondedAt = timeOrNil(respondedAt)
		out = append(out, ci)
	}
	return out, rows.Err()
}

func (s *Store) AddCallParticipant(callID, userID int64) error {
	_, err := s.db.Exec(`INSERT INTO call_participants (call_id, user_id, joined_at) VALUES (?, ?, ?)
		ON CONFLICT(call_id, user_id) DO UPDATE SET left_at = NULL`, callID, userID, now())
	return err
}

func (s *Store) RemoveCallParticipant(callID, userID int64) error {
	_, err := s.db.Exec(`UPDATE call_participants SET left_at = ? WHERE call_id = ? AND user_id = ? AND left_at IS NULL`,
		now(), callID, userID)
	return err
}

func (s *Store) CallParticipantCount(callID int64) (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM call_participants WHERE call_id = ? AND left_at IS NULL`, callID).Scan(&n)
	return n, err
}

func (s *Store) CallParticipantIDs(callID int64) ([]int64, error) {
	rows, err := s.db.Query(`SELECT user_id FROM call_participants WHERE call_id = ? AND left_at IS NULL ORDER BY user_id`, callID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// CallsVisibleToUser — активные звонки в канале, где пользователь приглашён или участвует.
func (s *Store) CallsVisibleToUser(channelID, userID int64) ([]models.Call, error) {
	rows, err := s.db.Query(`
		SELECT DISTINCT c.id, c.channel_id, c.initiator_id, c.status, c.created_at, c.ended_at
		FROM calls c
		LEFT JOIN call_invites ci ON ci.call_id = c.id AND ci.user_id = ?
		LEFT JOIN call_participants cp ON cp.call_id = c.id AND cp.user_id = ?
		WHERE c.channel_id = ? AND c.status != 'ended'
		  AND (ci.user_id IS NOT NULL OR cp.user_id IS NOT NULL OR c.initiator_id = ?)
		ORDER BY c.id`, userID, userID, channelID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Call
	for rows.Next() {
		var c models.Call
		var endedAt sql.NullString
		var createdAt string
		if err := rows.Scan(&c.ID, &c.ChannelID, &c.InitiatorID, &c.Status, &createdAt, &endedAt); err != nil {
			return nil, err
		}
		if t, err := parseTime(createdAt); err == nil {
			c.CreatedAt = t
		}
		c.EndedAt = timeOrNil(endedAt)
		out = append(out, c)
	}
	return out, rows.Err()
}

// ActiveCallsForParticipant — активные звонки, где пользователь участник.
func (s *Store) ActiveCallsForParticipant(userID int64) ([]models.Call, error) {
	rows, err := s.db.Query(`
		SELECT DISTINCT c.id, c.channel_id, c.initiator_id, c.status, c.created_at, c.ended_at
		FROM calls c
		JOIN call_participants cp ON cp.call_id = c.id AND cp.user_id = ? AND cp.left_at IS NULL
		WHERE c.status != 'ended'`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Call
	for rows.Next() {
		var c models.Call
		var endedAt sql.NullString
		var createdAt string
		if err := rows.Scan(&c.ID, &c.ChannelID, &c.InitiatorID, &c.Status, &createdAt, &endedAt); err != nil {
			return nil, err
		}
		if t, err := parseTime(createdAt); err == nil {
			c.CreatedAt = t
		}
		c.EndedAt = timeOrNil(endedAt)
		out = append(out, c)
	}
	return out, rows.Err()
}

// CountCallsByInitiator — число активных звонков, инициированных пользователем в канале.
func (s *Store) CountCallsByInitiator(channelID, userID int64) (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM calls WHERE channel_id = ? AND initiator_id = ? AND status != 'ended'`,
		channelID, userID).Scan(&n)
	return n, err
}

// ---------- Push-подписки (Web Push) ----------

type PushSubscription struct {
	UserID   int64
	Endpoint string
	P256dh   string
	Auth     string
}

// AddPushSubscription добавляет подписку; при повторной регистрации того же
// эндпоинта обновляет ключи (приложение могло переустановить SW).
func (s *Store) AddPushSubscription(userID int64, endpoint, p256dh, auth string) error {
	_, err := s.db.Exec(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, user_id = excluded.user_id`,
		userID, endpoint, p256dh, auth, now())
	return err
}

func (s *Store) RemovePushSubscription(userID int64, endpoint string) error {
	_, err := s.db.Exec(`DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?`, userID, endpoint)
	return err
}

func (s *Store) PushSubscriptions(userID int64) ([]PushSubscription, error) {
	rows, err := s.db.Query(`SELECT user_id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PushSubscription
	for rows.Next() {
		var p PushSubscription
		if err := rows.Scan(&p.UserID, &p.Endpoint, &p.P256dh, &p.Auth); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// PruneDevices удаляет старые устройства пользователя, оставляя keep последних,
// вместе с их обёрнутыми ключами каналов (у channel_keys нет FK на devices).
func (s *Store) PruneDevices(userID int64, keep int) error {
	if _, err := s.db.Exec(`DELETE FROM channel_keys
		WHERE user_id = ? AND device_id IN (
			SELECT device_id FROM devices WHERE user_id = ? ORDER BY id DESC LIMIT -1 OFFSET ?
		)`, userID, userID, keep); err != nil {
		return err
	}
	_, err := s.db.Exec(`DELETE FROM devices WHERE user_id = ? AND id NOT IN (
		SELECT id FROM devices WHERE user_id = ? ORDER BY id DESC LIMIT ?
	)`, userID, userID, keep)
	return err
}

// ---------- Нативные push-токены (FCM) ----------

func (s *Store) AddFcmToken(userID int64, token string) error {
	_, err := s.db.Exec(`INSERT INTO push_tokens (user_id, token, created_at) VALUES (?, ?, ?)
		ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id`,
		userID, token, now())
	return err
}

func (s *Store) RemoveFcmToken(userID int64, token string) error {
	_, err := s.db.Exec(`DELETE FROM push_tokens WHERE user_id = ? AND token = ?`, userID, token)
	return err
}

func (s *Store) FcmTokens(userID int64) ([]string, error) {
	rows, err := s.db.Query(`SELECT token FROM push_tokens WHERE user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// ActiveCallForUser — активный (не завершённый) звонок, где пользователь
// сейчас участник. Используется для проверки занятости.
func (s *Store) ActiveCallForUser(userID int64) (*models.Call, error) {
	var c models.Call
	var endedAt sql.NullString
	var createdAt string
	err := s.db.QueryRow(`
		SELECT c.id, c.channel_id, c.initiator_id, c.status, c.created_at, c.ended_at
		FROM calls c
		JOIN call_participants cp ON cp.call_id = c.id AND cp.user_id = ? AND cp.left_at IS NULL
		WHERE c.status != 'ended' ORDER BY c.id DESC LIMIT 1`, userID).
		Scan(&c.ID, &c.ChannelID, &c.InitiatorID, &c.Status, &createdAt, &endedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	c.CreatedAt, _ = parseTime(createdAt)
	return &c, nil
}

// ActiveCallsByInitiator — активные звонки инициатора в канале (список).
func (s *Store) ActiveCallsByInitiator(channelID, userID int64) ([]models.Call, error) {
	rows, err := s.db.Query(`SELECT id, channel_id, initiator_id, status, created_at, ended_at
		FROM calls WHERE channel_id = ? AND initiator_id = ? AND status != 'ended' ORDER BY id`,
		channelID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Call
	for rows.Next() {
		var c models.Call
		var endedAt sql.NullString
		var createdAt string
		if err := rows.Scan(&c.ID, &c.ChannelID, &c.InitiatorID, &c.Status, &createdAt, &endedAt); err != nil {
			return nil, err
		}
		c.CreatedAt, _ = parseTime(createdAt)
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) SetUserAvatarAt(userID int64) error {
	_, err := s.db.Exec(`UPDATE users SET avatar_at = ? WHERE id = ?`, now(), userID)
	return err
}

func (s *Store) ClearUserAvatarAt(userID int64) error {
	_, err := s.db.Exec(`UPDATE users SET avatar_at = NULL WHERE id = ?`, userID)
	return err
}

// HasActiveRingingInvite — есть ли у пользователя звонок, где он ждёт ответа.
func (s *Store) HasActiveRingingInvite(userID int64) (bool, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM call_invites ci
		JOIN calls c ON c.id = ci.call_id AND c.status != 'ended'
		WHERE ci.user_id = ? AND ci.status = 'ringing'`, userID).Scan(&n)
	return n > 0, err
}

func (s *Store) CallInvitesForCall(callID int64) ([]models.CallInvite, error) {
	rows, err := s.db.Query(`SELECT call_id, user_id, status, created_at, responded_at
		FROM call_invites WHERE call_id = ?`, callID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.CallInvite
	for rows.Next() {
		var ci models.CallInvite
		var respondedAt sql.NullString
		var createdAt string
		if err := rows.Scan(&ci.CallID, &ci.UserID, &ci.Status, &createdAt, &respondedAt); err != nil {
			return nil, err
		}
		out = append(out, ci)
	}
	return out, rows.Err()
}
