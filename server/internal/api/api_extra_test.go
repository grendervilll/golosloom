package api

import (
	"bytes"
	"fmt"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"golosloom/server/internal/config"
)

// ---------- Ошибки доступа ----------

func TestChannelAccessErrors(t *testing.T) {
	a := newTestApp(t, nil)
	user1 := a.register(t, "User1")
	user2 := a.register(t, "User2")
	priv := a.mustChannel(t, user1.token, "Приват", true)
	// Неучастник не видит приватный канал.
	code, _ := a.do(t, http.MethodGet, fmt.Sprintf("/api/channels/%d", priv), user2.token, nil)
	if code != http.StatusForbidden {
		t.Fatalf("доступ к приватному каналу: %d", code)
	}
	// Несуществующий канал.
	code, _ = a.do(t, http.MethodGet, "/api/channels/999", user2.token, nil)
	if code != http.StatusNotFound {
		t.Fatalf("несуществующий канал: %d", code)
	}
	// Удаление несуществующего канала.
	code, _ = a.do(t, http.MethodDelete, "/api/channels/999", user2.token, nil)
	if code != http.StatusNotFound {
		t.Fatalf("удаление несуществующего канала: %d", code)
	}
	// Неавторизованные запросы.
	code, _ = a.do(t, http.MethodGet, "/api/me", "", nil)
	if code != http.StatusUnauthorized {
		t.Fatalf("me без токена: %d", code)
	}
	code, _ = a.do(t, http.MethodGet, "/api/channels", "", nil)
	if code != http.StatusUnauthorized {
		t.Fatalf("каналы без токена: %d", code)
	}
}

func TestRoleAndBanErrorPaths(t *testing.T) {
	a := newTestApp(t, nil)
	admin := a.register(t, "Admin")
	user1 := a.register(t, "User1")
	user2 := a.register(t, "User2")
	ch := a.mustChannel(t, user1.token, "Канал", false)
	a.join(t, user2.token, ch)

	// Недопустимая роль.
	code, _ := a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/members/%d/role", ch, user2.id), user1.token,
		map[string]string{"role": "boss"})
	if code != http.StatusBadRequest {
		t.Fatalf("недопустимая роль: %d", code)
	}
	// Цель не участник канала.
	outsider := a.register(t, "Outsider")
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/members/%d/role", ch, outsider.id), user1.token,
		map[string]string{"role": "channel_moderator"})
	if code != http.StatusNotFound {
		t.Fatalf("роль неучастнику: %d", code)
	}
	// Нельзя менять роль админа сервера.
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/members/%d/role", ch, admin.id), user1.token,
		map[string]string{"role": "user"})
	if code != http.StatusForbidden {
		t.Fatalf("роль админа сервера: %d", code)
	}
	// Админ канала не может разжаловать другого админа канала (только админ сервера).
	user3 := a.register(t, "User3")
	a.join(t, user3.token, ch)
	a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/members/%d/role", ch, user3.id), admin.token,
		map[string]string{"role": "channel_admin"})
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/members/%d/role", ch, user3.id), user1.token,
		map[string]string{"role": "user"})
	if code != http.StatusForbidden {
		t.Fatalf("разжалование админа канала админом канала: %d", code)
	}
	// Бан/кик неучастника — 404.
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/members/%d/ban", ch, outsider.id), user1.token, nil)
	if code != http.StatusNotFound {
		t.Fatalf("бан неучастника: %d", code)
	}
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/members/%d/kick", ch, outsider.id), user1.token, nil)
	if code != http.StatusNotFound {
		t.Fatalf("кик неучастника: %d", code)
	}
	// Недопустимое право.
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/permissions", ch), user1.token,
		map[string]interface{}{"role": "user", "permission": "fly", "allowed": true})
	if code != http.StatusBadRequest {
		t.Fatalf("недопустимое право: %d", code)
	}
	// Права группы настраивает только админ (у user2 нет manage_members).
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/permissions", ch), user2.token,
		map[string]interface{}{"role": "user", "permission": "send_message", "allowed": true})
	if code != http.StatusForbidden {
		t.Fatalf("настройка прав простым пользователем: %d", code)
	}
}

