// Тесты личных сообщений и сообществ: создание, поиск, подписка/отписка,
// readonly, счётчики подписчиков, звонки в DM.
package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"testing"
)

func mustJSON(t *testing.T, a *testApp, method, path, token string, payload interface{}) map[string]interface{} {
	t.Helper()
	code, raw := a.doRaw(t, method, path, token, payload)
	if code < 200 || code >= 300 {
		b, _ := json.Marshal(raw)
		t.Fatalf("%s %s: %d %s", method, path, code, b)
	}
	m, ok := raw.(map[string]interface{})
	if !ok {
		t.Fatalf("%s %s: не объект", method, path)
	}
	return m
}

func TestDMAndCommunity(t *testing.T) {
	a := newTestApp(t, nil)
	alice := a.register(t, "DMAlice")
	bob := a.register(t, "DMBob")
	carol := a.register(t, "DMCarol")

	// --- Личные сообщения: создание и повторное использование ---
	dm1 := mustJSON(t, a, http.MethodPost, "/api/dm", alice.token, map[string]interface{}{"user_id": bob.id})
	ch := dm1["channel"].(map[string]interface{})
	if ch["kind"] != "dm" || ch["private"] != true {
		t.Fatalf("dm kind/private: %v", ch)
	}
	dm2 := mustJSON(t, a, http.MethodPost, "/api/dm", bob.token, map[string]interface{}{"user_id": alice.id})
	if dm1["created"] != true || dm2["created"] != false {
		t.Fatalf("переиспользование dm: %v / %v", dm1["created"], dm2["created"])
	}
	dmID := int64(ch["id"].(float64))

	// Оба видят DM в списке каналов, оба — участники.
	_, list1 := a.doList(t, http.MethodGet, "/api/channels", alice.token, nil)
	found := false
	for _, c := range list1 {
		cc := c.(map[string]interface{})
		if int64(cc["id"].(float64)) == dmID {
			found = true
			if cc["kind"] != "dm" {
				t.Fatalf("kind в списке: %v", cc["kind"])
			}
		}
	}
	if !found {
		t.Fatal("DM нет в списке каналов Alice")
	}

	// Сообщения и звонки в DM работают как в каналах.
	mid := a.sendMsg(t, alice.token, dmID, "привет, Боб")
	if mid == 0 {
		t.Fatal("сообщение в DM не отправилось")
	}
	callRes := mustJSON(t, a, http.MethodPost, "/api/calls", alice.token,
		map[string]interface{}{"channel_id": dmID, "target_ids": []int64{bob.id}})
	if callRes["call"] == nil {
		t.Fatal("звонок в DM не создался")
	}
	callID := int64(callRes["call"].(map[string]interface{})["id"].(float64))
	a.do(t, http.MethodPost, "/api/calls/"+fmt.Sprint(callID)+"/leave", alice.token, nil)

	// --- Сообщества ---
	comm := mustJSON(t, a, http.MethodPost, "/api/communities", alice.token,
		map[string]interface{}{"name": "Новости Голослума"})
	cc := comm["channel"].(map[string]interface{})
	commID := int64(cc["id"].(float64))
	if cc["kind"] != "community" || cc["readonly"] != true {
		t.Fatalf("community kind/readonly: %v", cc)
	}

	// Поиск сообщества по названию и по id.
	s1 := mustJSON(t, a, http.MethodGet, "/api/search?q="+url.QueryEscape("Новости"), alice.token, nil)
	if len(s1["communities"].([]interface{})) == 0 {
		t.Fatal("сообщество не нашлось по названию")
	}
	s2 := mustJSON(t, a, http.MethodGet, "/api/search?q="+fmt.Sprint(commID), carol.token, nil)
	if len(s2["communities"].([]interface{})) == 0 {
		t.Fatal("сообщество не нашлось по id")
	}
	// Поиск пользователя по нику и id.
	s3 := mustJSON(t, a, http.MethodGet, "/api/search?q=dmbo", carol.token, nil)
	if len(s3["users"].([]interface{})) == 0 {
		t.Fatal("пользователь не нашёлся по нику")
	}

	// Владелец пишет текст и с файлом.
	a.sendMsg(t, alice.token, commID, "первая статья")
	fCode, f := uploadFile(a, t, alice.token, commID, "аудио.m4a", []byte("audio"))
	if fCode != http.StatusCreated {
		t.Fatalf("владелец не загрузил файл: %d", fCode)
	}
	attID := int64(f["id"].(float64))
	if code, _ := a.do(t, http.MethodPost, "/api/channels/"+fmt.Sprint(commID)+"/messages", alice.token,
		map[string]interface{}{"ciphertext": b64("с аудио"), "iv": "aXY=", "attachment_ids": []int64{attID}}); code != http.StatusCreated {
		t.Fatalf("сообщение с файлом: %d", code)
	}

	// Сообщество скрыто от посторонних (нет в списке каналов).
	_, carolList := a.doList(t, http.MethodGet, "/api/channels", carol.token, nil)
	for _, c := range carolList {
		if int64(c.(map[string]interface{})["id"].(float64)) == commID {
			t.Fatal("неподписанный видит сообщество в списке")
		}
	}
	// Попытка писать без подписки — 403.
	if code, _ := a.do(t, http.MethodPost, "/api/channels/"+fmt.Sprint(commID)+"/messages", carol.token,
		map[string]interface{}{"ciphertext": b64("взлом"), "iv": "aXY="}); code != http.StatusForbidden {
		t.Fatalf("писать без подписки: %d", code)
	}

	// Подписка (join) и число подписчиков.
	if code, _ := a.do(t, http.MethodPost, "/api/channels/"+fmt.Sprint(commID)+"/join", carol.token, nil); code != http.StatusOK {
		t.Fatalf("подписка: %d", code)
	}
	_, counts := a.doList(t, http.MethodGet, "/api/channels", carol.token, nil)
	var ccCount float64
	for _, c := range counts {
		ci := c.(map[string]interface{})
		if int64(ci["id"].(float64)) == commID {
			ccCount = ci["member_count"].(float64)
		}
	}
	if int(ccCount) != 2 {
		t.Fatalf("подписчиков после подписки: %v (ожидали 2)", ccCount)
	}

	// Подписчик может читать, но писать и грузить — нельзя.
	_, msgs := a.doList(t, http.MethodGet, "/api/channels/"+fmt.Sprint(commID)+"/messages", carol.token, nil)
	if len(msgs) == 0 {
		t.Fatal("подписчик не видит сообщения")
	}
	if code, _ := a.do(t, http.MethodPost, "/api/channels/"+fmt.Sprint(commID)+"/messages", carol.token,
		map[string]interface{}{"ciphertext": b64("нельзя"), "iv": "aXY="}); code != http.StatusForbidden {
		t.Fatalf("подписчик пишет: %d", code)
	}
	if fCode, _ := uploadFile(a, t, carol.token, commID, "x.txt", []byte("x")); fCode != http.StatusForbidden {
		t.Fatalf("подписчик грузит файл: %d", fCode)
	}
	// Звонок в сообществе подписчику — нельзя, владельцу — можно.
	if code, _ := a.do(t, http.MethodPost, "/api/calls", carol.token,
		map[string]interface{}{"channel_id": commID, "target_ids": []int64{alice.id}}); code != http.StatusForbidden {
		t.Fatalf("звонок подписчика в сообществе: %d", code)
	}
	if code, _ := a.do(t, http.MethodPost, "/api/calls", alice.token,
		map[string]interface{}{"channel_id": commID, "target_ids": []int64{carol.id}}); code != http.StatusCreated {
		t.Fatalf("звонок владельца в сообществе: %d", code)
	}

	// Отписка: подписчик уходит, счётчик убывает.
	if code, _ := a.do(t, http.MethodPost, "/api/channels/"+fmt.Sprint(commID)+"/leave", carol.token, nil); code != http.StatusOK {
		t.Fatalf("отписка: %d", code)
	}
	_, afterLeave := a.doList(t, http.MethodGet, "/api/channels", carol.token, nil)
	for _, c := range afterLeave {
		if int64(c.(map[string]interface{})["id"].(float64)) == commID {
			t.Fatal("отписавшийся всё ещё видит сообщество")
		}
	}
	// Владелец не может отписаться.
	if code, _ := a.do(t, http.MethodPost, "/api/channels/"+fmt.Sprint(commID)+"/leave", alice.token, nil); code != http.StatusForbidden {
		t.Fatalf("владелец отписался: %d", code)
	}
}

