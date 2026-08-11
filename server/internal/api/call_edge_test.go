// Нестандартные сценарии звонков: обрывы, перезагрузки, баны, гонки, дубли.
package api

import (
	"fmt"
	"net/http"
	"testing"
	"time"

)

// 1) Инициатор «перезагрузился» (WS оборвался, без POST leave) — возвращается в звонок.
func TestCallEdgeInitiatorRejoinAfterReload(t *testing.T) {
	a, us, ch := setupCallScenario(t, 3, 30*time.Second)
	callID := a.createCallT(t, us[0].token, ch, []int64{us[1].id, us[2].id})
	for _, u := range us[1:] {
		a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/accept", callID), u.token, nil)
	}
	// Инициатор «закрыл вкладку»: WS оборвался.
	conn := dialWS(t, a, us[0].token)
	time.Sleep(100 * time.Millisecond)
	_ = conn.Close()
	time.Sleep(200 * time.Millisecond)

	// Инициатор возвращается: звонок виден и в него можно войти.
	code, calls := a.doList(t, http.MethodGet, fmt.Sprintf("/api/channels/%d/calls", ch), us[0].token, nil)
	if code != http.StatusOK {
		t.Fatalf("список звонков: %d", code)
	}
	found := false
	for _, c := range calls {
		if int64(c.(map[string]interface{})["id"].(float64)) == callID {
			found = true
		}
	}
	if !found {
		t.Fatalf("инициатор не видит свой звонок после перезагрузки: %v", calls)
	}
	code, body := a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/join", callID), us[0].token, map[string]string{"device_id": "dev"})
	if code != http.StatusOK {
		t.Fatalf("инициатор не может войти в свой звонок: %d %v", code, body)
	}
	if body["token"] == nil {
		t.Fatal("нет токена при возврате инициатора")
	}
	// Участников снова трое.
	n, _ := a.srv.Store.CallParticipantCount(callID)
	if n != 3 {
		t.Fatalf("участников: %d", n)
	}
}

// 2) Участника внезапно выкинуло — он возвращается.
func TestCallEdgeParticipantKickedOffRejoin(t *testing.T) {
	a, us, ch := setupCallScenario(t, 3, 30*time.Second)
	callID := a.createCallT(t, us[0].token, ch, []int64{us[1].id, us[2].id})
	for _, u := range us[1:] {
		a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/accept", callID), u.token, nil)
	}
	// us1 отвалился (WS).
	conn := dialWS(t, a, us[1].token)
	time.Sleep(100 * time.Millisecond)
	_ = conn.Close()
	time.Sleep(200 * time.Millisecond)
	n, _ := a.srv.Store.CallParticipantCount(callID)
	if n != 2 {
		t.Fatalf("после обрыва участника должно быть 2: %d", n)
	}
	// Возвращается и входит.
	code, body := a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/join", callID), us[1].token, map[string]string{"device_id": "dev"})
	if code != http.StatusOK || body["token"] == nil {
		t.Fatalf("повторный вход выкинутого: %d %v", code, body)
	}
}

// 3) Забаненные не могут звонить.
func TestCallEdgeBannedCannotCall(t *testing.T) {
	a := newTestApp(t, nil)
	admin := a.register(t, "BanAdmin")
	if err := a.srv.Store.SetServerAdmin(admin.id, true); err != nil {
		t.Fatal(err)
	}
	caller := a.register(t, "BadCaller")
	victim := a.register(t, "Victim")
	ch := a.mustChannel(t, admin.token, "Канал", false)
	a.join(t, caller.token, ch)
	a.join(t, victim.token, ch)

	// Серверный бан.
	code, _ := a.do(t, http.MethodPost, fmt.Sprintf("/api/admin/users/%d/server-ban", caller.id), admin.token, map[string]string{"reason": "спам"})
	if code != http.StatusOK {
		t.Fatalf("бан: %d", code)
	}
	code, _ = a.do(t, http.MethodPost, "/api/calls", caller.token,
		map[string]interface{}{"channel_id": ch, "target_ids": []int64{victim.id}})
	if code != http.StatusForbidden {
		t.Fatalf("звонок серверно-забаненного: ожидали 403, получили %d", code)
	}

	// Бан в канале.
	admin2 := a.register(t, "BanAdmin2")
	if err := a.srv.Store.SetServerAdmin(admin2.id, true); err != nil {
		t.Fatal(err)
	}
	caller2 := a.register(t, "BadCaller2")
	victim2 := a.register(t, "Victim2")
	ch2 := a.mustChannel(t, admin2.token, "Канал2", false)
	a.join(t, caller2.token, ch2)
	a.join(t, victim2.token, ch2)
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/members/%d/ban", ch2, caller2.id), admin2.token, map[string]string{"reason": "бан"})
	if code != http.StatusOK {
		t.Fatalf("бан в канале: %d", code)
	}
	code, _ = a.do(t, http.MethodPost, "/api/calls", caller2.token,
		map[string]interface{}{"channel_id": ch2, "target_ids": []int64{victim2.id}})
	if code != http.StatusForbidden {
		t.Fatalf("звонок канально-забаненного: ожидали 403, получили %d", code)
	}
}