func TestInviteErrorPaths(t *testing.T) {
	a := newTestApp(t, nil)
	user1 := a.register(t, "User1")
	ch := a.mustChannel(t, user1.token, "Канал", true)
	// Несуществующий пользователь.
	code, _ := a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/invites", ch), user1.token,
		map[string]int64{"user_id": 9999})
	if code != http.StatusBadRequest {
		t.Fatalf("приглашение несуществующему пользователю: %d", code)
	}
	// Пустой user_id.
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/invites", ch), user1.token,
		map[string]int64{"user_id": 0})
	if code != http.StatusBadRequest {
		t.Fatalf("приглашение с user_id=0: %d", code)
	}
	// Несуществующее приглашение при ответе.
	code, _ = a.do(t, http.MethodPost, "/api/invites/999/accept", user1.token, nil)
	if code != http.StatusNotFound {
		t.Fatalf("ответ на несуществующее приглашение: %d", code)
	}
}

func TestMessageErrorPaths(t *testing.T) {
	a := newTestApp(t, nil)
	user1 := a.register(t, "User1")
	user2 := a.register(t, "User2")
	ch := a.mustChannel(t, user1.token, "Канал", false)
	a.join(t, user2.token, ch)

	// Неучастник не может писать/читать.
	outsider := a.register(t, "Outsider")
	code, _ := a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/messages", ch), outsider.token,
		map[string]interface{}{"ciphertext": b64("hi"), "iv": "aXY=", "protocol_version": 2})
	if code != http.StatusForbidden {
		t.Fatalf("письмо неучастником: %d", code)
	}
	code, _ = a.do(t, http.MethodGet, fmt.Sprintf("/api/channels/%d/messages", ch), outsider.token, nil)
	if code != http.StatusForbidden {
		t.Fatalf("чтение неучастником: %d", code)
	}
	// Пустое сообщение.
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/messages", ch), user1.token,
		map[string]interface{}{"ciphertext": "", "iv": "aXY=", "protocol_version": 2})
	if code != http.StatusBadRequest {
		t.Fatalf("пустое сообщение: %d", code)
	}
	// Редактирование несуществующего сообщения.
	code, _ = a.do(t, http.MethodPatch, fmt.Sprintf("/api/channels/%d/messages/999", ch), user1.token,
		map[string]interface{}{"ciphertext": b64("x"), "iv": "aXY=", "protocol_version": 2})
	if code != http.StatusNotFound {
		t.Fatalf("редактирование несуществующего: %d", code)
	}
	// Удаление несуществующего сообщения.
	code, _ = a.do(t, http.MethodDelete, fmt.Sprintf("/api/channels/%d/messages/999", ch), user1.token, nil)
	if code != http.StatusNotFound {
		t.Fatalf("удаление несуществующего: %d", code)
	}
}

func TestBannedListAndUnban(t *testing.T) {
	a := newTestApp(t, nil)
	user1 := a.register(t, "User1")
	user2 := a.register(t, "User2")
	ch := a.mustChannel(t, user1.token, "Канал", false)
	a.join(t, user2.token, ch)

	// Бан с причиной.
	code, _ := a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/members/%d/ban", ch, user2.id), user1.token,
		map[string]string{"reason": "спам"})
	if code != http.StatusOK {
		t.Fatalf("бан: %d", code)
	}
	// Список забаненных виден с причиной.
	_, banned := a.doList(t, http.MethodGet, fmt.Sprintf("/api/channels/%d/banned", ch), user1.token, nil)
	if len(banned) != 1 {
		t.Fatalf("забаненные: %v", banned)
	}
	b := banned[0].(map[string]interface{})
	if b["ban_reason"] != "спам" || b["nick"] != "user2" {
		t.Fatalf("данные забаненного: %v", b)
	}
	// Разбан — список пустеет.
	code, _ = a.do(t, http.MethodDelete, fmt.Sprintf("/api/channels/%d/members/%d/ban", ch, user2.id), user1.token, nil)
	if code != http.StatusOK {
		t.Fatalf("разбан: %d", code)
	}
	_, banned = a.doList(t, http.MethodGet, fmt.Sprintf("/api/channels/%d/banned", ch), user1.token, nil)
	if len(banned) != 0 {
		t.Fatalf("после разбана список должен быть пуст: %v", banned)
	}
	// Неучастник канала не видит список забаненных.
	user3 := a.register(t, "User3")
	code, _ = a.do(t, http.MethodGet, fmt.Sprintf("/api/channels/%d/banned", ch), user3.token, nil)
	if code != http.StatusForbidden {
		t.Fatalf("список забаненных неучастнику: %d", code)
	}
}