func TestChannelKeyReset(t *testing.T) {
	a := newTestApp(t, nil)
	alice := a.register(t, "ResAlice")
	bob := a.register(t, "ResBob")
	dm := mustJSON(t, a, http.MethodPost, "/api/dm", alice.token, map[string]interface{}{"user_id": bob.id})
	dmID := int64(dm["channel"].(map[string]interface{})["id"].(float64))

	// Устройство создателя (имитируем регистрацию).
	if code, _ := a.do(t, http.MethodPost, "/api/users/key", alice.token,
		map[string]interface{}{"device_id": "dev-a", "public_key": b64("pub-a")}); code != http.StatusOK {
		t.Fatalf("регистрация устройства: %d", code)
	}

	// Не-создатель не может восстановить ключ.
	code, _ := a.do(t, http.MethodPost, "/api/channels/"+fmt.Sprint(dmID)+"/keys/reset", bob.token,
		map[string]interface{}{"device_id": "dev-b", "wrapped_key": b64("w-b")})
	if code != http.StatusForbidden {
		t.Fatalf("сброс не-создателем: %d", code)
	}

	// Создатель восстанавливает ключ (даже если старые обёртки остались
	// от потерянных устройств).
	code, body := a.do(t, http.MethodPost, "/api/channels/"+fmt.Sprint(dmID)+"/keys/reset", alice.token,
		map[string]interface{}{"device_id": "dev-a", "wrapped_key": b64("w-a-new")})
	if code != http.StatusOK {
		t.Fatalf("сброс создателем: %d %v", code, body)
	}
	// Осталась ровно одна обёртка — новая.
	var n int
	_ = a.srv.Store.CountKeyWraps(dmID, &n)
	if n != 1 {
		t.Fatalf("обёрток после сброса: %d (ожидали 1)", n)
	}
}