// 4) Все цели уже заняты.
func TestCallEdgeAllTargetsBusy(t *testing.T) {
	a, us, ch := setupCallScenario(t, 5, 30*time.Second)
	// us1 разговаривает с us2, us3 разговаривает с us4.
	c1 := a.createCallT(t, us[1].token, ch, []int64{us[2].id})
	a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/accept", c1), us[2].token, nil)
	c2 := a.createCallT(t, us[3].token, ch, []int64{us[4].id})
	a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/accept", c2), us[4].token, nil)

	// us0 звонит сразу двум занятым.
	code, body := a.do(t, http.MethodPost, "/api/calls", us[0].token,
		map[string]interface{}{"channel_id": ch, "target_ids": []int64{us[2].id, us[4].id}})
	if code != http.StatusConflict {
		t.Fatalf("все заняты: ожидали 409, получили %d", code)
	}
	msg, _ := body["error"].(string)
	if msg == "" {
		t.Fatalf("нет сообщения: %v", body)
	}
}

// 5) Взаимные звонки «одновременно».
func TestCallEdgeSimultaneousMutexCalls(t *testing.T) {
	a, us, ch := setupCallScenario(t, 2, 30*time.Second)
	// Почти одновременно: A звонит B, B звонит A.
	codeA, _ := a.do(t, http.MethodPost, "/api/calls", us[0].token,
		map[string]interface{}{"channel_id": ch, "target_ids": []int64{us[1].id}})
	codeB, _ := a.do(t, http.MethodPost, "/api/calls", us[1].token,
		map[string]interface{}{"channel_id": ch, "target_ids": []int64{us[0].id}})
	if codeA == http.StatusCreated && codeB == http.StatusCreated {
		t.Fatal("оба взаимных звонка не могут создаться")
	}
	if codeA != http.StatusCreated && codeB != http.StatusCreated {
		t.Fatalf("хотя бы один из взаимных звонков должен создаться: A=%d B=%d", codeA, codeB)
	}
	// Проигравший принимает звонок победителя.
	loser, winner := us[1], us[0]
	if codeA == http.StatusCreated {
		loser, winner = us[0], us[1]
	}
	// Находим звонок победителя (последний активный в канале).
	_, callsList := a.doList(t, http.MethodGet, fmt.Sprintf("/api/channels/%d/calls", ch), winner.token, nil)
	if len(callsList) == 0 {
		t.Fatal("нет звонков")
	}
	winnerCall := int64(callsList[len(callsList)-1].(map[string]interface{})["id"].(float64))
	code, body := a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/accept", winnerCall), loser.token, nil)
	if code != http.StatusOK || body["token"] == nil {
		t.Fatalf("проигравший не может принять звонок победителя: %d %v", code, body)
	}
}

// 6) Инициатор ушёл, пока никто не ответил.
func TestCallEdgeInitiatorLeavesWhileRinging(t *testing.T) {
	a, us, ch := setupCallScenario(t, 2, 30*time.Second)
	callID := a.createCallT(t, us[0].token, ch, []int64{us[1].id})
	a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/leave", callID), us[0].token, nil)
	// Звонок пуст — завершён; приглашённый не может принять.
	code, _ := a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/accept", callID), us[1].token, nil)
	if code != http.StatusGone && code != http.StatusConflict {
		t.Fatalf("accept после ухода инициатора: %d", code)
	}
	call, _ := a.srv.Store.GetCall(callID)
	if call.Status != "ended" {
		t.Fatalf("звонок должен завершиться: %s", call.Status)
	}
}

// 7) Два звонка в одном канале от разных инициаторов.
func TestCallEdgeTwoCallsSameChannel(t *testing.T) {
	a, us, ch := setupCallScenario(t, 4, 30*time.Second)
	a.createCallT(t, us[0].token, ch, []int64{us[1].id})
	code, _ := a.do(t, http.MethodPost, "/api/calls", us[2].token,
		map[string]interface{}{"channel_id": ch, "target_ids": []int64{us[3].id}})
	if code != http.StatusCreated {
		t.Fatalf("второй звонок от другого инициатора: %d", code)
	}
}

