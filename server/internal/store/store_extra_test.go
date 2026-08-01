package store

import (
	"testing"

	"golosloom/server/internal/models"
)

func TestUserQueries(t *testing.T) {
	st := openTest(t)
	mustUser(t, st, "alice")
	u, err := st.GetUserByNick("alice")
	if err != nil || u.Nick != "alice" {
		t.Fatalf("поиск по нику: %v %v", u, err)
	}
	if _, err := st.GetUserByNick("nobody"); err != ErrNotFound {
		t.Fatal("несуществующий ник должен давать ErrNotFound")
	}
	if _, err := st.GetUserByID(999); err != ErrNotFound {
		t.Fatal("несуществующий id должен давать ErrNotFound")
	}
	if err := st.SetPassword(u.ID, "newhash"); err != nil {
		t.Fatal(err)
	}
	h, err := st.PasswordHash(u.ID)
	if err != nil || h != "newhash" {
		t.Fatal("пароль не обновился")
	}
	if _, err := st.PasswordHash(999); err != ErrNotFound {
		t.Fatal("хэш несуществующего пользователя")
	}
	if err := st.SetPassword(999, "x"); err != ErrNotFound {
		t.Fatal("смена пароля несуществующего пользователя")
	}
	users, err := st.ListUsers()
	if err != nil || len(users) != 1 {
		t.Fatalf("список пользователей: %v %v", users, err)
	}
}

func TestDevices(t *testing.T) {
	st := openTest(t)
	u := mustUser(t, st, "alice")
	if err := st.UpsertDevice(u.ID, "dev1", "pk1"); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertDevice(u.ID, "dev1", "pk2"); err != nil {
		t.Fatal("обновление устройства должно работать")
	}
	d, err := st.GetDevice(u.ID, "dev1")
	if err != nil || d.PublicKey != "pk2" {
		t.Fatalf("устройство: %v %v", d, err)
	}
	if _, err := st.GetDevice(u.ID, "nope"); err != ErrNotFound {
		t.Fatal("несуществующее устройство")
	}
	devs, err := st.UserDevices(u.ID)
	if err != nil || len(devs) != 1 {
		t.Fatalf("устройства пользователя: %v %v", devs, err)
	}
}

