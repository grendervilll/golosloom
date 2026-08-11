// Комплексное тестирование жизненного цикла звонков: все комбинации —
// создание, приглашения, занятость, выход/повторный вход, завершение,
// таймауты, WS-события.
package api

import (
	"fmt"
	"net/http"
	"testing"
	"time"


	"golosloom/server/internal/config"
)

// makeCall создаёт звонок и возвращает его id (упрощённый хелпер).
func (a *testApp) createCallT(t *testing.T, token string, channelID int64, targets []int64) int64 {
	t.Helper()
	code, body := a.do(t, http.MethodPost, "/api/calls", token,
		map[string]interface{}{"channel_id": channelID, "target_ids": targets})
	if code != http.StatusCreated {
		t.Fatalf("создание звонка: %d %v", code, body)
	}
	return int64(body["call"].(map[string]interface{})["id"].(float64))
}

// setupCallScenario — канал с N участниками; возвращает их и канал.
func setupCallScenario(t *testing.T, n int, timeout time.Duration) (*testApp, []*testUser, int64) {
	a := newTestApp(t, func(c *config.Config) { c.RingTimeout = timeout })
	users := make([]*testUser, 0, n)
	for i := 0; i < n; i++ {
		users = append(users, a.register(t, fmt.Sprintf("CallU%d", i)))
	}
	ch := a.mustChannel(t, users[0].token, "КаналЗвонок", false)
	for _, u := range users[1:] {
		a.join(t, u.token, ch)
	}
	return a, users, ch
}

// ---------- Создание и приглашения ----------

func TestCallFlowBasicAccept(t *testing.T) {
	a, us, ch := setupCallScenario(t, 3, 30*time.Second)
	callID := a.createCallT(t, us[0].token, ch, []int64{us[1].id, us[2].id})

	// Оба приглашённых принимают.
	for _, u := range us[1:] {
		code, body := a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/accept", callID), u.token, map[string]string{"device_id": "dev"})
		if code != http.StatusOK {
			t.Fatalf("accept %s: %d %v", u.nick, code, body)
		}
		if body["token"] == nil {
			t.Fatalf("accept %s: нет токена", u.nick)
		}
	}
	// Все трое — участники.
	call, _ := a.srv.Store.GetCall(callID)
	if call.Status != "active" {
		t.Fatalf("статус после двух accept: %s", call.Status)
	}
	n, _ := a.srv.Store.CallParticipantCount(callID)
	if n != 3 {
		t.Fatalf("участников должно быть 3: %d", n)
	}
}

func TestCallFlowOneDeclines(t *testing.T) {
	a, us, ch := setupCallScenario(t, 3, 30*time.Second)
	callID := a.createCallT(t, us[0].token, ch, []int64{us[1].id, us[2].id})

	// us1 отклоняет, us2 принимает — звонок продолжается.
	code, _ := a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/decline", callID), us[1].token, nil)
	if code != http.StatusOK {
		t.Fatalf("decline: %d", code)
	}
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/accept", callID), us[2].token, nil)
	if code != http.StatusOK {
		t.Fatalf("accept после decline другого: %d", code)
	}
	// Отклонивший не может принять позже.
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/accept", callID), us[1].token, nil)
	if code != http.StatusConflict {
		t.Fatalf("accept после своего decline: ожидали 409, получили %d", code)
	}
}

func TestCallFlowAcceptAfterTimeout(t *testing.T) {
	a, us, ch := setupCallScenario(t, 3, 1*time.Second)
	callID := a.createCallT(t, us[0].token, ch, []int64{us[1].id, us[2].id})
	time.Sleep(1500 * time.Millisecond)
	// Приглашения автоотклонены — accept невозможен.
	code, _ := a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/accept", callID), us[1].token, nil)
	if code != http.StatusConflict {
		t.Fatalf("accept после таймаута: ожидали 409, получили %d", code)
	}
}

func TestCallFlowTargetNotMember(t *testing.T) {
	a := newTestApp(t, nil)
	caller := a.register(t, "NotMemCaller")
	outsider := a.register(t, "NotMemOutsider")
	ch := a.mustChannel(t, caller.token, "Канал", false)
	// Звонок неучастнику канала: цели не будет — 400.
	code, _ := a.do(t, http.MethodPost, "/api/calls", caller.token,
		map[string]interface{}{"channel_id": ch, "target_ids": []int64{outsider.id}})
	if code != http.StatusBadRequest {
		t.Fatalf("звонок неучастнику: ожидали 400, получили %d", code)
	}
}

func TestCallFlowSelfOnly(t *testing.T) {
	a, us, ch := setupCallScenario(t, 2, 30*time.Second)
	code, _ := a.do(t, http.MethodPost, "/api/calls", us[0].token,
		map[string]interface{}{"channel_id": ch, "target_ids": []int64{us[0].id}})
	if code != http.StatusBadRequest {
		t.Fatalf("звонок самому себе: ожидали 400, получили %d", code)
	}
}

// ---------- Занятость ----------

