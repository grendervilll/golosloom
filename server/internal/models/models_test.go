package models

import (
	"encoding/json"
	"testing"
	"time"
)

func TestRolesAndPermissions(t *testing.T) {
	if RoleServerAdmin != "server_admin" || RoleChannelAdmin != "channel_admin" ||
		RoleChannelModerator != "channel_moderator" || RoleUser != "user" {
		t.Fatal("константы ролей неверны")
	}
	want := []Permission{PermCreateChannel, PermSendMessage, PermDeleteMessage, PermBan, PermKick, PermInvite, PermDeleteChannel, PermManageMembers}
	if len(AllPermissions) != len(want) {
		t.Fatalf("AllPermissions: %v", AllPermissions)
	}
	for i, p := range want {
		if AllPermissions[i] != p {
			t.Fatal("порядок прав неверен")
		}
	}
}

func TestInviteAndCallStatuses(t *testing.T) {
	if InvitePending != "pending" || InviteAccepted != "accepted" || InviteDeclined != "declined" {
		t.Fatal("статусы приглашений неверны")
	}
	if CallRinging != "ringing" || CallActive != "active" || CallEnded != "ended" {
		t.Fatal("статусы звонков неверны")
	}
	if CallInviteRinging != "ringing" || CallInviteAccepted != "accepted" ||
		CallInviteDeclined != "declined" || CallInviteAutoDeclined != "auto_declined" {
		t.Fatal("статусы приглашений в звонок неверны")
	}
}

func TestMessageVersionJSON(t *testing.T) {
	v := MessageVersion{Ciphertext: []byte{1, 2, 3}, IV: []byte{4}, At: time.Unix(1000, 0).UTC()}
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]interface{}
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	if out["at"] != "1970-01-01T00:16:40Z" {
		t.Fatalf("время сериализуется неверно: %v", out["at"])
	}
	if _, ok := out["ciphertext"].(string); !ok {
		t.Fatal("ciphertext должен быть base64-строкой")
	}
}