func TestChannelErrors(t *testing.T) {
	st := openTest(t)
	u := mustUser(t, st, "alice")
	if _, err := st.GetChannel(123); err != ErrNotFound {
		t.Fatal("несуществующий канал")
	}
	ch, _ := st.CreateChannel("x", false, u.ID)
	if err := st.DeleteChannel(ch.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := st.GetChannel(ch.ID); err != ErrNotFound {
		t.Fatal("удалённый канал не должен находиться")
	}
	channels, err := st.ListAllChannels()
	if err != nil || len(channels) != 0 {
		t.Fatal("все каналы не должны содержать удалённый")
	}
}

func TestMemberOperations(t *testing.T) {
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
	if !st.HasChannelAdmin(ch.ID) {
		t.Fatal("в канале должен быть админ")
	}
	if err := st.SetRole(ch.ID, u2.ID, models.RoleChannelModerator); err != nil {
		t.Fatal(err)
	}
	m, _ := st.GetMember(ch.ID, u2.ID)
	if m.Role != models.RoleChannelModerator {
		t.Fatal("роль не изменилась")
	}
	if err := st.SetBanned(ch.ID, u2.ID, "причина"); err != nil {
		t.Fatal(err)
	}
	if st.IsMember(ch.ID, u2.ID) {
		t.Fatal("забаненный не участник")
	}
	if err := st.Unban(ch.ID, u2.ID); err != nil {
		t.Fatal(err)
	}
	if !st.IsMember(ch.ID, u2.ID) {
		t.Fatal("после разбана снова участник")
	}
	if _, err := st.GetMember(999, u2.ID); err != ErrNotFound {
		t.Fatal("несуществующий канал")
	}
	if err := st.SetRole(ch.ID, u2.ID, models.RoleChannelAdmin); err != nil {
		t.Fatal(err)
	}
	if err := st.SetRole(ch.ID, u2.ID, models.RoleUser); err != nil {
		t.Fatal(err)
	}
	if err := st.SetRole(ch.ID, u1.ID, models.RoleUser); err != nil {
		t.Fatal(err)
	}
	if st.HasChannelAdmin(ch.ID) {
		t.Fatal("после разжалования админов в канале не должно быть админов")
	}
	members, err := st.ListMembers(ch.ID)
	if err != nil || len(members) != 2 {
		t.Fatalf("участники: %v %v", members, err)
	}
	ids, err := st.MemberChannelIDs(u2.ID)
	if err != nil || len(ids) != 1 || ids[0] != ch.ID {
		t.Fatalf("каналы участника: %v %v", ids, err)
	}
}

func TestMessageQueries(t *testing.T) {
	st := openTest(t)
	u := mustUser(t, st, "u1")
	ch, _ := st.CreateChannel("ch", false, u.ID)
	if err := st.AddMember(ch.ID, u.ID, models.RoleChannelAdmin); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 10; i++ {
		if _, err := st.CreateMessage(ch.ID, u.ID, []byte{byte(i)}, []byte{byte(i)}); err != nil {
			t.Fatal(err)
		}
	}
	// Пагинация: последние 3.
	msgs, err := st.ListMessages(ch.ID, 0, 3)
	if err != nil || len(msgs) != 3 {
		t.Fatalf("последние сообщения: %v %v", msgs, err)
	}
	// Старые подгружаются по before.
	before := msgs[0].ID
	older, err := st.ListMessages(ch.ID, before, 50)
	if err != nil || len(older) != 7 {
		t.Fatalf("старые сообщения: %d %v", len(older), err)
	}
	if _, err := st.GetMessage(999); err != ErrNotFound {
		t.Fatal("несуществующее сообщение")
	}
	if _, err := st.EditMessage(999, nil, nil); err != ErrNotFound {
		t.Fatal("редактирование несуществующего сообщения")
	}
	if err := st.SetMessageDeleted(999, u.ID); err != nil {
		t.Fatal("удаление несуществующего сообщения не должно падать")
	}
}

func TestInviteQueries(t *testing.T) {
	st := openTest(t)
	u1 := mustUser(t, st, "u1")
	u2 := mustUser(t, st, "u2")
	ch, _ := st.CreateChannel("ch", true, u1.ID)
	inv, _ := st.CreateInvite(ch.ID, u2.ID, u1.ID)
	if _, err := st.GetPendingInvite(ch.ID, u2.ID); err != nil {
		t.Fatal("ожидающее приглашение должно находиться")
	}
	if err := st.RespondInvite(inv.ID, models.InviteAccepted); err != nil {
		t.Fatal(err)
	}
	if _, err := st.GetPendingInvite(ch.ID, u2.ID); err != ErrNotFound {
		t.Fatal("после ответа pending-приглашения нет")
	}
	if _, err := st.GetInvite(999); err != ErrNotFound {
		t.Fatal("несуществующее приглашение")
	}
	if err := st.RespondInvite(999, models.InviteAccepted); err != nil {
		t.Fatal("ответ на несуществующее приглашение не должен падать")
	}
	pending, err := st.PendingInvitesForUser(u2.ID)
	if err != nil || len(pending) != 0 {
		t.Fatalf("ожидающие приглашения: %v %v", pending, err)
	}
}

func TestCallQueries(t *testing.T) {
	st := openTest(t)
	u1 := mustUser(t, st, "u1")
	u2 := mustUser(t, st, "u2")
	ch, _ := st.CreateChannel("ch", false, u1.ID)
	st.AddMember(ch.ID, u1.ID, models.RoleChannelAdmin)
	st.AddMember(ch.ID, u2.ID, models.RoleUser)
	if _, err := st.GetCall(999); err != ErrNotFound {
		t.Fatal("несуществующий звонок")
	}
	call, _ := st.CreateCall(ch.ID, u1.ID)
	st.AddCallParticipant(call.ID, u1.ID)
	st.CreateCallInvite(call.ID, u2.ID)
	if err := st.CreateCallInvite(call.ID, u2.ID); err != nil {
		t.Fatal("повторный invite не должен падать")
	}
	ringing, err := st.RingingInvites(call.ID)
	if err != nil || len(ringing) != 1 {
		t.Fatalf("ringing-приглашения: %v %v", ringing, err)
	}
	// Дубликат приглашения не создаётся.
	st.UpdateCallInviteStatus(call.ID, u2.ID, models.CallInviteAccepted)
	ringing, _ = st.RingingInvites(call.ID)
	if len(ringing) != 0 {
		t.Fatal("после ответа ringing-приглашений нет")
	}
	st.AddCallParticipant(call.ID, u2.ID)
	if inCall, _ := st.UserInActiveCall(ch.ID, u2.ID); !inCall {
		t.Fatal("u2 должен быть в активном звонке")
	}
	ids, err := st.CallParticipantIDs(call.ID)
	if err != nil || len(ids) != 2 {
		t.Fatalf("участники звонка: %v %v", ids, err)
	}
	if _, err := st.GetCallInvite(call.ID, 999); err != ErrNotFound {
		t.Fatal("несуществующее приглашение в звонок")
	}
	if err := st.UpdateCallInviteStatus(999, u1.ID, models.CallInviteDeclined); err != nil {
		t.Fatal("обновление несуществующего приглашения не должно падать")
	}
	st.UpdateCallStatus(call.ID, models.CallActive)
	visible, err := st.CallsVisibleToUser(ch.ID, u2.ID)
	if err != nil || len(visible) != 1 {
		t.Fatalf("видимые звонки: %v %v", visible, err)
	}
	n, err := st.CountCallsByInitiator(ch.ID, u1.ID)
	if err != nil || n != 1 {
		t.Fatalf("звонки инициатора: %d %v", n, err)
	}
	active, err := st.ActiveCallsInChannel(ch.ID)
	if err != nil || len(active) != 1 {
		t.Fatalf("активные звонки: %v %v", active, err)
	}
	st.RemoveCallParticipant(call.ID, u1.ID)
	st.RemoveCallParticipant(call.ID, u2.ID)
	if inCall, _ := st.UserInActiveCall(ch.ID, u2.ID); inCall {
		t.Fatal("после выхода u2 не в звонке")
	}
	if err := st.EndCall(call.ID); err != nil {
		t.Fatal(err)
	}
	if err := st.UpdateCallStatus(999, models.CallEnded); err != nil {
		t.Fatal("обновление несуществующего звонка не должно падать")
	}
}

func TestSettingsQueries(t *testing.T) {
	st := openTest(t)
	if _, err := st.GetSetting("missing"); err != ErrNotFound {
		t.Fatal("отсутствующая настройка")
	}
	if err := st.SetSetting("a", "1"); err != nil {
		t.Fatal(err)
	}
	if err := st.SetSetting("a", "2"); err != nil {
		t.Fatal(err)
	}
	v, err := st.GetSetting("a")
	if err != nil || v != "2" {
		t.Fatalf("значение настройки: %s %v", v, err)
	}
}

func TestPermissionsQueries(t *testing.T) {
	st := openTest(t)
	u := mustUser(t, st, "u1")
	ch, _ := st.CreateChannel("ch", false, u.ID)
	perms, err := st.ChannelPermissions(ch.ID)
	if err != nil || len(perms) != 0 {
		t.Fatalf("права канала: %v %v", perms, err)
	}
	st.SetRolePermission(ch.ID, models.RoleUser, models.PermSendMessage, true)
	st.SetRolePermission(ch.ID, models.RoleUser, models.PermSendMessage, false)
	perms, _ = st.ChannelPermissions(ch.ID)
	if perms[models.RoleUser][models.PermSendMessage] != false {
		t.Fatal("запрет права должен сохраниться")
	}
	if err := st.DeleteChannel(ch.ID); err != nil {
		t.Fatal(err)
	}
	perms, _ = st.ChannelPermissions(ch.ID)
	if len(perms) != 0 {
		t.Fatal("при удалении канала права должны удаляться")
	}
}

func TestChannelKeysErrors(t *testing.T) {
	st := openTest(t)
	u := mustUser(t, st, "u1")
	ch, _ := st.CreateChannel("ch", false, u.ID)
	if err := st.AddMember(ch.ID, u.ID, models.RoleChannelAdmin); err != nil {
		t.Fatal(err)
	}
	if _, err := st.GetChannelKey(ch.ID, u.ID, "dev"); err != ErrNotFound {
		t.Fatal("отсутствующий ключ")
	}
	if err := st.UpsertChannelKey(ch.ID, u.ID, "dev", []byte("a")); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertChannelKey(ch.ID, u.ID, "dev", []byte("b")); err != nil {
		t.Fatal(err)
	}
	w, _ := st.GetChannelKey(ch.ID, u.ID, "dev")
	if string(w) != "b" {
		t.Fatal("ключ не обновился")
	}
}