func TestCallFlowBusyMatrix(t *testing.T) {
	a, us, ch := setupCallScenario(t, 4, 30*time.Second)
	// us1 звонит us2; us2 в звонке (инициатор — участник).
	callID := a.createCallT(t, us[0].token, ch, []int64{us[1].id})
	// us1 занят как инициатор.
	code, _ := a.do(t, http.MethodPost, "/api/calls", us[1].token,
		map[string]interface{}{"channel_id": ch, "target_ids": []int64{us[0].id}})
	if code != http.StatusConflict {
		t.Fatalf("звонок инициатору: ожидали 409, получили %d", code)
	}
	// us2 принимает — теперь занят как участник.
	a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/accept", callID), us[1].token, nil)
	code, _ = a.do(t, http.MethodPost, "/api/calls", us[2].token,
		map[string]interface{}{"channel_id": ch, "target_ids": []int64{us[1].id}})
	if code != http.StatusConflict {
		t.Fatalf("звонок участнику: ожидали 409, получили %d", code)
	}
	// Свободный us3 — звонок проходит.
	code, _ = a.do(t, http.MethodPost, "/api/calls", us[2].token,
		map[string]interface{}{"channel_id": ch, "target_ids": []int64{us[3].id}})
	if code != http.StatusCreated {
		t.Fatalf("звонок свободному: %d", code)
	}
}

func TestCallFlowInitiatorDoubleCallSameChannel(t *testing.T) {
	a, us, ch := setupCallScenario(t, 3, 30*time.Second)
	a.createCallT(t, us[0].token, ch, []int64{us[1].id})
	code, _ := a.do(t, http.MethodPost, "/api/calls", us[0].token,
		map[string]interface{}{"channel_id": ch, "target_ids": []int64{us[2].id}})
	if code != http.StatusConflict {
		t.Fatalf("двойной звонок: ожидали 409, получили %d", code)
	}
}

func TestCallFlowCrossChannelInitiation(t *testing.T) {
	a, us, ch := setupCallScenario(t, 3, 30*time.Second)
	ch2 := a.mustChannel(t, us[0].token, "Канал2", false)
	a.join(t, us[2].token, ch2)
	callID := a.createCallT(t, us[0].token, ch, []int64{us[1].id})
	// В другом канале — тоже можно, но прежний звонок завершится:
	// один активный звонок на пользователя (leaveOtherCalls).
	a.createCallT(t, us[0].token, ch2, []int64{us[2].id})
	time.Sleep(100 * time.Millisecond)
	call, _ := a.srv.Store.GetCall(callID)
	if call.Status != "ended" {
		t.Fatalf("прежний звонок должен завершиться после начала нового: %s", call.Status)
	}
	n, _ := a.srv.Store.CallParticipantCount(callID)
	if n != 0 {
		t.Fatalf("в прежнем звонке не должно быть участников: %d", n)
	}
}

// ---------- Выход и повторный вход ----------

func TestCallFlowLeaveAndRejoin(t *testing.T) {
	a, us, ch := setupCallScenario(t, 3, 30*time.Second)
	callID := a.createCallT(t, us[0].token, ch, []int64{us[1].id, us[2].id})
	for _, u := range us[1:] {
		a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/accept", callID), u.token, nil)
	}
	// us1 выходит и возвращается.
	a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/leave", callID), us[1].token, nil)
	code, body := a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/join", callID), us[1].token, map[string]string{"device_id": "dev"})
	if code != http.StatusOK {
		t.Fatalf("повторный вход: %d %v", code, body)
	}
	if body["token"] == nil {
		t.Fatal("повторный вход: нет токена")
	}
	// Участники снова трое.
	n, _ := a.srv.Store.CallParticipantCount(callID)
	if n != 3 {
		t.Fatalf("участников: %d", n)
	}
}

func TestCallFlowAllLeaveCallEnds(t *testing.T) {
	a, us, ch := setupCallScenario(t, 3, 30*time.Second)
	callID := a.createCallT(t, us[0].token, ch, []int64{us[1].id, us[2].id})
	for _, u := range us {
		code, _ := a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/leave", callID), u.token, nil)
		if code != http.StatusOK {
			t.Fatalf("leave %s: %d", u.nick, code)
		}
	}
	call, _ := a.srv.Store.GetCall(callID)
	if call.Status != "ended" {
		t.Fatalf("после ухода всех звонок должен завершиться: %s", call.Status)
	}
	// Новый звонок в том же канале — проходит (не «разговор уже идёт»).
	code, _ := a.do(t, http.MethodPost, "/api/calls", us[0].token,
		map[string]interface{}{"channel_id": ch, "target_ids": []int64{us[1].id}})
	if code != http.StatusCreated {
		t.Fatalf("новый звонок после завершения: %d", code)
	}
}

