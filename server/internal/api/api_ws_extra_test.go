package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"golosloom/server/internal/config"
)

func TestCORS(t *testing.T) {
	a := newTestApp(t, func(c *config.Config) {
		c.AllowOrigins = []string{"https://allowed.example.com"}
	})
	u := a.register(t, "User1")
	// Preflight от разрешённого origin.
	req, _ := http.NewRequest(http.MethodOptions, a.ts.URL+"/api/channels", nil)
	req.Header.Set("Origin", "https://allowed.example.com")
	req.Header.Set("Access-Control-Request-Method", "POST")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("preflight: %d", resp.StatusCode)
	}
	if resp.Header.Get("Access-Control-Allow-Origin") != "https://allowed.example.com" {
		t.Fatal("нет CORS-заголовка для разрешённого origin")
	}
	// Обычный запрос с разрешённым origin получает заголовок.
	req2, _ := http.NewRequest(http.MethodGet, a.ts.URL+"/api/me", nil)
	req2.Header.Set("Origin", "https://allowed.example.com")
	req2.Header.Set("Authorization", "Bearer "+u.token)
	resp2, err := http.DefaultClient.Do(req2)
	if err != nil {
		t.Fatal(err)
	}
	resp2.Body.Close()
	if resp2.Header.Get("Access-Control-Allow-Origin") != "https://allowed.example.com" {
		t.Fatal("обычный запрос не получил CORS-заголовок")
	}
}

func TestCORSDisallowedOrigin(t *testing.T) {
	a := newTestApp(t, nil)
	req, _ := http.NewRequest(http.MethodGet, a.ts.URL+"/api/config", nil)
	req.Header.Set("Origin", "https://evil.example.com")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.Header.Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("недопустимый origin не должен получать CORS-заголовки")
	}
}

func TestChannelCreateValidation(t *testing.T) {
	a := newTestApp(t, nil)
	u := a.register(t, "User1")
	code, _ := a.do(t, http.MethodPost, "/api/channels", u.token, map[string]interface{}{"name": "", "private": false})
	if code != http.StatusBadRequest {
		t.Fatalf("пустое название канала: %d", code)
	}
	code, _ = a.do(t, http.MethodPost, "/api/channels", u.token, "not-json")
	if code != http.StatusBadRequest {
		t.Fatalf("некорректное тело: %d", code)
	}
}

func TestInviteRespondErrors(t *testing.T) {
	a := newTestApp(t, nil)
	user1 := a.register(t, "User1")
	user2 := a.register(t, "User2")
	user3 := a.register(t, "User3")
	ch := a.mustChannel(t, user1.token, "Приват", true)
	a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/invites", ch), user1.token,
		map[string]int64{"user_id": user2.id})
	_, inv := a.doList(t, http.MethodGet, "/api/invites", user2.token, nil)
	inviteID := int64(inv[0].(map[string]interface{})["id"].(float64))
	code, _ := a.do(t, http.MethodPost, fmt.Sprintf("/api/invites/%d/accept", inviteID), user3.token, nil)
	if code != http.StatusForbidden {
		t.Fatalf("принятие чужого приглашения: %d", code)
	}
	a.do(t, http.MethodPost, fmt.Sprintf("/api/invites/%d/accept", inviteID), user2.token, nil)
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/invites/%d/accept", inviteID), user2.token, nil)
	if code != http.StatusConflict {
		t.Fatalf("повторный ответ на приглашение: %d", code)
	}
}

func TestAdminSettingValidation(t *testing.T) {
	a := newTestApp(t, nil)
	admin := a.register(t, "Admin")
	code, _ := a.do(t, http.MethodPost, "/api/admin/settings/registration", admin.token, "not-json")
	if code != http.StatusBadRequest {
		t.Fatalf("настройка регистрации с плохим телом: %d", code)
	}
	u := a.register(t, "User1")
	code, _ = a.do(t, http.MethodPost, "/api/admin/settings/registration", u.token, map[string]bool{"enabled": true})
	if code != http.StatusForbidden {
		t.Fatalf("настройка регистрации не-админом: %d", code)
	}
}

func TestWSClientEvents(t *testing.T) {
	a := newTestApp(t, nil)
	u1 := a.register(t, "User1")
	ch := a.mustChannel(t, u1.token, "Канал", false)

	conn := dialWS(t, a, u1.token)
	defer conn.Close()
	// Неизвестный тип и некорректные данные внутри валидного JSON не роняют соединение.
	_ = conn.WriteJSON(map[string]interface{}{"type": "unknown.type", "data": map[string]string{"x": "y"}})
	// ping → pong.
	if err := conn.WriteJSON(map[string]interface{}{"type": "ping"}); err != nil {
		t.Fatal(err)
	}
	readUntilType(t, conn, "pong")
	// channel.join/leave и call.punch с некорректными данными — игнорируются.
	_ = conn.WriteJSON(map[string]interface{}{"type": "channel.join", "data": "bad"})
	_ = conn.WriteJSON(map[string]interface{}{"type": "channel.leave", "data": map[string]int64{"channel_id": ch}})
	_ = conn.WriteJSON(map[string]interface{}{"type": "call.punch", "data": map[string]int64{"call_id": 0}})
	// Соединение живо: ещё один ping.
	if err := conn.WriteJSON(map[string]interface{}{"type": "ping"}); err != nil {
		t.Fatal(err)
	}
	readUntilType(t, conn, "pong")
}

func TestWSChannelJoinDeliversEvents(t *testing.T) {
	a := newTestApp(t, nil)
	u1 := a.register(t, "User1")
	u2 := a.register(t, "User2")
	ch := a.mustChannel(t, u1.token, "Канал", false)
	a.join(t, u2.token, ch)
	conn := dialWS(t, a, u2.token)
	defer conn.Close()
	// Сообщение в канале доставляется через WS (канал в комнате по подключению).
	code, _ := a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/messages", ch), u1.token,
		map[string]string{"ciphertext": b64("ws-msg"), "iv": "aXY="})
	if code != http.StatusCreated {
		t.Fatalf("отправка: %d", code)
	}
	readUntilType(t, conn, "message.new")
}

func TestWSRejectsBadToken(t *testing.T) {
	a := newTestApp(t, nil)
	_, resp, err := websocket.DefaultDialer.Dial(wsURL(a, "garbage-token"), nil)
	if err == nil {
		t.Fatal("WS с мусорным токеном должен отклоняться")
	}
	if resp != nil && resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("код ответа: %d", resp.StatusCode)
	}
}

func readUntilType(t *testing.T, conn *websocket.Conn, typ string) {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("чтение события %s: %v", typ, err)
		}
		var msg map[string]interface{}
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}
		if msg["type"] == typ {
			return
		}
	}
}
