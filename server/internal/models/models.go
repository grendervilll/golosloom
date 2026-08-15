package models

import (
	"encoding/json"
	"time"
)

type Role string

const (
	RoleUser            Role = "user"
	RoleChannelModerator Role = "channel_moderator"
	RoleChannelAdmin    Role = "channel_admin"
	RoleServerAdmin     Role = "server_admin"
)

type Permission string

const (
	PermCreateChannel Permission = "create_channel"
	PermSendMessage   Permission = "send_message"
	PermDeleteMessage Permission = "delete_message"
	PermBan           Permission = "ban"
	PermKick          Permission = "kick"
	PermInvite        Permission = "invite"
	PermDeleteChannel Permission = "delete_channel"
	PermManageMembers Permission = "manage_members"
)

var AllPermissions = []Permission{
	PermCreateChannel, PermSendMessage, PermDeleteMessage,
	PermBan, PermKick, PermInvite, PermDeleteChannel, PermManageMembers,
}

type User struct {
	ID             int64     `json:"id"`
	Nick           string    `json:"nick"`
	IsServerAdmin  bool      `json:"is_server_admin"`
	ServerBanned   bool      `json:"server_banned"`
	ServerBanReason string   `json:"server_ban_reason,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
	// AvatarAt — время последнего обновления аватара (null — аватара нет).
	// Клиенты строят URL /api/avatars/{id}?v=<timestamp>.
	AvatarAt *time.Time `json:"avatar"`
	// TokenVersion — версия токенов: растёт при смене пароля, старые
	// токены перестают действовать («разлогин везде»).
	TokenVersion int64 `json:"-"`
}

type Device struct {
	ID        int64     `json:"id"`
	UserID    int64     `json:"user_id"`
	DeviceID  string    `json:"device_id"`
	PublicKey string    `json:"public_key"`
	CreatedAt time.Time `json:"created_at"`
}

type Channel struct {
	ID        int64      `json:"id"`
	Name      string     `json:"name"`
	Private   bool       `json:"private"`
	CreatorID int64      `json:"creator_id"`
	CreatedAt time.Time  `json:"created_at"`
	DeletedAt *time.Time `json:"-"`
	// Kind: channel | dm | community.
	Kind string `json:"kind"`
	// Readonly — только для чтения (сообщества: пишет только владелец).
	Readonly bool `json:"readonly"`
}

type ChannelMember struct {
	ChannelID int64     `json:"channel_id"`
	UserID    int64     `json:"user_id"`
	Role      Role      `json:"role"`
	Banned    bool      `json:"banned"`
	BanReason string    `json:"ban_reason,omitempty"`
	JoinedAt  time.Time `json:"joined_at"`
}

type MessageVersion struct {
	Ciphertext []byte    `json:"ciphertext"`
	IV         []byte    `json:"iv"`
	At         time.Time `json:"at"`
}

type Message struct {
	ID         int64     `json:"id"`
	ChannelID  int64     `json:"channel_id"`
	SenderID   int64     `json:"sender_id"`
	Ciphertext []byte    `json:"ciphertext"`
	IV         []byte    `json:"iv"`
	CreatedAt  time.Time `json:"created_at"`
	EditedAt   *time.Time `json:"edited_at,omitempty"`
	History    []MessageVersion `json:"history,omitempty"`
	Deleted    bool      `json:"deleted"`
	DeletedBy  *int64    `json:"deleted_by,omitempty"`
	DeletedAt  *time.Time `json:"deleted_at,omitempty"`
	Attachment *Attachment `json:"attachment,omitempty"`
	// Attachments — все живые вложения сообщения (может быть несколько).
	Attachments []Attachment `json:"attachments,omitempty"`
	ReplyTo    *int64    `json:"reply_to,omitempty"`
	// AttachmentDeleted — все вложения удалены администратором сервера
	// (файлы стёрты с диска, сообщение и текст остались).
	AttachmentDeleted bool `json:"attachment_deleted,omitempty"`
}

// Attachment — файл, прикреплённый к сообщению. Контент хранится на диске
// сервера, в БД — только метаданные и путь. Файл удаляется вместе с
// сообщением (или каналом).
type Attachment struct {
	ID       int64  `json:"id"`
	Filename string `json:"filename"`
	Mime     string `json:"mime"`
	Size     int64  `json:"size"`
}

type ChannelInvite struct {
	ID         int64     `json:"id"`
	ChannelID  int64     `json:"channel_id"`
	UserID     int64     `json:"user_id"`
	InvitedBy  int64     `json:"invited_by"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"created_at"`
	RespondedAt *time.Time `json:"responded_at,omitempty"`
}

const (
	InvitePending  = "pending"
	InviteAccepted = "accepted"
	InviteDeclined = "declined"
)

type ChannelKey struct {
	ChannelID  int64     `json:"channel_id"`
	UserID     int64     `json:"user_id"`
	DeviceID   string    `json:"device_id"`
	WrappedKey []byte    `json:"wrapped_key"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type Call struct {
	ID          int64     `json:"id"`
	ChannelID   int64     `json:"channel_id"`
	InitiatorID int64     `json:"initiator_id"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
	EndedAt     *time.Time `json:"ended_at,omitempty"`
}

const (
	CallRinging = "ringing"
	CallActive  = "active"
	CallEnded   = "ended"
)

type CallInvite struct {
	CallID      int64     `json:"call_id"`
	UserID      int64     `json:"user_id"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
	RespondedAt *time.Time `json:"responded_at,omitempty"`
}

const (
	CallInviteRinging      = "ringing"
	CallInviteAccepted     = "accepted"
	CallInviteDeclined     = "declined"
	CallInviteAutoDeclined = "auto_declined"
)

type CallParticipant struct {
	CallID  int64     `json:"call_id"`
	UserID  int64     `json:"user_id"`
	JoinedAt time.Time `json:"joined_at"`
	LeftAt  *time.Time `json:"left_at,omitempty"`
}

type RolePermission struct {
	ChannelID  int64  `json:"channel_id"`
	Role       Role   `json:"role"`
	Permission Permission `json:"permission"`
}

func (m MessageVersion) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		Ciphertext []byte `json:"ciphertext"`
		IV         []byte `json:"iv"`
		At         string `json:"at"`
	}{
		Ciphertext: m.Ciphertext,
		IV:         m.IV,
		At:         m.At.Format(time.RFC3339Nano),
	})
}