func TestCallErrorPaths(t *testing.T) {
	a := newTestApp(t, nil)
	caller := a.register(t, "Caller")
	u2 := a.register(t, "User2")
	u3 := a.register(t, "User3")
	ch := a.mustChannel(t, caller.token, "Канал", false)
	a.join(t, u2.token, ch)

	// Звонок без получателей.
	code, _ := a.do(t, http.MethodPost, "/api/calls", caller.token,
		map[string]interface{}{"channel_id": ch, "target_ids": []int64{}})
	if code != http.StatusBadRequest {
		t.Fatalf("звонок без получателей: %d", code)
	}
	// Неучастник канала не может звонить.
	code, _ = a.do(t, http.MethodPost, "/api/calls", u3.token,
		map[string]interface{}{"channel_id": ch, "target_ids": []int64{u2.id}})
	if code != http.StatusForbidden {
		t.Fatalf("звонок неучастником: %d", code)
	}
	// Принятие несуществующего звонка.
	code, _ = a.do(t, http.MethodPost, "/api/calls/999/accept", u2.token, nil)
	if code != http.StatusNotFound {
		t.Fatalf("принятие несуществующего звонка: %d", code)
	}
	// Принятие без приглашения.
	code, body := a.do(t, http.MethodPost, "/api/calls", caller.token,
		map[string]interface{}{"channel_id": ch, "target_ids": []int64{u2.id}})
	if code != http.StatusCreated {
		t.Fatalf("создание звонка: %d", code)
	}
	callID := int64(body["call"].(map[string]interface{})["id"].(float64))
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/accept", callID), u3.token, nil)
	if code != http.StatusForbidden {
		t.Fatalf("принятие неприглашённым: %d", code)
	}
	// Отклонение без приглашения.
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/decline", callID), u3.token, nil)
	if code != http.StatusForbidden {
		t.Fatalf("отклонение неприглашённым: %d", code)
	}
	// Повторное отклонение.
	a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/decline", callID), u2.token, nil)
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/decline", callID), u2.token, nil)
	if code != http.StatusConflict {
		t.Fatalf("повторное отклонение: %d", code)
	}
	// Вход неприглашённого.
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/join", callID), u3.token, nil)
	if code != http.StatusForbidden {
		t.Fatalf("вход неприглашённого: %d", code)
	}
	// Выход из несуществующего звонка.
	code, _ = a.do(t, http.MethodPost, "/api/calls/999/leave", caller.token, nil)
	if code != http.StatusNotFound {
		t.Fatalf("выход из несуществующего звонка: %d", code)
	}
}

func TestAdminErrorPaths(t *testing.T) {
	a := newTestApp(t, nil)
	admin := a.register(t, "Admin")
	user1 := a.register(t, "User1")

	// Слабый пароль при ручной регистрации.
	code, _ := a.do(t, http.MethodPost, "/api/admin/users", admin.token, map[string]string{"nick": "X", "password": "weak"})
	if code != http.StatusBadRequest {
		t.Fatalf("слабый пароль в админке: %d", code)
	}
	// Дубликат ника при ручной регистрации.
	code, _ = a.do(t, http.MethodPost, "/api/admin/users", admin.token, map[string]string{"nick": "User1", "password": testPW})
	if code != http.StatusConflict {
		t.Fatalf("дубликат ника в админке: %d", code)
	}
	// Сброс пароля несуществующему пользователю.
	code, _ = a.do(t, http.MethodPost, "/api/admin/users/999/password", admin.token,
		map[string]string{"password": "NewPassword12!"})
	if code != http.StatusNotFound {
		t.Fatalf("сброс пароля несуществующему: %d", code)
	}
	// Бан несуществующего пользователя.
	code, _ = a.do(t, http.MethodPost, "/api/admin/users/999/server-ban", admin.token, map[string]string{"reason": "x"})
	if code != http.StatusBadRequest {
		t.Fatalf("бан несуществующего: %d", code)
	}
	// Бан админа сервера.
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/admin/users/%d/server-ban", admin.id), admin.token, map[string]string{"reason": "x"})
	if code != http.StatusBadRequest {
		t.Fatalf("бан админа сервера: %d", code)
	}
	// Разбан несуществующего пользователя.
	code, _ = a.do(t, http.MethodDelete, "/api/admin/users/999/server-ban", admin.token, nil)
	if code != http.StatusNotFound {
		t.Fatalf("разбан несуществующего: %d", code)
	}
	// Не-админ не видит админ-панель.
	code, _ = a.do(t, http.MethodGet, "/api/admin/users", user1.token, nil)
	if code != http.StatusForbidden {
		t.Fatalf("админ панель не-админу: %d", code)
	}
	// Не-админ не может банить на сервере.
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/admin/users/%d/server-ban", admin.id), user1.token, nil)
	if code != http.StatusForbidden {
		t.Fatalf("серверный бан не-админом: %d", code)
	}
}

