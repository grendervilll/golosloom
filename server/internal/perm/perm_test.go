package perm

import (
	"testing"

	"golosloom/server/internal/models"
	"golosloom/server/internal/store"
)

func newTestStore(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

func TestDefaults(t *testing.T) {
	st := newTestStore(t)
	creator, err := st.CreateUser("creator", "hash")
	if err != nil {
		t.Fatal(err)
	}
	ch, err := st.CreateChannel("test", false, creator.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !Can(st, ch.ID, models.RoleUser, models.PermSendMessage) {
		t.Fatal("пользователь должен уметь писать сообщения")
	}
	if Can(st, ch.ID, models.RoleUser, models.PermBan) {
		t.Fatal("пользователь не должен уметь банить")
	}
	if Can(st, ch.ID, models.RoleUser, models.PermKick) {
		t.Fatal("пользователь не должен уметь кикать")
	}
	if !Can(st, ch.ID, models.RoleChannelModerator, models.PermBan) {
		t.Fatal("модератор должен уметь банить")
	}
	if !Can(st, ch.ID, models.RoleChannelModerator, models.PermKick) {
		t.Fatal("модератор должен уметь кикать")
	}
	if Can(st, ch.ID, models.RoleChannelModerator, models.PermDeleteChannel) {
		t.Fatal("модератор не должен удалять канал")
	}
	if !Can(st, ch.ID, models.RoleChannelAdmin, models.PermDeleteChannel) {
		t.Fatal("админ канала должен удалять канал")
	}
	if !Can(st, ch.ID, models.RoleChannelAdmin, models.PermManageMembers) {
		t.Fatal("админ канала должен управлять участниками")
	}
}

func TestServerAdminEverything(t *testing.T) {
	st := newTestStore(t)
	for _, perm := range models.AllPermissions {
		if !Can(st, 0, models.RoleServerAdmin, perm) {
			t.Fatalf("админ сервера должен иметь право %s", perm)
		}
	}
}

func TestOverrides(t *testing.T) {
	st := newTestStore(t)
	creator, err := st.CreateUser("creator", "hash")
	if err != nil {
		t.Fatal(err)
	}
	ch, err := st.CreateChannel("test", false, creator.ID)
	if err != nil {
		t.Fatal(err)
	}
	// Отбираем у пользователя право писать в канале.
	if err := st.SetRolePermission(ch.ID, models.RoleUser, models.PermSendMessage, false); err != nil {
		t.Fatal(err)
	}
	if Can(st, ch.ID, models.RoleUser, models.PermSendMessage) {
		t.Fatal("переопределение должно запретить отправку сообщений")
	}
	// Переопределение действует только в этом канале.
	ch2, err := st.CreateChannel("test2", false, creator.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !Can(st, ch2.ID, models.RoleUser, models.PermSendMessage) {
		t.Fatal("в другом канале права должны остаться по умолчанию")
	}
	// Возвращаем право обратно.
	if err := st.SetRolePermission(ch.ID, models.RoleUser, models.PermSendMessage, true); err != nil {
		t.Fatal(err)
	}
	if !Can(st, ch.ID, models.RoleUser, models.PermSendMessage) {
		t.Fatal("право должно вернуться")
	}
}