// 8) Отклонил — потом решил войти (Войти в звонок).
func TestCallEdgeDeclineThenJoinLater(t *testing.T) {
	a, us, ch := setupCallScenario(t, 2, 30*time.Second)
	callID := a.createCallT(t, us[0].token, ch, []int64{us[1].id})
	a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/decline", callID), us[1].token, nil)
	code, body := a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/join", callID), us[1].token, map[string]string{"device_id": "dev"})
	if code != http.StatusOK || body["token"] == nil {
		t.Fatalf("вход после отклонения: %d %v", code, body)
	}
}

// 9) Двойной вход.
func TestCallEdgeDoubleJoin(t *testing.T) {
	a, us, ch := setupCallScenario(t, 2, 30*time.Second)
	callID := a.createCallT(t, us[0].token, ch, []int64{us[1].id})
	a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/accept", callID), us[1].token, nil)
	code1, _ := a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/join", callID), us[1].token, nil)
	code2, _ := a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/join", callID), us[1].token, nil)
	if code1 != http.StatusOK || code2 != http.StatusOK {
		t.Fatalf("двойной вход: %d, %d", code1, code2)
	}
	n, _ := a.srv.Store.CallParticipantCount(callID)
	if n != 2 {
		t.Fatalf("участников после двойного входа: %d", n)
	}
}

// 10) Дубликаты целей в одном запросе.
func TestCallEdgeDuplicateTargets(t *testing.T) {
	a, us, ch := setupCallScenario(t, 2, 30*time.Second)
	code, body := a.do(t, http.MethodPost, "/api/calls", us[0].token,
		map[string]interface{}{"channel_id": ch, "target_ids": []int64{us[1].id, us[1].id}})
	if code != http.StatusCreated {
		t.Fatalf("звонок с дублями: %d %v", code, body)
	}
	callID := int64(body["call"].(map[string]interface{})["id"].(float64))
	invites, err := a.srv.Store.CallInvitesForCall(callID)
	if err != nil || len(invites) != 1 {
		t.Fatalf("приглашение должно быть одно: %v err=%v", invites, err)
	}
}

// 11) Звонок в удалённый канал.
func TestCallEdgeCallInDeletedChannel(t *testing.T) {
	a, us, ch := setupCallScenario(t, 2, 30*time.Second)
	a.do(t, http.MethodDelete, fmt.Sprintf("/api/channels/%d", ch), us[0].token, nil)
	code, _ := a.do(t, http.MethodPost, "/api/calls", us[0].token,
		map[string]interface{}{"channel_id": ch, "target_ids": []int64{us[1].id}})
	// 400 (нет получателей в удалённом канале), 403 (нет доступа) или 404 — ок.
	if code != http.StatusBadRequest && code != http.StatusForbidden && code != http.StatusNotFound {
		t.Fatalf("звонок в удалённый канал: %d", code)
	}
}

// 12) Пинок неучастником звонка — игнорируется.
func TestCallEdgePunchByOutsider(t *testing.T) {
	a, us, ch := setupCallScenario(t, 3, 30*time.Second)
	callID := a.createCallT(t, us[0].token, ch, []int64{us[1].id})
	a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/accept", callID), us[1].token, nil)
	conn := dialWS(t, a, us[2].token)
	defer conn.Close()
	time.Sleep(100 * time.Millisecond)
	conn.WriteJSON(map[string]interface{}{
		"type": "call.punch",
		"data": map[string]interface{}{"call_id": callID, "target_user_id": us[1].id},
	})
	_ = conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	var msg map[string]interface{}
	if err := conn.ReadJSON(&msg); err == nil && msg["type"] == "punch" {
		t.Fatal("неучастник не должен пинковать")
	}
}

// 13) Отключился, пока все остальные в звонке — инициатор в одиночестве возвращается,
// но без собеседников звонок завершён.
func TestCallEdgeSoleInitiatorRejoinAfterAllLeft(t *testing.T) {
	a, us, ch := setupCallScenario(t, 3, 30*time.Second)
	callID := a.createCallT(t, us[0].token, ch, []int64{us[1].id, us[2].id})
	for _, u := range us[1:] {
		a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/accept", callID), u.token, nil)
	}
	// Оба участника ушли.
	for _, u := range us[1:] {
		a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/leave", callID), u.token, nil)
	}
	// Инициатор «перезагрузился» и пробует войти: звонок пуст → 410.
	code, _ := a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/join", callID), us[0].token, nil)
	if code != http.StatusGone {
		t.Fatalf("вход инициатора в пустой звонок: ожидали 410, получили %d", code)
	}
	// Новый звонок сразу возможен.
	code, _ = a.do(t, http.MethodPost, "/api/calls", us[0].token,
		map[string]interface{}{"channel_id": ch, "target_ids": []int64{us[1].id}})
	if code != http.StatusCreated {
		t.Fatalf("новый звонок: %d", code)
	}
}