func TestConfigWithoutTurnSecret(t *testing.T) {
	a := newTestApp(t, func(c *config.Config) { c.TurnSharedSecret = "" })
	u := a.register(t, "User1")
	_, cfg := a.do(t, http.MethodGet, "/api/config", u.token, nil)
	turn := cfg["turn"].(map[string]interface{})
	if turn["username"] != "" || turn["credential"] != "" {
		t.Fatal("без секрета TURN учётные данные пусты")
	}
}

func TestHealthCheck(t *testing.T) {
	a := newTestApp(t, nil)
	code, body := a.do(t, http.MethodGet, "/api/health", "", nil)
	if code != http.StatusOK {
		t.Fatalf("health: ожидали 200, получили %d", code)
	}
	if body["status"] != "ok" {
		t.Fatalf("health: статус не ok: %v", body)
	}
	for _, key := range []string{"status", "version", "uptime_sec"} {
		if _, exists := body[key]; !exists {
			t.Fatalf("в health нет поля %s: %v", key, body)
		}
	}
}

func TestPushSubscribeAndUnsubscribe(t *testing.T) {
	a := newTestApp(t, nil)
	u := a.register(t, "PushUser")

	code, _ := a.do(t, http.MethodPost, "/api/push/subscribe", u.token, map[string]string{
		"endpoint": "https://example.com/push/ep1",
		"p256dh":   "key1",
		"auth":     "auth1",
	})
	if code != http.StatusOK {
		t.Fatalf("подписка: ожидали 200, получили %d", code)
	}

	// Повторная регистрация того же эндпоинта — обновление ключей, не ошибка.
	code, _ = a.do(t, http.MethodPost, "/api/push/subscribe", u.token, map[string]string{
		"endpoint": "https://example.com/push/ep1",
		"p256dh":   "key2",
		"auth":     "auth2",
	})
	if code != http.StatusOK {
		t.Fatalf("повторная подписка: %d", code)
	}
	subs, err := a.srv.Store.PushSubscriptions(u.id)
	if err != nil || len(subs) != 1 || subs[0].P256dh != "key2" {
		t.Fatalf("в БД должно быть 1 обновлённая подписка: %v, err=%v", subs, err)
	}

	// Пустой запрос — 400.
	code, _ = a.do(t, http.MethodPost, "/api/push/subscribe", u.token, map[string]string{})
	if code != http.StatusBadRequest {
		t.Fatalf("пустая подписка: ожидали 400, получили %d", code)
	}

	// Отписка.
	code, _ = a.do(t, http.MethodDelete, "/api/push/subscribe", u.token, map[string]string{
		"endpoint": "https://example.com/push/ep1",
	})
	if code != http.StatusOK {
		t.Fatalf("отписка: %d", code)
	}
	subs, _ = a.srv.Store.PushSubscriptions(u.id)
	if len(subs) != 0 {
		t.Fatalf("после отписки подписок быть не должно: %v", subs)
	}

	// Без токена — 401.
	code, _ = a.do(t, http.MethodPost, "/api/push/subscribe", "", map[string]string{
		"endpoint": "e", "p256dh": "k", "auth": "a",
	})
	if code != http.StatusUnauthorized {
		t.Fatalf("без токена: ожидали 401, получили %d", code)
	}
}

