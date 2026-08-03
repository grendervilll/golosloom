package api

import (
	"fmt"
	"net/http"
	"testing"
	"time"
)

// Тест: регистрация по приглашению при запрещённой регистрации.
func TestRegistrationInviteFlow(t *testing.T) {
	a := newTestApp(t, nil)
	admin := a.register(t, "InvAdm") // первый юзер — админ сервера

	// Серверный админ создаёт приватный канал и назначает админа канала.
	ch := a.mustChannel(t, admin.token, "Закрытый", true)
	chanAdmin := a.register(t, "ChanAdm")
	if code, _ := a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/invites", ch), admin.token,
		map[string]int64{"user_id": chanAdmin.id}); code != http.StatusCreated {
		t.Fatalf("приглашение в канал: %d", code)
	}
	_, inv := a.doList(t, http.MethodGet, "/api/invites", chanAdmin.token, nil)
	if len(inv) != 1 {
		t.Fatalf("приглашение не дошло: %v", inv)
	}
	if code, _ := a.do(t, http.MethodPost, fmt.Sprintf("/api/invites/%d/accept", int64(inv[0].(map[string]interface{})["id"].(float64))), chanAdmin.token, nil); code != http.StatusOK {
		t.Fatalf("принятие приглашения: %d", code)
	}
	if code, _ := a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/members/%d/role", ch, chanAdmin.id), admin.token,
		map[string]string{"role": "channel_admin"}); code != http.StatusOK {
		t.Fatalf("назначение админа канала: %d", code)
	}

	// Обычный пользователь (создаём до запрета регистрации).
	plain := a.register(t, "PlainInv")

	// Админ сервера запрещает регистрацию.
	if code, _ := a.do(t, http.MethodPost, "/api/admin/settings/registration", admin.token,
		map[string]bool{"enabled": false}); code != http.StatusOK {
		t.Fatal("не удалось запретить регистрацию")
	}
	// Статус читается (запоминается).
	code, body := a.do(t, http.MethodGet, "/api/admin/settings/registration", admin.token, nil)
	if code != http.StatusOK || body["enabled"] != false {
		t.Fatalf("статус регистрации: %d %v", code, body)
	}

	// Регистрация без приглашения — запрещена.
	code, _ = a.do(t, http.MethodPost, "/api/register", "",
		map[string]string{"nick": "NoInvite", "password": testPW})
	if code != http.StatusForbidden {
		t.Fatalf("регистрация без приглашения: ожидали 403, получили %d", code)
	}

	// Админ канала создаёт приглашение для своего канала.
	code, body = a.do(t, http.MethodPost, "/api/registration/invites", chanAdmin.token,
		map[string]interface{}{"channel_id": ch})
	if code != http.StatusOK {
		t.Fatalf("создание приглашения админом канала: %d %v", code, body)
	}
	token := body["token"].(string)
	if token == "" {
		t.Fatal("пустой токен приглашения")
	}

	// Обычный пользователь не может создать приглашение.
	if code, _ := a.do(t, http.MethodPost, "/api/registration/invites", plain.token,
		map[string]interface{}{"channel_id": ch}); code != http.StatusForbidden {
		t.Fatalf("обычный юзер создал приглашение: %d", code)
	}
	// Админ канала не может создать приглашение для чужого канала.
	other := a.mustChannel(t, admin.token, "Другой", false)
	if code, _ := a.do(t, http.MethodPost, "/api/registration/invites", chanAdmin.token,
		map[string]interface{}{"channel_id": other}); code != http.StatusForbidden {
		t.Fatalf("админ канала создал приглашение в чужой канал: %d", code)
	}

	// Регистрация по приглашению: доступ к приватному каналу сразу.
	u, err := a.srv.Store.GetUserByNick("inviteduser")
	if err == nil {
		t.Fatal("пользователь уже существует")
	}
	code, _ = a.do(t, http.MethodPost, "/api/register", "",
		map[string]string{"nick": "InvitedUser", "password": testPW, "invite": token})
	if code != http.StatusOK {
		t.Fatalf("регистрация по приглашению: %d", code)
	}
	u, err = a.srv.Store.GetUserByNick("inviteduser")
	if err != nil {
		t.Fatal("пользователь не создан")
	}
	m, err := a.srv.Store.GetMember(ch, u.ID)
	if err != nil || m.Banned {
		t.Fatalf("нет доступа к каналу после регистрации: %v %v", m, err)
	}

	// То же приглашение повторно использовать нельзя.
	code, _ = a.do(t, http.MethodPost, "/api/register", "",
		map[string]string{"nick": "InvitedUser2", "password": testPW, "invite": token})
	if code != http.StatusForbidden {
		t.Fatalf("повторное использование приглашения: ожидали 403, получили %d", code)
	}

	// Истёкшее приглашение не работает.
	code, body = a.do(t, http.MethodPost, "/api/registration/invites", admin.token, map[string]interface{}{})
	if code != http.StatusOK {
		t.Fatal("создание приглашения админом сервера не удалось")
	}
	expToken := body["token"].(string)
	if _, err := a.srv.Store.Exec(fmt.Sprintf(
		"UPDATE registration_invites SET expires_at = '%s' WHERE token = '%s'",
		time.Now().UTC().Add(-time.Minute).Format("2006-01-02T15:04:05.999999999Z07:00"), expToken)); err != nil {
		t.Fatal(err)
	}
	code, _ = a.do(t, http.MethodPost, "/api/register", "",
		map[string]string{"nick": "InvitedUser3", "password": testPW, "invite": expToken})
	if code != http.StatusForbidden {
		t.Fatalf("истёкшее приглашение: ожидали 403, получили %d", code)
	}

	// Включение регистрации обратно — без приглашения снова можно.
	if code, _ := a.do(t, http.MethodPost, "/api/admin/settings/registration", admin.token,
		map[string]bool{"enabled": true}); code != http.StatusOK {
		t.Fatal("не удалось разрешить регистрацию")
	}
	code, _ = a.do(t, http.MethodPost, "/api/register", "",
		map[string]string{"nick": "OpenUser", "password": testPW})
	if code != http.StatusOK {
		t.Fatalf("регистрация после включения: %d", code)
	}
}

// Приглашение админа сервера без канала — просто доступ к серверу.
func TestRegistrationInviteServerOnly(t *testing.T) {
	a := newTestApp(t, nil)
	admin := a.register(t, "InvAdm2")
	if code, _ := a.do(t, http.MethodPost, "/api/admin/settings/registration", admin.token,
		map[string]bool{"enabled": false}); code != http.StatusOK {
		t.Fatal("запрет регистрации")
	}
	code, body := a.do(t, http.MethodPost, "/api/registration/invites", admin.token, map[string]interface{}{})
	if code != http.StatusOK {
		t.Fatalf("приглашение админа сервера: %d", code)
	}
	if code, _ := a.do(t, http.MethodPost, "/api/register", "",
		map[string]string{"nick": "ServerInvited", "password": testPW, "invite": body["token"].(string)}); code != http.StatusOK {
		t.Fatalf("регистрация по серверному приглашению: %d", code)
	}
}
