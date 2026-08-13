package store

import (
	"database/sql"
	"testing"

	"golosloom/server/internal/models"
)

func openTest(t *testing.T) *Store {
	t.Helper()
	st, err := Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

func mustUser(t *testing.T, st *Store, nick string) *models.User {
	t.Helper()
	u, err := st.CreateUser(nick, "hash")
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func TestFirstUserIsServerAdmin(t *testing.T) {
	st := openTest(t)
	u1 := mustUser(t, st, "admin")
	if !u1.IsServerAdmin {
		t.Fatal("первый пользователь должен стать админом сервера")
	}
	u2 := mustUser(t, st, "user2")
	if u2.IsServerAdmin {
		t.Fatal("второй пользователь не должен быть админом сервера")
	}
}

func TestDuplicateNick(t *testing.T) {
	st := openTest(t)
	mustUser(t, st, "alice")
	if _, err := st.CreateUser("alice", "hash"); err == nil {
		t.Fatal("дубликат ника должен отклоняться")
	}
}

func TestServerBan(t *testing.T) {
	st := openTest(t)
	admin := mustUser(t, st, "admin")
	u := mustUser(t, st, "bob")
	if err := st.SetServerBan(u.ID, "спам"); err != nil {
		t.Fatal(err)
	}
	got, _ := st.GetUserByID(u.ID)
	if !got.ServerBanned || got.ServerBanReason != "спам" {
		t.Fatal("бан на сервере не применился")
	}
	if err := st.SetServerBan(admin.ID, "x"); err == nil {
		t.Fatal("админа сервера забанить нельзя")
	}
	if err := st.UnbanServer(u.ID); err != nil {
		t.Fatal(err)
	}
	got, _ = st.GetUserByID(u.ID)
	if got.ServerBanned {
		t.Fatal("разбан не сработал")
	}
}

func TestChannelLifecycle(t *testing.T) {
	st := openTest(t)
	u1 := mustUser(t, st, "u1")
	u2 := mustUser(t, st, "u2")
	ch, err := st.CreateChannel("общий", false, u1.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.AddMember(ch.ID, u1.ID, models.RoleChannelAdmin); err != nil {
		t.Fatal(err)
	}
	if err := st.AddMember(ch.ID, u2.ID, models.RoleUser); err != nil {
		t.Fatal(err)
	}
	if !st.IsMember(ch.ID, u2.ID) {
		t.Fatal("участник должен числиться в канале")
	}
	// Приватный канал не виден неучастнику.
	priv, _ := st.CreateChannel("секрет", true, u1.ID)
	visible, err := st.ListChannelsForUser(u2.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range visible {
		if c.ID == priv.ID {
			t.Fatal("приватный канал не должен быть виден неучастнику")
		}
	}
	// После добавления участника — виден.
	if err := st.AddMember(priv.ID, u2.ID, models.RoleUser); err != nil {
		t.Fatal(err)
	}
	visible, _ = st.ListChannelsForUser(u2.ID)
	found := false
	for _, c := range visible {
		if c.ID == priv.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("после вступления приватный канал должен быть виден")
	}
	if err := st.DeleteChannel(ch.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := st.GetChannel(ch.ID); err == nil {
		t.Fatal("удалённый канал не должен находиться")
	}
}

func TestMessagesEditHistoryAndDelete(t *testing.T) {
	st := openTest(t)
	u := mustUser(t, st, "u1")
	ch, _ := st.CreateChannel("ch", false, u.ID)
	m, err := st.CreateMessage(ch.ID, u.ID, []byte("ct1"), []byte("iv1"), 0)
	if err != nil {
		t.Fatal(err)
	}
	edited, err := st.EditMessage(m.ID, []byte("ct2"), []byte("iv2"))
	if err != nil {
		t.Fatal(err)
	}
	if len(edited.History) != 1 {
		t.Fatalf("ожидали 1 версию в истории, получили %d", len(edited.History))
	}
	if string(edited.History[0].Ciphertext) != "ct1" {
		t.Fatal("в истории должен храниться оригинал")
	}
	if err := st.SetMessageDeleted(m.ID, u.ID); err != nil {
		t.Fatal(err)
	}
	got, _ := st.GetMessage(m.ID)
	if !got.Deleted || got.DeletedBy == nil || *got.DeletedBy != u.ID {
		t.Fatal("сообщение не отмечено удалённым")
	}
}

func TestInvites(t *testing.T) {
	st := openTest(t)
	u1 := mustUser(t, st, "u1")
	u2 := mustUser(t, st, "u2")
	ch, _ := st.CreateChannel("ch", true, u1.ID)
	inv, err := st.CreateInvite(ch.ID, u2.ID, u1.ID)
	if err != nil {
		t.Fatal(err)
	}
	if inv.Status != models.InvitePending {
		t.Fatal("приглашение должно быть в статусе pending")
	}
	if _, err := st.CreateInvite(ch.ID, u2.ID, u1.ID); err == nil {
		t.Fatal("повторное приглашение пока pending нельзя")
	}
	if err := st.RespondInvite(inv.ID, models.InviteAccepted); err != nil {
		t.Fatal(err)
	}
	if err := st.AddMember(ch.ID, u2.ID, models.RoleUser); err != nil {
		t.Fatal(err)
	}
	// После отклонения можно прислать повторное.
	if err := st.RespondInvite(inv.ID, models.InviteDeclined); err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateInvite(ch.ID, u2.ID, u1.ID); err != nil {
		t.Fatal("повторное приглашение после ответа должно быть возможно")
	}
}

func TestChannelKeys(t *testing.T) {
	st := openTest(t)
	u1 := mustUser(t, st, "u1")
	u2 := mustUser(t, st, "u2")
	if err := st.UpsertDevice(u1.ID, "dev1", "pubkey1"); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertDevice(u2.ID, "dev2", "pubkey2"); err != nil {
		t.Fatal(err)
	}
	ch, _ := st.CreateChannel("ch", false, u1.ID)
	if err := st.AddMember(ch.ID, u1.ID, models.RoleChannelAdmin); err != nil {
		t.Fatal(err)
	}
	if err := st.AddMember(ch.ID, u2.ID, models.RoleUser); err != nil {
		t.Fatal(err)
	}
	// Пока никто не обернул ключ для u2 — он в списке pending.
	pending, err := st.PendingKeyTargets(ch.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(pending) != 2 {
		t.Fatalf("ожидали 2 цели для обёртки ключа, получили %d", len(pending))
	}
	if err := st.UpsertChannelKey(ch.ID, u2.ID, "dev2", []byte("wrapped")); err != nil {
		t.Fatal(err)
	}
	pending, _ = st.PendingKeyTargets(ch.ID)
	if len(pending) != 1 {
		t.Fatalf("после обёртки должно остаться 1, получили %d", len(pending))
	}
	wrapped, err := st.GetChannelKey(ch.ID, u2.ID, "dev2")
	if err != nil {
		t.Fatal(err)
	}
	if string(wrapped) != "wrapped" {
		t.Fatal("обёрнутый ключ не сохранился")
	}
}

func TestCalls(t *testing.T) {
	st := openTest(t)
	u1 := mustUser(t, st, "u1")
	u2 := mustUser(t, st, "u2")
	ch, _ := st.CreateChannel("ch", false, u1.ID)
	if err := st.AddMember(ch.ID, u1.ID, models.RoleChannelAdmin); err != nil {
		t.Fatal(err)
	}
	if err := st.AddMember(ch.ID, u2.ID, models.RoleUser); err != nil {
		t.Fatal(err)
	}
	call, err := st.CreateCall(ch.ID, u1.ID)
	if err != nil {
		t.Fatal(err)
	}
	if call.Status != models.CallRinging {
		t.Fatal("новый звонок должен быть в статусе ringing")
	}
	if err := st.AddCallParticipant(call.ID, u1.ID); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateCallInvite(call.ID, u2.ID); err != nil {
		t.Fatal(err)
	}
	if err := st.UpdateCallInviteStatus(call.ID, u2.ID, models.CallInviteAccepted); err != nil {
		t.Fatal(err)
	}
	if err := st.AddCallParticipant(call.ID, u2.ID); err != nil {
		t.Fatal(err)
	}
	if err := st.UpdateCallStatus(call.ID, models.CallActive); err != nil {
		t.Fatal(err)
	}
	if n, _ := st.CallParticipantCount(call.ID); n != 2 {
		t.Fatalf("ожидали 2 участников, получили %d", n)
	}
	if err := st.RemoveCallParticipant(call.ID, u1.ID); err != nil {
		t.Fatal(err)
	}
	if err := st.RemoveCallParticipant(call.ID, u2.ID); err != nil {
		t.Fatal(err)
	}
	if n, _ := st.CallParticipantCount(call.ID); n != 0 {
		t.Fatal("после выхода участников не должно остаться")
	}
	has, err := st.HasRingingCallWithUser(ch.ID, u2.ID)
	if err != nil {
		t.Fatal(err)
	}
	if has {
		t.Fatal("статус приглашения accepted не должен считаться ringing")
	}
	active, err := st.ActiveCallsInChannel(ch.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(active) != 1 {
		t.Fatal("звонок должен быть активным")
	}
	if err := st.EndCall(call.ID); err != nil {
		t.Fatal(err)
	}
	active, _ = st.ActiveCallsInChannel(ch.ID)
	if len(active) != 0 {
		t.Fatal("после завершения звонков быть не должно")
	}
}

func TestMigrationPersists(t *testing.T) {
	path := t.TempDir() + "/persist.db"
	st, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	mustUser(t, st, "persist")
	st.Close()
	st2, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer st2.Close()
	if _, err := st2.GetUserByNick("persist"); err != nil {
		t.Fatal("данные должны пережить переоткрытие базы")
	}
}

func TestRegistrationSetting(t *testing.T) {
	st := openTest(t)
	if !st.IsRegistrationEnabled() {
		t.Fatal("по умолчанию регистрация включена")
	}
	if err := st.SetRegistrationEnabled(false); err != nil {
		t.Fatal(err)
	}
	if st.IsRegistrationEnabled() {
		t.Fatal("регистрация должна быть запрещена")
	}
}

func TestTimeParsing(t *testing.T) {
	if timeOrNil(sql.NullString{String: "not-a-time", Valid: true}) != nil {
		t.Fatal("невалидная дата должна давать nil")
	}
}

func TestPruneDevices(t *testing.T) {
	st := openTest(t)
	u := mustUser(t, st, "pruneuser")

	// 10 устройств.
	for i := 0; i < 10; i++ {
		if err := st.UpsertDevice(u.ID, "dev-"+string(rune('a'+i)), "pub"); err != nil {
			t.Fatal(err)
		}
	}
	// У устройства "dev-a" есть обёрнутый ключ канала.
	ch, err := st.CreateChannel("ch", false, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertChannelKey(ch.ID, u.ID, "dev-a", []byte("wrapped")); err != nil {
		t.Fatal(err)
	}

	if err := st.PruneDevices(u.ID, 3); err != nil {
		t.Fatal(err)
	}
	devices, err := st.UserDevices(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(devices) != 3 {
		t.Fatalf("после прунинга должно остаться 3 устройства, осталось %d", len(devices))
	}
	// Ключ старого устройства удалён, последнего — остался.
	if _, err := st.GetChannelKey(ch.ID, u.ID, "dev-a"); err == nil {
		t.Fatal("ключ удалённого устройства должен был удалиться")
	}
	last := devices[len(devices)-1]
	if _, err := st.GetChannelKey(ch.ID, u.ID, last.DeviceID); err != ErrNotFound {
		t.Fatalf("у последнего устройства ключа быть не должно: %v", err)
	}
}