func TestCallFlowJoinEmptyAndEnded(t *testing.T) {
	a, us, ch := setupCallScenario(t, 2, 30*time.Second)
	callID := a.createCallT(t, us[0].token, ch, []int64{us[1].id})
	a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/leave", callID), us[0].token, nil)
	// Пустой звонок — вход невозможен, звонок завершается.
	code, _ := a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/join", callID), us[1].token, nil)
	if code != http.StatusGone {
		t.Fatalf("вход в пустой звонок: ожидали 410, получили %d", code)
	}
	call, _ := a.srv.Store.GetCall(callID)
	if call.Status != "ended" {
		t.Fatalf("пустой звонок должен завершиться: %s", call.Status)
	}
	// Вход в завершённый — 410.
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/join", callID), us[1].token, nil)
	if code != http.StatusGone {
		t.Fatalf("вход в завершённый: ожидали 410, получили %d", code)
	}
}

func TestCallFlowJoinWithoutInvite(t *testing.T) {
	a, us, ch := setupCallScenario(t, 3, 30*time.Second)
	callID := a.createCallT(t, us[0].token, ch, []int64{us[1].id})
	code, _ := a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/join", callID), us[2].token, nil)
	if code != http.StatusForbidden {
		t.Fatalf("вход неприглашённого: ожидали 403, получили %d", code)
	}
}

// ---------- Таймаут дозвона ----------

func TestCallFlowRingTimeoutFinishesSolo(t *testing.T) {
	a, us, ch := setupCallScenario(t, 2, 1*time.Second)
	callID := a.createCallT(t, us[0].token, ch, []int64{us[1].id})
	time.Sleep(1800 * time.Millisecond)
	// Инициатор один, приглашение автоотклонено. Старый звонок не блокирует:
	// новый звонок создаётся, старый завершается.
	code, body := a.do(t, http.MethodPost, "/api/calls", us[0].token,
		map[string]interface{}{"channel_id": ch, "target_ids": []int64{us[1].id}})
	if code != http.StatusCreated {
		t.Fatalf("новый звонок после таймаута: %d %v", code, body)
	}
	call, _ := a.srv.Store.GetCall(callID)
	if call.Status != "ended" {
		t.Fatalf("старый звонок после нового вызова должен завершиться: %s", call.Status)
	}
}

// ---------- WS-события ----------

func TestCallFlowWsEvents(t *testing.T) {
	a, us, ch := setupCallScenario(t, 2, 30*time.Second)
	conn := dialWS(t, a, us[1].token)
	defer conn.Close()
	time.Sleep(100 * time.Millisecond)

	seen := map[string]bool{}
	go func() {
		for {
			var msg map[string]interface{}
			if err := conn.ReadJSON(&msg); err != nil {
				return
			}
			if t, ok := msg["type"].(string); ok {
				seen[t] = true
			}
		}
	}()

	callID := a.createCallT(t, us[0].token, ch, []int64{us[1].id})
	a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/accept", callID), us[1].token, nil)
	a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/leave", callID), us[1].token, nil)
	time.Sleep(300 * time.Millisecond)

	for _, ev := range []string{"call.invite", "call.started", "call.participants"} {
		if !seen[ev] {
			t.Fatalf("не получено WS-событие %s", ev)
		}
	}
}

// ---------- Пинок ----------

func TestCallFlowPunch(t *testing.T) {
	a, us, ch := setupCallScenario(t, 3, 30*time.Second)
	conn := dialWS(t, a, us[2].token)
	defer conn.Close()
	time.Sleep(100 * time.Millisecond)

	callID := a.createCallT(t, us[0].token, ch, []int64{us[1].id, us[2].id})
	a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/accept", callID), us[1].token, nil)
	a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/accept", callID), us[2].token, nil)
	time.Sleep(100 * time.Millisecond)

	// Пинок участнику звонка.
	conn.WriteJSON(map[string]interface{}{
		"type": "call.punch",
		"data": map[string]interface{}{"call_id": callID, "target_user_id": us[2].id},
	})
	deadline := time.Now().Add(2 * time.Second)
	got := false
	for time.Now().Before(deadline) {
		var msg map[string]interface{}
		if err := conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond)); err != nil {
			break
		}
		if err := conn.ReadJSON(&msg); err != nil {
			break
		}
		if msg["type"] == "punch" {
			got = true
			break
		}
	}
	if !got {
		t.Fatal("участник не получил пинок")
	}

	// Пинок неучастнику звонка — молча.
	code, _ := a.do(t, http.MethodPost, "/api/calls", us[2].token,
		map[string]interface{}{"channel_id": ch, "target_ids": []int64{us[0].id}})
	if code != http.StatusConflict {
		t.Fatalf("us2 в звонке — повторный вызов: %d", code)
	}
}

// ---------- WS-отключение ----------

func TestCallFlowWsDisconnectLastParticipant(t *testing.T) {
	a, us, ch := setupCallScenario(t, 2, 30*time.Second)
	callID := a.createCallT(t, us[0].token, ch, []int64{us[1].id})
	a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/accept", callID), us[1].token, nil)

	conn := dialWS(t, a, us[0].token)
	time.Sleep(100 * time.Millisecond)
	_ = conn.Close()
	deadline := time.Now().Add(3 * time.Second)
	for {
		call, _ := a.srv.Store.GetCall(callID)
		if call.Status == "ended" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("звонок должен завершиться после WS-отключения последнего участника")
		}
		time.Sleep(50 * time.Millisecond)
	}
}