func TestFcmTokenSubscribeAndRemove(t *testing.T) {
	a := newTestApp(t, nil)
	u := a.register(t, "FcmUser")

	code, _ := a.do(t, http.MethodPost, "/api/push/fcm", u.token, map[string]string{"token": "fcm-token-1"})
	if code != http.StatusOK {
		t.Fatalf("регистрация FCM: ожидали 200, получили %d", code)
	}
	tokens, err := a.srv.Store.FcmTokens(u.id)
	if err != nil || len(tokens) != 1 || tokens[0] != "fcm-token-1" {
		t.Fatalf("FCM-токен не сохранился: %v, err=%v", tokens, err)
	}

	// Пустой токен — 400.
	code, _ = a.do(t, http.MethodPost, "/api/push/fcm", u.token, map[string]string{})
	if code != http.StatusBadRequest {
		t.Fatalf("пустой токен: ожидали 400, получили %d", code)
	}

	code, _ = a.do(t, http.MethodDelete, "/api/push/fcm", u.token, map[string]string{"token": "fcm-token-1"})
	if code != http.StatusOK {
		t.Fatalf("удаление FCM: %d", code)
	}
	tokens, _ = a.srv.Store.FcmTokens(u.id)
	if len(tokens) != 0 {
		t.Fatalf("после удаления токенов быть не должно: %v", tokens)
	}

	// Без токена — 401.
	code, _ = a.do(t, http.MethodPost, "/api/push/fcm", "", map[string]string{"token": "x"})
	if code != http.StatusUnauthorized {
		t.Fatalf("без токена: ожидали 401, получили %d", code)
	}
}

func TestCallBusyUserRejected(t *testing.T) {
	a := newTestApp(t, nil)
	caller := a.register(t, "CallerB")
	u2 := a.register(t, "BusyUser")
	u3 := a.register(t, "ThirdUser")
	ch := a.mustChannel(t, caller.token, "Канал", false)
	a.join(t, u2.token, ch)
	a.join(t, u3.token, ch)

	// u3 уже разговаривает (звонок от u2 с участием u3).
	code, _ := a.do(t, http.MethodPost, "/api/calls", u2.token,
		map[string]interface{}{"channel_id": ch, "target_ids": []int64{u3.id}})
	if code != http.StatusCreated {
		t.Fatalf("создание звонка: %d", code)
	}

	// caller звонит занятому u3 — 409 с понятным сообщением.
	code, body := a.do(t, http.MethodPost, "/api/calls", caller.token,
		map[string]interface{}{"channel_id": ch, "target_ids": []int64{u3.id}})
	if code != http.StatusConflict {
		t.Fatalf("звонок занятому: ожидали 409, получили %d", code)
	}
	if msg, _ := body["error"].(string); !strings.Contains(msg, "уже с кем-то разговаривает") {
		t.Fatalf("сообщение о занятости: %q", msg)
	}
}

func TestAvatarUploadGetDelete(t *testing.T) {
	a := newTestApp(t, nil)
	u := a.register(t, "AvatarUser")

	// Аватара нет.
	code, _ := a.doRaw(t, http.MethodGet, "/api/avatars/"+strconv.FormatInt(u.id, 10), "", nil)
	if code != http.StatusNotFound {
		t.Fatalf("аватар без загрузки: ожидали 404, получили %d", code)
	}

	// Загрузка через multipart.
	uploadAvatar := func(token string) int {
		var buf bytes.Buffer
		mw := multipart.NewWriter(&buf)
		fw, _ := mw.CreateFormFile("file", "a.jpg")
		_, _ = fw.Write([]byte("fake-jpeg-bytes"))
		_ = mw.Close()
		req, err := http.NewRequest(http.MethodPost, a.ts.URL+"/api/me/avatar", &buf)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", mw.FormDataContentType())
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	if code := uploadAvatar(""); code != http.StatusUnauthorized {
		t.Fatalf("загрузка без токена: ожидали 401, получили %d", code)
	}
	if code := uploadAvatar(u.token); code != http.StatusOK {
		t.Fatalf("загрузка аватара: %d", code)
	}

	// Аватар отдаётся публично.
	code, raw := a.doRaw(t, http.MethodGet, "/api/avatars/"+strconv.FormatInt(u.id, 10), "", nil)
	_ = raw
	if code != http.StatusOK {
		t.Fatalf("раздача аватара: %d", code)
	}

	// В /api/me появился avatar.
	code, me := a.do(t, http.MethodGet, "/api/me", u.token, nil)
	if code != http.StatusOK || me["avatar"] == nil {
		t.Fatalf("в /api/me нет avatar: %d %v", code, me)
	}

	// Удаление.
	code, _ = a.do(t, http.MethodDelete, "/api/me/avatar", u.token, nil)
	if code != http.StatusOK {
		t.Fatalf("удаление аватара: %d", code)
	}
	code, _ = a.doRaw(t, http.MethodGet, "/api/avatars/"+strconv.FormatInt(u.id, 10), "", nil)
	if code != http.StatusNotFound {
		t.Fatalf("аватар после удаления: ожидали 404, получили %d", code)
	}
}
