// Тесты ответов на сообщения: reply_to сохраняется, приходит в истории,
// валидация (ответ только на сообщение из этого канала).
package api

import (
	"fmt"
	"net/http"
	"testing"
)

func TestMessageReplyTo(t *testing.T) {
	a := newTestApp(t, nil)
	u := a.register(t, "ReplyUser")
	ch := a.mustChannel(t, u.token, "reply", false)

	// Исходное сообщение, на которое будем отвечать.
	target := a.sendMsg(t, u.token, ch, "оригинал")

	// Ответ с reply_to.
	code, body := a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/messages", ch), u.token,
		map[string]interface{}{"ciphertext": b64("ответ"), "iv": "aXY=", "reply_to_id": target})
	if code != http.StatusCreated {
		t.Fatalf("ответ на сообщение: %d", code)
	}
	if body["reply_to"] == nil || int64(body["reply_to"].(float64)) != target {
		t.Fatalf("reply_to в ответе: %v", body["reply_to"])
	}

	// В истории reply_to тоже есть.
	_, list := a.doList(t, http.MethodGet, fmt.Sprintf("/api/channels/%d/messages", ch), u.token, nil)
	found := false
	for _, item := range list {
		m := item.(map[string]interface{})
		if int64(m["id"].(float64)) == int64(body["id"].(float64)) {
			if m["reply_to"] == nil || int64(m["reply_to"].(float64)) != target {
				t.Fatalf("reply_to в истории: %v", m["reply_to"])
			}
			found = true
		}
	}
	if !found {
		t.Fatalf("сообщение-ответ не найдено в истории")
	}

	// Ответ на несуществующее сообщение — 404.
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/messages", ch), u.token,
		map[string]interface{}{"ciphertext": b64("x"), "iv": "aXY=", "reply_to_id": 999999})
	if code != http.StatusNotFound {
		t.Fatalf("ответ на несуществующее: ожидали 404, получили %d", code)
	}

	// Ответ на сообщение из другого канала — 404.
	ch2 := a.mustChannel(t, u.token, "reply2", false)
	other := a.register(t, "ReplyOther")
	a.join(t, other.token, ch2)
	target2 := a.sendMsg(t, other.token, ch2, "в другом канале")
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/messages", ch), u.token,
		map[string]interface{}{"ciphertext": b64("y"), "iv": "aXY=", "reply_to_id": target2})
	if code != http.StatusNotFound {
		t.Fatalf("ответ на сообщение из другого канала: ожидали 404, получили %d", code)
	}
}
