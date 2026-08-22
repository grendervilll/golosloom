package api

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"golosloom/server/internal/config"
)

// TestListEndpoints покрывает списковые эндпоинты: участники, права, звонки, админ-панель.
func TestListEndpoints(t *testing.T) {
	a := newTestApp(t, func(c *config.Config) { c.RingTimeout = 5 * time.Second })
	admin := a.register(t, "Admin")
	user1 := a.register(t, "User1")
	user2 := a.register(t, "User2")
	ch := a.mustChannel(t, user1.token, "Канал", false)
	a.join(t, user2.token, ch)

	code, members := a.doList(t, http.MethodGet, fmt.Sprintf("/api/channels/%d/members", ch), user1.token, nil)
	if code != http.StatusOK || len(members) != 2 {
		t.Fatalf("участники: %d %v", code, members)
	}
	byID := map[int64]map[string]interface{}{}
	for _, m := range members {
		mm := m.(map[string]interface{})
		byID[int64(mm["user_id"].(float64))] = mm
	}
	if byID[user1.id]["role"] != "channel_admin" {
		t.Fatal("роль создателя — админ канала")
	}

	// Права канала.
	code, perms := a.do(t, http.MethodGet, fmt.Sprintf("/api/channels/%d/permissions", ch), user1.token, nil)
	if code != http.StatusOK || perms == nil {
		t.Fatalf("права канала: %d %v", code, perms)
	}

	// Список звонков канала.
	code, body := a.do(t, http.MethodPost, "/api/calls", user1.token,
		map[string]interface{}{"channel_id": ch, "target_ids": []int64{user2.id}})
	if code != http.StatusCreated {
		t.Fatalf("создание звонка: %d", code)
	}
	code, calls := a.doList(t, http.MethodGet, fmt.Sprintf("/api/channels/%d/calls", ch), user1.token, nil)
	if code != http.StatusOK || len(calls) != 1 {
		t.Fatalf("звонки канала: %d %v", code, calls)
	}
	call := calls[0].(map[string]interface{})
	if call["status"] != "ringing" || len(call["participants"].([]interface{})) != 1 {
		t.Fatalf("звонок: %v", call)
	}

	// Админ-панель: список пользователей.
	code, users := a.doList(t, http.MethodGet, "/api/admin/users", admin.token, nil)
	if code != http.StatusOK || len(users) != 3 {
		t.Fatalf("админ-панель пользователи: %d %v", code, users)
	}
	// Админ-панель: список каналов с создателем.
	code, chans := a.doList(t, http.MethodGet, "/api/admin/channels", admin.token, nil)
	if code != http.StatusOK || len(chans) != 1 {
		t.Fatalf("админ-панель каналы: %d %v", code, chans)
	}
	if chans[0].(map[string]interface{})["creator_nick"] != "user1" {
		t.Fatal("админ должен видеть создателя канала")
	}
	// Список пользователей для приглашений.
	code, users = a.doList(t, http.MethodGet, "/api/users", user1.token, nil)
	if code != http.StatusOK || len(users) != 3 {
		t.Fatalf("список пользователей: %d %v", code, users)
	}
	_ = body
}
