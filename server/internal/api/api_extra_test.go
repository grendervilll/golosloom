package api

import (
	"fmt"
	"net/http"
	"testing"
	"time"

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
		map[string]string{"ciphertext": b64("hi"), "iv": "aXY="})
	if code != http.StatusForbidden {
		t.Fatalf("письмо неучастником: %d", code)
	}
	code, _ = a.do(t, http.MethodGet, fmt.Sprintf("/api/channels/%d/messages", ch), outsider.token, nil)
	if code != http.StatusForbidden {
		t.Fatalf("чтение неучастником: %d", code)
	}
	// Пустое сообщение.
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/messages", ch), user1.token,
		map[string]string{"ciphertext": "", "iv": "aXY="})
	if code != http.StatusBadRequest {
		t.Fatalf("пустое сообщение: %d", code)
	}
	// Редактирование несуществующего сообщения.
	code, _ = a.do(t, http.MethodPatch, fmt.Sprintf("/api/channels/%d/messages/999", ch), user1.token,
		map[string]string{"ciphertext": b64("x"), "iv": "aXY="})
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

func TestCallEndsWhenSoleParticipantDisconnects(t *testing.T) {
	a := newTestApp(t, func(c *config.Config) { c.RingTimeout = 5 * time.Second })
	caller := a.register(t, "Caller")
	u2 := a.register(t, "User2")
	ch := a.mustChannel(t, caller.token, "Канал", false)
	a.join(t, u2.token, ch)
	code, body := a.do(t, http.MethodPost, "/api/calls", caller.token,
		map[string]interface{}{"channel_id": ch, "target_ids": []int64{u2.id}})
	if code != http.StatusCreated {
		t.Fatalf("создание звонка: %d", code)
	}
	callID := int64(body["call"].(map[string]interface{})["id"].(float64))
	// Инициатор — единственный участник; закрываем его подключение.
	conn := dialWS(t, a, caller.token)
	time.Sleep(100 * time.Millisecond)
	_ = conn.Close()
	deadline := time.Now().Add(3 * time.Second)
	for {
		call, _ := a.srv.Store.GetCall(callID)
		if call != nil && call.Status == "ended" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("звонок должен завершиться после отключения единственного участника")
		}
		time.Sleep(50 * time.Millisecond)
	}
	// Теперь инициатор может начать новый звонок.
	code, _ = a.do(t, http.MethodPost, "/api/calls", caller.token,
		map[string]interface{}{"channel_id": ch, "target_ids": []int64{u2.id}})
	if code != http.StatusCreated {
		t.Fatalf("новый звонок после отключения: %d", code)
	}
}

func TestKeyErrorPaths(t *testing.T) {
	a := newTestApp(t, nil)
	user1 := a.register(t, "User1")
	user2 := a.register(t, "User2")
	ch := a.mustChannel(t, user1.token, "Канал", false)
	a.join(t, user2.token, ch)

	// Публикация ключа без device_id.
	code, _ := a.do(t, http.MethodPost, "/api/users/key", user1.token, map[string]string{"public_key": "pk"})
	if code != http.StatusBadRequest {
		t.Fatalf("ключ без device_id: %d", code)
	}
	// Обёртка ключа для несуществующего устройства.
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/keys/wrap", ch), user1.token,
		map[string]interface{}{"user_id": user2.id, "device_id": "nope", "wrapped_key": []byte("x")})
	if code != http.StatusBadRequest {
		t.Fatalf("обёртка для несуществующего устройства: %d", code)
	}
	// Пустой wrapped_key.
	a.do(t, http.MethodPost, "/api/users/key", user2.token, map[string]string{"device_id": "dev2", "public_key": "pk2"})
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/keys/wrap", ch), user1.token,
		map[string]interface{}{"user_id": user2.id, "device_id": "dev2", "wrapped_key": []byte{}})
	if code != http.StatusBadRequest {
		t.Fatalf("пустой wrapped_key: %d", code)
	}
	// Получение ключа без device_id.
	code, _ = a.do(t, http.MethodGet, fmt.Sprintf("/api/channels/%d/keys/me", ch), user1.token, nil)
	if code != http.StatusBadRequest {
		t.Fatalf("ключ без device_id: %d", code)
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

func TestUsersListOnline(t *testing.T) {
	a := newTestApp(t, nil)
	u1 := a.register(t, "User1")
	u2 := a.register(t, "User2")
	conn := dialWS(t, a, u2.token)
	defer conn.Close()
	time.Sleep(100 * time.Millisecond)
	_, list := a.doList(t, http.MethodGet, "/api/users", u1.token, nil)
	found := map[int64]bool{}
	for _, item := range list {
		m := item.(map[string]interface{})
		found[int64(m["id"].(float64))] = m["online"].(bool)
	}
	if found[u2.id] != true || found[u1.id] != false {
		t.Fatalf("статусы онлайн: %v", found)
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

func TestPunchRejectedForNonParticipants(t *testing.T) {
	a := newTestApp(t, func(c *config.Config) { c.RingTimeout = 5 * time.Second })
	caller := a.register(t, "Caller")
	u2 := a.register(t, "User2")
	ch := a.mustChannel(t, caller.token, "Канал", false)
	a.join(t, u2.token, ch)
	code, body := a.do(t, http.MethodPost, "/api/calls", caller.token,
		map[string]interface{}{"channel_id": ch, "target_ids": []int64{u2.id}})
	if code != http.StatusCreated {
		t.Fatalf("создание звонка: %d", code)
	}
	callID := int64(body["call"].(map[string]interface{})["id"].(float64))

	callerConn := dialWS(t, a, caller.token)
	defer callerConn.Close()
	u2Conn := dialWS(t, a, u2.token)
	defer u2Conn.Close()
	// u2 ещё не принял вызов — пинок до него не должен дойти (не участник звонка).
	if err := callerConn.WriteJSON(map[string]interface{}{
		"type": "call.punch", "data": map[string]int64{"call_id": callID, "target_user_id": u2.id},
	}); err != nil {
		t.Fatal(err)
	}
	_ = u2Conn.SetReadDeadline(time.Now().Add(400 * time.Millisecond))
	var msg map[string]interface{}
	if err := u2Conn.ReadJSON(&msg); err == nil && msg["type"] == "punch" {
		t.Fatalf("пинок неучастнику звонка не должен доходить: %v", msg)
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
