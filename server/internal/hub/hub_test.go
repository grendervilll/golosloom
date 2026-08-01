package hub

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// newClient создаёт пару подключений: serverConn (сторона сервера, оборачивается
// в Client) и clientConn (сторона клиента, из неё читаем события).
func newClient(t *testing.T) (*websocket.Conn, *Client) {
	t.Helper()
	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
	ready := make(chan *websocket.Conn, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			close(ready)
			return
		}
		ready <- conn
		<-r.Context().Done()
		_ = conn.Close()
	}))
	t.Cleanup(srv.Close)
	clientConn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http")+"/", nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = clientConn.Close() })
	serverConn := <-ready
	client := NewClient(serverConn, 7, "nick7")
	return clientConn, client
}

// startPump копирует очередь Send клиента в соединение, как writePump в сервере.
func startPump(c *Client) {
	go func() {
		for msg := range c.Send {
			_ = c.Conn.SetWriteDeadline(time.Now().Add(2 * time.Second))
			_ = c.Conn.WriteMessage(websocket.TextMessage, msg)
		}
	}()
}

func readEvent(t *testing.T, conn *websocket.Conn) Event {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, raw, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("чтение события: %v", err)
	}
	var ev Event
	if err := json.Unmarshal(raw, &ev); err != nil {
		t.Fatal(err)
	}
	return ev
}

func TestAddRemoveAndPresence(t *testing.T) {
	h := New()
	conn1, c1 := newClient(t)
	conn2, c2 := newClient(t)
	startPump(c1)
	startPump(c2)

	h.Add(c1, []int64{10, 11})
	h.Add(c2, []int64{11})

	if !h.IsOnline(7) {
		t.Fatal("пользователь должен быть онлайн после Add")
	}
	ids := h.OnlineUserIDs()
	if len(ids) != 1 || ids[0] != 7 {
		t.Fatalf("онлайн-пользователи: %v", ids)
	}
	// Оба получают событие в канал 11.
	h.SendToChannel(11, NewEvent("first", nil))
	if readEvent(t, conn1).Type != "first" || readEvent(t, conn2).Type != "first" {
		t.Fatal("событие канала не дошло")
	}
	// LeaveChannel: c2 выходит из канала 11 — событие получает только c1.
	h.LeaveChannel(c2, 11)
	h.SendToChannel(11, NewEvent("after", nil))
	if readEvent(t, conn1).Type != "after" {
		t.Fatal("c1 должен получить событие")
	}
	// JoinChannel снова — оба получают события.
	h.JoinChannel(c2, 11)
	h.SendToChannel(11, NewEvent("back", nil))
	if readEvent(t, conn1).Type != "back" || readEvent(t, conn2).Type != "back" {
		t.Fatal("c2 должен снова получать события")
	}
	// Снова выход — проверяем, что c2 больше не получает события канала.
	h.LeaveChannel(c2, 11)
	h.SendToChannel(11, NewEvent("third", nil))
	if readEvent(t, conn1).Type != "third" {
		t.Fatal("c1 должен получить событие")
	}
	_ = conn2.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
	if _, _, err := conn2.ReadMessage(); err == nil {
		t.Fatal("c2 не должен получать события после выхода из канала")
	}
	// Remove: пользователь офлайн.
	h.Remove(c1)
	h.Remove(c2)
	if h.IsOnline(7) {
		t.Fatal("после Remove пользователь должен быть офлайн")
	}
}

func TestSendToUser(t *testing.T) {
	h := New()
	conn, c := newClient(t)
	startPump(c)
	h.Add(c, nil)
	h.SendToUser(7, NewEvent("direct", map[string]string{"a": "b"}))
	ev := readEvent(t, conn)
	if ev.Type != "direct" {
		t.Fatalf("тип события: %s", ev.Type)
	}
	// Другому пользователю событие не уходит.
	_ = conn.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
	h.SendToUser(999, NewEvent("ghost", nil))
	if _, _, err := conn.ReadMessage(); err == nil {
		t.Fatal("событие чужому пользователю не должно приходить")
	}
}

func TestCloseUser(t *testing.T) {
	h := New()
	conn, c := newClient(t)
	startPump(c)
	h.Add(c, nil)
	h.SendToUser(7, NewEvent("bye", nil))
	h.CloseUser(7)
	// Событие должно успеть уйти до закрытия.
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, _, err := conn.ReadMessage(); err != nil {
		t.Fatalf("финальное событие не дошло: %v", err)
	}
	// Соединение закрыто.
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, _, err := conn.ReadMessage(); err == nil {
		t.Fatal("соединение должно быть закрыто")
	}
	// В реальном сервере readPump вызывает Remove при разрыве соединения.
	h.Remove(c)
	if h.IsOnline(7) {
		t.Fatal("после CloseUser пользователь должен быть офлайн")
	}
}

func TestSendBufferedDrop(t *testing.T) {
	h := New()
	_, c := newClient(t)
	// Без writePump очередь переполняется, но SendToUser не блокируется.
	h.Add(c, nil)
	for i := 0; i < 500; i++ {
		h.SendToUser(7, NewEvent("bulk", nil))
	}
}
