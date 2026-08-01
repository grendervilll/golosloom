package api

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"golosloom/server/internal/auth"
	"golosloom/server/internal/config"
	"golosloom/server/internal/store"
)

type testApp struct {
	srv *Server
	ts  *httptest.Server
	cfg config.Config
}

type testUser struct {
	id    int64
	nick  string
	token string
}

const testPW = "Abcdef12345!"

func newTestApp(t *testing.T, mutate func(*config.Config)) *testApp {
	t.Helper()
	cfg := config.Load()
	cfg.DBPath = t.TempDir() + "/test.db"
	cfg.JWTSecret = "test-secret"
	cfg.RingTimeout = 40 * time.Millisecond
	cfg.MessageRatePerSec = 1000
	cfg.PunchInterval = 10 * time.Second
	cfg.MaxMessageLen = 2000
	cfg.LiveKitAPIKey = "key"
	cfg.LiveKitAPISecret = "secret"
	if mutate != nil {
		mutate(&cfg)
	}
	st, err := store.Open(cfg.DBPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	srv := New(cfg, st)
	ts := httptest.NewServer(srv.Router())
	t.Cleanup(ts.Close)
	return &testApp{srv: srv, ts: ts, cfg: cfg}
}

func (a *testApp) register(t *testing.T, nick string) *testUser {
	t.Helper()
	code, body := a.do(t, http.MethodPost, "/api/register", "", map[string]string{"nick": nick, "password": testPW})
	if code != http.StatusOK {
		t.Fatalf("регистрация %s: код %d, тело %v", nick, code, body)
	}
	u, err := a.srv.Store.GetUserByNick(strings.ToLower(nick))
	if err != nil {
		t.Fatal(err)
	}
	return &testUser{id: u.ID, nick: nick, token: body["token"].(string)}
}

func (a *testApp) do(t *testing.T, method, path, token string, payload interface{}) (int, map[string]interface{}) {
	t.Helper()
	code, raw := a.doRaw(t, method, path, token, payload)
	if obj, ok := raw.(map[string]interface{}); ok {
		return code, obj
	}
	return code, map[string]interface{}{}
}

func (a *testApp) doList(t *testing.T, method, path, token string, payload interface{}) (int, []interface{}) {
	t.Helper()
	code, raw := a.doRaw(t, method, path, token, payload)
	if arr, ok := raw.([]interface{}); ok {
		return code, arr
	}
	return code, nil
}

func (a *testApp) doRaw(t *testing.T, method, path, token string, payload interface{}) (int, interface{}) {
	t.Helper()
	var body *bytes.Reader
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		body = bytes.NewReader(b)
	} else {
		body = bytes.NewReader(nil)
	}
	req, err := http.NewRequest(method, a.ts.URL+path, body)
	if err != nil {
		t.Fatal(err)
	}
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out interface{}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

func (a *testApp) mustChannel(t *testing.T, token, name string, private bool) int64 {
	t.Helper()
	code, body := a.do(t, http.MethodPost, "/api/channels", token, map[string]interface{}{"name": name, "private": private})
	if code != http.StatusCreated {
		t.Fatalf("создание канала: код %d, тело %v", code, body)
	}
	return int64(body["id"].(float64))
}

func (a *testApp) join(t *testing.T, token string, channelID int64) {
	t.Helper()
	code, body := a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/join", channelID), token, nil)
	if code != http.StatusOK {
		t.Fatalf("вход в канал: код %d, тело %v", code, body)
	}
}

func (a *testApp) sendMsg(t *testing.T, token string, channelID int64, plain string) int64 {
	t.Helper()
	code, body := a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/messages", channelID), token,
		map[string]string{"ciphertext": b64(plain), "iv": "aXY="})
	if code != http.StatusCreated {
		t.Fatalf("отправка сообщения: код %d, тело %v", code, body)
	}
	return int64(body["id"].(float64))
}

// b64 — шифротекст в JSON передаётся как base64 (как это делают реальные клиенты).
func b64(s string) string { return base64.StdEncoding.EncodeToString([]byte(s)) }

func generateTestToken(userID int64, secret string) (string, error) {
	return auth.GenerateToken(userID, secret, time.Hour)
}

func dialWS(t *testing.T, a *testApp, token string) *websocket.Conn {
	t.Helper()
	conn, _, err := websocket.DefaultDialer.Dial(wsURL(a, token), nil)
	if err != nil {
		t.Fatal(err)
	}
	return conn
}

func wsURL(a *testApp, token string) string {
	return "ws" + strings.TrimPrefix(a.ts.URL, "http") + "/ws?token=" + token
}

// ---------- Регистрация и аутентификация ----------

func TestRegistrationAndLogin(t *testing.T) {
	a := newTestApp(t, nil)
	u := a.register(t, "Alice")
	if u.id <= 0 {
		t.Fatal("id пользователя не может быть 0")
	}
	if me, err := a.srv.Store.GetUserByID(u.id); err != nil || !me.IsServerAdmin {
		t.Fatal("первый зарегистрированный должен стать админом сервера")
	}
	code, _ := a.do(t, http.MethodPost, "/api/register", "", map[string]string{"nick": "Alice", "password": testPW})
	if code != http.StatusConflict {
		t.Fatalf("дубликат ника: ожидали 409, получили %d", code)
	}
	code, _ = a.do(t, http.MethodPost, "/api/register", "", map[string]string{"nick": "Bob", "password": "short"})
	if code != http.StatusBadRequest {
		t.Fatalf("слабый пароль: ожидали 400, получили %d", code)
	}
	code, body := a.do(t, http.MethodPost, "/api/login", "", map[string]string{"nick": "Alice", "password": testPW})
	if code != http.StatusOK || body["token"] == "" {
		t.Fatalf("вход с верным паролем не удался: %d %v", code, body)
	}
	code, _ = a.do(t, http.MethodPost, "/api/login", "", map[string]string{"nick": "Alice", "password": "WrongPass12!"})
	if code != http.StatusUnauthorized {
		t.Fatalf("вход с неверным паролем: ожидали 401, получили %d", code)
	}
	hash, _ := a.srv.Store.PasswordHash(u.id)
	if hash == testPW {
		t.Fatal("пароль должен храниться в хэшированном виде")
	}
	code, me := a.do(t, http.MethodGet, "/api/me", u.token, nil)
	if code != http.StatusOK || me["nick"] != "alice" {
		t.Fatalf("me: %d %v", code, me)
	}
	// Регистрация с пустым ником отклоняется.
	code, _ = a.do(t, http.MethodPost, "/api/register", "", map[string]string{"nick": "  ", "password": testPW})
	if code != http.StatusBadRequest {
		t.Fatalf("пустой ник: ожидали 400, получили %d", code)
	}
}

func TestRegistrationDisabled(t *testing.T) {
	a := newTestApp(t, nil)
	admin := a.register(t, "Admin")
	a.register(t, "User1")
	code, _ := a.do(t, http.MethodPost, "/api/admin/settings/registration", admin.token, map[string]bool{"enabled": false})
	if code != http.StatusOK {
		t.Fatalf("запрет регистрации: %d", code)
	}
	code, _ = a.do(t, http.MethodPost, "/api/register", "", map[string]string{"nick": "Newbie", "password": testPW})
	if code != http.StatusForbidden {
		t.Fatalf("регистрация при запрете: ожидали 403, получили %d", code)
	}
	// Ручная регистрация через админ панель работает.
	code, _ = a.do(t, http.MethodPost, "/api/admin/users", admin.token, map[string]string{"nick": "Manual", "password": testPW})
	if code != http.StatusCreated {
		t.Fatalf("ручная регистрация админом: ожидали 201, получили %d", code)
	}
	if _, err := a.srv.Store.GetUserByNick("manual"); err != nil {
		t.Fatal("пользователь, созданный через админ панель, должен существовать")
	}
	// Обычный пользователь не может пользоваться админ панелью.
	u1, _ := a.srv.Store.GetUserByNick("user1")
	u1Token, err := generateTestToken(u1.ID, a.cfg.JWTSecret)
	if err != nil {
		t.Fatal(err)
	}
	code, _ = a.do(t, http.MethodPost, "/api/admin/users", u1Token, map[string]string{"nick": "Hack", "password": testPW})
	if code != http.StatusForbidden {
		t.Fatalf("не-админ не должен создавать пользователей: %d", code)
	}
	code, _ = a.do(t, http.MethodPost, "/api/admin/settings/registration", admin.token, map[string]bool{"enabled": true})
	if code != http.StatusOK {
		t.Fatal("включение регистрации не удалось")
	}
	code, _ = a.do(t, http.MethodPost, "/api/register", "", map[string]string{"nick": "Again", "password": testPW})
	if code != http.StatusOK {
		t.Fatalf("после включения регистрация должна работать: %d", code)
	}
}

func TestPasswordResetByAdmin(t *testing.T) {
	a := newTestApp(t, nil)
	admin := a.register(t, "Admin")
	victim := a.register(t, "Victim")
	code, _ := a.do(t, http.MethodPost, fmt.Sprintf("/api/admin/users/%d/password", victim.id), victim.token,
		map[string]string{"password": "NewPassword12!"})
	if code != http.StatusForbidden {
		t.Fatalf("сброс пароля не-админом: ожидали 403, получили %d", code)
	}
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/admin/users/%d/password", victim.id), admin.token,
		map[string]string{"password": "NewPassword12!"})
	if code != http.StatusOK {
		t.Fatalf("сброс пароля админом: %d", code)
	}
	code, _ = a.do(t, http.MethodPost, "/api/login", "", map[string]string{"nick": "Victim", "password": testPW})
	if code != http.StatusUnauthorized {
		t.Fatalf("старый пароль не должен работать: %d", code)
	}
	code, _ = a.do(t, http.MethodPost, "/api/login", "", map[string]string{"nick": "Victim", "password": "NewPassword12!"})
	if code != http.StatusOK {
		t.Fatalf("новый пароль должен работать: %d", code)
	}
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/admin/users/%d/password", victim.id), admin.token,
		map[string]string{"password": "weak"})
	if code != http.StatusBadRequest {
		t.Fatalf("слабый пароль при сбросе: ожидали 400, получили %d", code)
	}
}

// ---------- Права и каналы ----------

func TestChannelPermissionsAndRights(t *testing.T) {
	a := newTestApp(t, nil)
	admin := a.register(t, "Admin")
	user1 := a.register(t, "User1")
	user2 := a.register(t, "User2")
	user3 := a.register(t, "User3")

	ch1 := a.mustChannel(t, user1.token, "Канал1", false)
	ch2 := a.mustChannel(t, user2.token, "Канал2", false)
	a.join(t, user2.token, ch1)
	a.join(t, user3.token, ch1)

	m, err := a.srv.Store.GetMember(ch1, user1.id)
	if err != nil || m.Role != "channel_admin" {
		t.Fatalf("создатель должен быть админом канала: %v", m)
	}
	code, _ := a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/members/%d/role", ch1, user2.id), user1.token,
		map[string]string{"role": "channel_moderator"})
	if code != http.StatusOK {
		t.Fatalf("назначение модератора: %d", code)
	}
	// Модератор канала 1 не имеет прав в канале 3, где он простой участник
	// (канал 2 создан самим user2, поэтому он там админ канала).
	ch3 := a.mustChannel(t, user3.token, "Канал3", false)
	a.join(t, user2.token, ch3)
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/members/%d/kick", ch3, user3.id), user2.token,
		map[string]string{"reason": "тест"})
	if code != http.StatusForbidden {
		t.Fatalf("модератор чужого канала не должен кикать: %d", code)
	}
	// Простой пользователь не может кикать.
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/members/%d/kick", ch1, user3.id), user3.token, nil)
	if code != http.StatusForbidden {
		t.Fatalf("простой пользователь не должен кикать: %d", code)
	}
	// Модератор своего канала может кикать.
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/members/%d/kick", ch1, user3.id), user2.token,
		map[string]string{"reason": "плохое поведение"})
	if code != http.StatusOK {
		t.Fatalf("модератор должен кикать в своём канале: %d", code)
	}
	// Админ канала может удалить только свой канал.
	code, _ = a.do(t, http.MethodDelete, fmt.Sprintf("/api/channels/%d", ch2), user1.token, nil)
	if code != http.StatusForbidden {
		t.Fatalf("админ канала не должен удалять чужой канал: %d", code)
	}
	code, _ = a.do(t, http.MethodDelete, fmt.Sprintf("/api/channels/%d", ch2), user2.token, nil)
	if code != http.StatusOK {
		t.Fatalf("админ канала должен удалять свой канал: %d", code)
	}
	code, _ = a.do(t, http.MethodDelete, fmt.Sprintf("/api/channels/%d", ch1), admin.token, nil)
	if code != http.StatusOK {
		t.Fatalf("админ сервера должен удалять любой канал: %d", code)
	}
}

func TestGroupPermissionOverrideAndDemotion(t *testing.T) {
	a := newTestApp(t, nil)
	admin := a.register(t, "Admin")
	user1 := a.register(t, "User1")
	user2 := a.register(t, "User2")
	ch := a.mustChannel(t, user1.token, "Канал", false)
	a.join(t, user2.token, ch)
	// Админ канала запрещает группе "user" писать сообщения.
	code, _ := a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/permissions", ch), user1.token,
		map[string]interface{}{"role": "user", "permission": "send_message", "allowed": false})
	if code != http.StatusOK {
		t.Fatalf("настройка прав группы: %d", code)
	}
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/messages", ch), user2.token,
		map[string]string{"ciphertext": b64("hi"), "iv": "aXY="})
	if code != http.StatusForbidden {
		t.Fatalf("после запрета права пользователь не должен писать: %d", code)
	}
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/messages", ch), user1.token,
		map[string]string{"ciphertext": b64("hi"), "iv": "aXY="})
	if code != http.StatusCreated {
		t.Fatalf("админ канала должен писать: %d", code)
	}
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/messages", ch), admin.token,
		map[string]string{"ciphertext": b64("hi2"), "iv": "aXYy"})
	if code != http.StatusCreated {
		t.Fatalf("админ сервера должен писать всегда: %d", code)
	}
	// Снятие админа канала без назначения нового — канал удаляется.
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/members/%d/role", ch, user1.id), admin.token,
		map[string]string{"role": "user"})
	if code != http.StatusOK {
		t.Fatalf("разжалование админа канала: %d", code)
	}
	code, _ = a.do(t, http.MethodGet, fmt.Sprintf("/api/channels/%d", ch), user1.token, nil)
	if code != http.StatusNotFound {
		t.Fatalf("канал без админа должен удалиться: %d", code)
	}
	_, list := a.doList(t, http.MethodGet, "/api/channels", user1.token, nil)
	if len(list) != 0 {
		t.Fatalf("удалённый канал не должен быть в списке: %v", list)
	}
	// Смена админа: серверный админ назначает нового админа вместо разжалованного.
	ch2 := a.mustChannel(t, user1.token, "Канал2", false)
	a.join(t, user2.token, ch2)
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/members/%d/role", ch2, user2.id), admin.token,
		map[string]string{"role": "channel_admin"})
	if code != http.StatusOK {
		t.Fatalf("назначение нового админа канала: %d", code)
	}
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/members/%d/role", ch2, user1.id), admin.token,
		map[string]string{"role": "user"})
	if code != http.StatusOK {
		t.Fatalf("разжалование старого админа при наличии нового: %d", code)
	}
	code, _ = a.do(t, http.MethodGet, fmt.Sprintf("/api/channels/%d", ch2), user1.token, nil)
	if code != http.StatusOK {
		t.Fatalf("канал с новым админом должен существовать: %d", code)
	}
}

// ---------- Сообщения ----------

func TestMessagesFlow(t *testing.T) {
	a := newTestApp(t, nil)
	user1 := a.register(t, "User1")
	user2 := a.register(t, "User2")
	mod := a.register(t, "Moderator")
	ch := a.mustChannel(t, user1.token, "Канал", false)
	a.join(t, user2.token, ch)
	a.join(t, mod.token, ch)
	a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/members/%d/role", ch, mod.id), user1.token,
		map[string]string{"role": "channel_moderator"})

	mid := a.sendMsg(t, user1.token, ch, "hello")
	a.sendMsg(t, user2.token, ch, "привет")
	_, list := a.doList(t, http.MethodGet, fmt.Sprintf("/api/channels/%d/messages", ch), user1.token, nil)
	if len(list) != 2 {
		t.Fatalf("ожидали 2 сообщения, получили %d", len(list))
	}
	// Редактирование своего сообщения.
	code, _ := a.do(t, http.MethodPatch, fmt.Sprintf("/api/channels/%d/messages/%d", ch, mid), user1.token,
		map[string]string{"ciphertext": b64("hello-edited"), "iv": "aXYy"})
	if code != http.StatusOK {
		t.Fatalf("редактирование: %d", code)
	}
	// Модератор видит историю (оригинал).
	_, list = a.doList(t, http.MethodGet, fmt.Sprintf("/api/channels/%d/messages", ch), mod.token, nil)
	if list[0].(map[string]interface{})["history"] == nil {
		t.Fatal("модератор должен видеть оригинал сообщения")
	}
	// Простой пользователь историю не видит.
	_, list = a.doList(t, http.MethodGet, fmt.Sprintf("/api/channels/%d/messages", ch), user2.token, nil)
	if list[0].(map[string]interface{})["history"] != nil {
		t.Fatal("простой пользователь не должен видеть историю")
	}
	// Нельзя редактировать чужие сообщения.
	code, _ = a.do(t, http.MethodPatch, fmt.Sprintf("/api/channels/%d/messages/%d", ch, mid), user2.token,
		map[string]string{"ciphertext": b64("hack"), "iv": "aXYz"})
	if code != http.StatusForbidden {
		t.Fatalf("редактирование чужого сообщения: ожидали 403, получили %d", code)
	}
	// Пользователь удаляет своё сообщение.
	code, delBody := a.do(t, http.MethodDelete, fmt.Sprintf("/api/channels/%d/messages/%d", ch, mid), user1.token, nil)
	if code != http.StatusOK {
		t.Fatalf("удаление своего сообщения: %d %v", code, delBody)
	}
	// Модератор видит удалённое сообщение.
	_, list = a.doList(t, http.MethodGet, fmt.Sprintf("/api/channels/%d/messages", ch), mod.token, nil)
	if list[0].(map[string]interface{})["deleted"] != true {
		t.Fatal("модератор должен видеть удалённое сообщение")
	}
	// Модератор удаляет чужое сообщение.
	mid2 := a.sendMsg(t, user2.token, ch, "удаляй меня")
	code, _ = a.do(t, http.MethodDelete, fmt.Sprintf("/api/channels/%d/messages/%d", ch, mid2), mod.token, nil)
	if code != http.StatusOK {
		t.Fatalf("модератор должен удалять чужие сообщения: %d", code)
	}
	// Простой пользователь не может удалять чужие сообщения.
	mid4 := a.sendMsg(t, user1.token, ch, "не трогай 2")
	code, _ = a.do(t, http.MethodDelete, fmt.Sprintf("/api/channels/%d/messages/%d", ch, mid4), user2.token, nil)
	if code != http.StatusForbidden {
		t.Fatalf("пользователь не должен удалять чужие сообщения: %d", code)
	}
	// ...но может удалить своё.
	mid3 := a.sendMsg(t, user2.token, ch, "не трогай")
	code, _ = a.do(t, http.MethodDelete, fmt.Sprintf("/api/channels/%d/messages/%d", ch, mid3), user2.token, nil)
	if code != http.StatusOK {
		t.Fatalf("пользователь должен удалять своё сообщение: %d", code)
	}
}

func TestDuplicateMessageRejected(t *testing.T) {
	a := newTestApp(t, nil)
	u := a.register(t, "User1")
	ch := a.mustChannel(t, u.token, "Канал", false)
	a.sendMsg(t, u.token, ch, "same")
	code, _ := a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/messages", ch), u.token,
		map[string]string{"ciphertext": b64("same"), "iv": "aXY="})
	if code != http.StatusConflict {
		t.Fatalf("дубликат сообщения: ожидали 409, получили %d", code)
	}
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/messages", ch), u.token,
		map[string]string{"ciphertext": b64("different"), "iv": "aXY="})
	if code != http.StatusCreated {
		t.Fatalf("новое сообщение должно проходить: %d", code)
	}
}

func TestMessageRateLimit(t *testing.T) {
	a := newTestApp(t, func(c *config.Config) { c.MessageRatePerSec = 3 })
	u := a.register(t, "User1")
	ch := a.mustChannel(t, u.token, "Канал", false)
	for i := 0; i < 3; i++ {
		code, _ := a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/messages", ch), u.token,
			map[string]string{"ciphertext": b64(fmt.Sprintf("m%d", i)), "iv": b64(fmt.Sprintf("iv%d", i))})
		if code != http.StatusCreated {
			t.Fatalf("сообщение %d: %d", i, code)
		}
	}
	code, _ := a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/messages", ch), u.token,
		map[string]string{"ciphertext": b64("too-many"), "iv": "aXZ4"})
	if code != http.StatusTooManyRequests {
		t.Fatalf("превышение лимита: ожидали 429, получили %d", code)
	}
}

func TestMessageTooLong(t *testing.T) {
	a := newTestApp(t, func(c *config.Config) { c.MaxMessageLen = 10 })
	u := a.register(t, "User1")
	ch := a.mustChannel(t, u.token, "Канал", false)
	code, _ := a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/messages", ch), u.token,
		map[string]string{"ciphertext": b64(strings.Repeat("x", 100)), "iv": "aXY="})
	if code != http.StatusBadRequest {
		t.Fatalf("слишком длинное сообщение: ожидали 400, получили %d", code)
	}
}

func TestConcurrentMessages(t *testing.T) {
	a := newTestApp(t, nil)
	u := a.register(t, "User1")
	ch := a.mustChannel(t, u.token, "Канал", false)
	const n = 40
	var wg sync.WaitGroup
	errs := make(chan error, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			code, _ := a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/messages", ch), u.token,
				map[string]string{"ciphertext": b64(fmt.Sprintf("bulk-%d", i)), "iv": b64(fmt.Sprintf("iv-%d", i))})
			if code != http.StatusCreated {
				errs <- fmt.Errorf("сообщение %d: код %d", i, code)
			}
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	_, list := a.doList(t, http.MethodGet, fmt.Sprintf("/api/channels/%d/messages", ch), u.token, nil)
	if len(list) != n {
		t.Fatalf("ожидали %d сообщений, получили %d", n, len(list))
	}
}

func TestServerAdminMessageProtected(t *testing.T) {
	a := newTestApp(t, nil)
	admin := a.register(t, "Admin")
	mod := a.register(t, "Moderator")
	ch := a.mustChannel(t, admin.token, "Канал", false)
	a.join(t, mod.token, ch)
	a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/members/%d/role", ch, mod.id), admin.token,
		map[string]string{"role": "channel_moderator"})
	mid := a.sendMsg(t, admin.token, ch, "сообщение админа")
	code, _ := a.do(t, http.MethodDelete, fmt.Sprintf("/api/channels/%d/messages/%d", ch, mid), mod.token, nil)
	if code != http.StatusForbidden {
		t.Fatalf("удаление сообщения админа сервера: ожидали 403, получили %d", code)
	}
}

// ---------- Приглашения в приватные каналы ----------

func TestPrivateChannelInvites(t *testing.T) {
	a := newTestApp(t, nil)
	user1 := a.register(t, "User1")
	user2 := a.register(t, "User2")
	user3 := a.register(t, "User3")

	ch := a.mustChannel(t, user1.token, "Приват", true)
	code, _ := a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/invites", ch), user1.token,
		map[string]int64{"user_id": user2.id})
	if code != http.StatusCreated {
		t.Fatalf("приглашение: %d", code)
	}
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/invites", ch), user1.token,
		map[string]int64{"user_id": user2.id})
	if code != http.StatusConflict {
		t.Fatalf("повторное приглашение пока pending: ожидали 409, получили %d", code)
	}
	_, inv := a.doList(t, http.MethodGet, "/api/invites", user2.token, nil)
	if len(inv) != 1 {
		t.Fatalf("ожидающие приглашения: %v", inv)
	}
	_, list := a.doList(t, http.MethodGet, "/api/channels", user2.token, nil)
	if len(list) != 0 {
		t.Fatal("приватный канал не должен быть виден до принятия")
	}
	inviteID := int64(inv[0].(map[string]interface{})["id"].(float64))
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/invites/%d/decline", inviteID), user2.token, nil)
	if code != http.StatusOK {
		t.Fatalf("отказ от приглашения: %d", code)
	}
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/invites", ch), user1.token,
		map[string]int64{"user_id": user2.id})
	if code != http.StatusCreated {
		t.Fatalf("повторное приглашение после отказа: %d", code)
	}
	_, inv = a.doList(t, http.MethodGet, "/api/invites", user2.token, nil)
	inviteID = int64(inv[0].(map[string]interface{})["id"].(float64))
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/invites/%d/accept", inviteID), user2.token, nil)
	if code != http.StatusOK {
		t.Fatalf("принятие приглашения: %d", code)
	}
	_, list = a.doList(t, http.MethodGet, "/api/channels", user2.token, nil)
	if len(list) != 1 {
		t.Fatal("приватный канал должен стать видимым")
	}
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/invites", ch), user1.token,
		map[string]int64{"user_id": user2.id})
	if code != http.StatusConflict {
		t.Fatalf("приглашение участнику: ожидали 409, получили %d", code)
	}
	// Простой пользователь не может приглашать: приглашаем его как участника.
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/invites", ch), user1.token,
		map[string]int64{"user_id": user3.id})
	if code != http.StatusCreated {
		t.Fatalf("приглашение user3: %d", code)
	}
	_, inv = a.doList(t, http.MethodGet, "/api/invites", user3.token, nil)
	inviteID = int64(inv[0].(map[string]interface{})["id"].(float64))
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/invites/%d/accept", inviteID), user3.token, nil)
	if code != http.StatusOK {
		t.Fatalf("принятие приглашения user3: %d", code)
	}
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/invites", ch), user3.token,
		map[string]int64{"user_id": user1.id})
	if code != http.StatusForbidden {
		t.Fatalf("простой пользователь не должен приглашать: %d", code)
	}
	// В приватный канал нельзя войти без приглашения.
	user4 := a.register(t, "User4")
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/join", ch), user4.token, nil)
	if code != http.StatusForbidden {
		t.Fatalf("вход в приватный канал без приглашения: ожидали 403, получили %d", code)
	}
}

func TestAdminSeesAllChannels(t *testing.T) {
	a := newTestApp(t, nil)
	admin := a.register(t, "Admin")
	user1 := a.register(t, "User1")
	ch := a.mustChannel(t, user1.token, "Секрет", true)
	_, list := a.doList(t, http.MethodGet, "/api/channels", admin.token, nil)
	if len(list) != 1 {
		t.Fatalf("админ сервера должен видеть все каналы: %v", list)
	}
	if int64(list[0].(map[string]interface{})["creator_id"].(float64)) != user1.id {
		t.Fatal("админ сервера должен видеть создателя канала")
	}
	_, adm := a.doList(t, http.MethodGet, "/api/admin/channels", admin.token, nil)
	if len(adm) != 1 {
		t.Fatalf("админ панель должна показывать каналы: %v", adm)
	}
	_ = ch
}

// ---------- Бан и кик ----------

func TestBanKickSemantics(t *testing.T) {
	a := newTestApp(t, nil)
	admin := a.register(t, "Admin")
	user1 := a.register(t, "User1")
	user2 := a.register(t, "User2")
	ch := a.mustChannel(t, user1.token, "Канал", false)
	a.join(t, user2.token, ch)

	// Кик: выкидывает, но можно сразу вернуться.
	code, _ := a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/members/%d/kick", ch, user2.id), user1.token,
		map[string]string{"reason": "шум"})
	if code != http.StatusOK {
		t.Fatalf("кик: %d", code)
	}
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/join", ch), user2.token, nil)
	if code != http.StatusOK {
		t.Fatalf("после кика можно вернуться: %d", code)
	}
	// Бан на канале: навсегда, доступ закрыт.
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/members/%d/ban", ch, user2.id), user1.token,
		map[string]string{"reason": "токсичность"})
	if code != http.StatusOK {
		t.Fatalf("бан: %d", code)
	}
	m, _ := a.srv.Store.GetMember(ch, user2.id)
	if !m.Banned || m.BanReason != "токсичность" {
		t.Fatal("бан не применился с причиной")
	}
	code, _ = a.do(t, http.MethodGet, fmt.Sprintf("/api/channels/%d/messages", ch), user2.token, nil)
	if code != http.StatusForbidden {
		t.Fatalf("забаненный не должен иметь доступ: %d", code)
	}
	code, _ = a.do(t, http.MethodDelete, fmt.Sprintf("/api/channels/%d/members/%d/ban", ch, user2.id), user1.token, nil)
	if code != http.StatusOK {
		t.Fatalf("разбан: %d", code)
	}
	code, _ = a.do(t, http.MethodGet, fmt.Sprintf("/api/channels/%d/messages", ch), user2.token, nil)
	if code != http.StatusOK {
		t.Fatalf("после разбана доступ должен вернуться: %d", code)
	}
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/members/%d/ban", ch, admin.id), user1.token, nil)
	if code != http.StatusForbidden {
		t.Fatalf("бан админа сервера: ожидали 403, получили %d", code)
	}
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/members/%d/kick", ch, admin.id), user1.token, nil)
	if code != http.StatusForbidden {
		t.Fatalf("кик админа сервера: ожидали 403, получили %d", code)
	}
}

func TestServerBanBlocksLogin(t *testing.T) {
	a := newTestApp(t, nil)
	admin := a.register(t, "Admin")
	victim := a.register(t, "Victim")
	code, _ := a.do(t, http.MethodPost, fmt.Sprintf("/api/admin/users/%d/server-ban", victim.id), admin.token,
		map[string]string{"reason": "нарушения"})
	if code != http.StatusOK {
		t.Fatalf("бан на сервере: %d", code)
	}
	code, _ = a.do(t, http.MethodPost, "/api/login", "", map[string]string{"nick": "Victim", "password": testPW})
	if code != http.StatusForbidden {
		t.Fatalf("забаненный не должен входить: %d", code)
	}
	code, _ = a.do(t, http.MethodGet, "/api/me", victim.token, nil)
	if code != http.StatusForbidden {
		t.Fatalf("забаненный не должен работать с API: %d", code)
	}
	code, _ = a.do(t, http.MethodDelete, fmt.Sprintf("/api/admin/users/%d/server-ban", victim.id), admin.token, nil)
	if code != http.StatusOK {
		t.Fatalf("разбан на сервере: %d", code)
	}
	code, _ = a.do(t, http.MethodPost, "/api/login", "", map[string]string{"nick": "Victim", "password": testPW})
	if code != http.StatusOK {
		t.Fatalf("после разбана вход должен работать: %d", code)
	}
}

// ---------- Ключи каналов ----------

func TestChannelKeyExchange(t *testing.T) {
	a := newTestApp(t, nil)
	user1 := a.register(t, "User1")
	user2 := a.register(t, "User2")
	ch := a.mustChannel(t, user1.token, "Канал", false)
	a.join(t, user2.token, ch)

	code, _ := a.do(t, http.MethodPost, "/api/users/key", user1.token, map[string]string{"device_id": "dev1", "public_key": "pk1"})
	if code != http.StatusOK {
		t.Fatal("публикация ключа устройства")
	}
	code, _ = a.do(t, http.MethodPost, "/api/users/key", user2.token, map[string]string{"device_id": "dev2", "public_key": "pk2"})
	if code != http.StatusOK {
		t.Fatal("публикация ключа устройства")
	}
	_, pending := a.doList(t, http.MethodGet, fmt.Sprintf("/api/channels/%d/keys/pending", ch), user1.token, nil)
	if len(pending) != 2 {
		t.Fatalf("pending-цели: %v", pending)
	}
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/keys/wrap", ch), user1.token,
		map[string]interface{}{"user_id": user2.id, "device_id": "dev2", "wrapped_key": []byte("wrapped-key-bytes")})
	if code != http.StatusOK {
		t.Fatalf("обёртка ключа: %d", code)
	}
	code, my := a.do(t, http.MethodGet, fmt.Sprintf("/api/channels/%d/keys/me?device_id=dev2", ch), user2.token, nil)
	if code != http.StatusOK || my["wrapped_key"] == nil {
		t.Fatalf("получение ключа: %d %v", code, my)
	}
	user3 := a.register(t, "User3")
	code, _ = a.do(t, http.MethodGet, fmt.Sprintf("/api/channels/%d/keys/me?device_id=dev2", ch), user3.token, nil)
	if code != http.StatusForbidden {
		t.Fatalf("неучастник не должен получать ключ: %d", code)
	}
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/keys/wrap", ch), user3.token,
		map[string]interface{}{"user_id": user2.id, "device_id": "dev2", "wrapped_key": []byte("x")})
	if code != http.StatusForbidden {
		t.Fatalf("неучастник не должен загружать ключи: %d", code)
	}
}

// ---------- Звонки ----------

func TestCallSingleAllAndLifecycle(t *testing.T) {
	a := newTestApp(t, func(c *config.Config) { c.RingTimeout = 5 * time.Second })
	caller := a.register(t, "Caller")
	u2 := a.register(t, "User2")
	u3 := a.register(t, "User3")
	u4 := a.register(t, "User4")
	ch := a.mustChannel(t, caller.token, "Канал", false)
	a.join(t, u2.token, ch)
	a.join(t, u3.token, ch)
	a.join(t, u4.token, ch)

	// Звонок одному пользователю.
	code, body := a.do(t, http.MethodPost, "/api/calls", caller.token,
		map[string]interface{}{"channel_id": ch, "target_ids": []int64{u2.id}})
	if code != http.StatusCreated {
		t.Fatalf("звонок одному: %d %v", code, body)
	}
	callID := int64(body["call"].(map[string]interface{})["id"].(float64))
	if body["token"] == nil {
		t.Fatal("звонок должен возвращать LiveKit-токен")
	}
	// Двойной вызов тем же инициатором невозможен.
	code, _ = a.do(t, http.MethodPost, "/api/calls", caller.token,
		map[string]interface{}{"channel_id": ch, "target_ids": []int64{u3.id}})
	if code != http.StatusConflict {
		t.Fatalf("двойной вызов: ожидали 409, получили %d", code)
	}
	// Неучастник канала не может быть вызван (инициатор — u3, у caller уже есть звонок).
	outsider := a.register(t, "Outsider")
	code, body = a.do(t, http.MethodPost, "/api/calls", u3.token,
		map[string]interface{}{"channel_id": ch, "target_ids": []int64{u4.id, outsider.id}})
	if code != http.StatusCreated {
		t.Fatalf("звонок с неучастником: %d", code)
	}
	secondCall := int64(body["call"].(map[string]interface{})["id"].(float64))
	if _, err := a.srv.Store.GetCallInvite(secondCall, outsider.id); err == nil {
		t.Fatal("неучастник канала не должен получить приглашение")
	}
	if inv, err := a.srv.Store.GetCallInvite(secondCall, u4.id); err != nil || inv.Status != "ringing" {
		t.Fatal("участник канала должен получить приглашение")
	}
	// Завершаем второй звонок (u3 уходит), чтобы u4 освободился для следующих тестов.
	a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/leave", secondCall), u3.token, nil)
	// Принятие вызова.
	code, body = a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/accept", callID), u2.token, nil)
	if code != http.StatusOK || body["token"] == nil {
		t.Fatalf("принятие вызова: %d %v", code, body)
	}
	call, _ := a.srv.Store.GetCall(callID)
	if call.Status != "active" {
		t.Fatalf("звонок должен стать active: %s", call.Status)
	}
	// Повторное принятие отклоняется.
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/accept", callID), u2.token, nil)
	if code != http.StatusConflict {
		t.Fatalf("повторное принятие: ожидали 409, получили %d", code)
	}
	// Когда никого не осталось — звонок завершается.
	a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/leave", callID), u2.token, nil)
	a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/leave", callID), caller.token, nil)
	call, _ = a.srv.Store.GetCall(callID)
	if call.Status != "ended" {
		t.Fatal("звонок должен завершиться, когда никого не осталось")
	}
	// Звонок сразу всем.
	code, body = a.do(t, http.MethodPost, "/api/calls", caller.token,
		map[string]interface{}{"channel_id": ch, "target_ids": []int64{u2.id, u3.id, u4.id}})
	if code != http.StatusCreated {
		t.Fatalf("звонок всем: %d %v", code, body)
	}
	callID = int64(body["call"].(map[string]interface{})["id"].(float64))
	for _, u := range []*testUser{u2, u3, u4} {
		inv, err := a.srv.Store.GetCallInvite(callID, u.id)
		if err != nil || inv.Status != "ringing" {
			t.Fatalf("все должны быть приглашены: %v %v", inv, err)
		}
	}
	// Отклонение вызова: вход позже через /join.
	a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/decline", callID), u3.token, nil)
	code, body = a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/join", callID), u3.token, nil)
	if code != http.StatusOK || body["token"] == nil {
		t.Fatalf("вход в звонок позже: %d %v", code, body)
	}
	// В звонок нельзя войти не будучи приглашённым.
	outsider2 := a.register(t, "Outsider2")
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/join", callID), outsider2.token, nil)
	if code != http.StatusForbidden {
		t.Fatalf("неприглашённый не должен входить в звонок: %d", code)
	}
}

func TestCallDuplicateInviteAndEmptyJoin(t *testing.T) {
	a := newTestApp(t, func(c *config.Config) { c.RingTimeout = 5 * time.Second })
	caller := a.register(t, "Caller")
	u2 := a.register(t, "User2")
	u3 := a.register(t, "User3")
	u4 := a.register(t, "User4")
	ch := a.mustChannel(t, caller.token, "Канал", false)
	a.join(t, u2.token, ch)
	a.join(t, u3.token, ch)
	a.join(t, u4.token, ch)

	a.do(t, http.MethodPost, "/api/calls", caller.token,
		map[string]interface{}{"channel_id": ch, "target_ids": []int64{u3.id}})
	code, body := a.do(t, http.MethodPost, "/api/calls", u2.token,
		map[string]interface{}{"channel_id": ch, "target_ids": []int64{u3.id, u4.id}})
	if code != http.StatusCreated {
		t.Fatalf("звонок с дублирующим участником: %d %v", code, body)
	}
	callID := int64(body["call"].(map[string]interface{})["id"].(float64))
	if _, err := a.srv.Store.GetCallInvite(callID, u3.id); err == nil {
		t.Fatal("u3 не должен быть приглашён дважды")
	}
	if inv, err := a.srv.Store.GetCallInvite(callID, u4.id); err != nil || inv.Status != "ringing" {
		t.Fatal("u4 должен быть приглашён")
	}

	// Пустой звонок: инициатор ушёл — звонок завершён, вход даёт ошибку.
	// Инициатор — u3 (у caller уже есть активный звонок).
	code, body = a.do(t, http.MethodPost, "/api/calls", u3.token,
		map[string]interface{}{"channel_id": ch, "target_ids": []int64{u2.id}})
	if code != http.StatusCreated {
		t.Fatalf("создание звонка: %d %v", code, body)
	}
	emptyCall := int64(body["call"].(map[string]interface{})["id"].(float64))
	a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/leave", emptyCall), u3.token, nil)
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/join", emptyCall), u2.token, nil)
	if code != http.StatusGone {
		t.Fatalf("вход в пустой звонок: ожидали 410, получили %d", code)
	}
	call, _ := a.srv.Store.GetCall(emptyCall)
	if call.Status != "ended" {
		t.Fatal("пустой звонок должен исчезнуть")
	}
}

func TestCallAutoDecline(t *testing.T) {
	a := newTestApp(t, nil)
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
	deadline := time.Now().Add(3 * time.Second)
	for {
		inv, _ := a.srv.Store.GetCallInvite(callID, u2.id)
		if inv != nil && inv.Status == "auto_declined" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("вызов не был отклонён автоматически")
		}
		time.Sleep(20 * time.Millisecond)
	}
	// Инициатор остался в звонке — можно войти позже.
	code, body = a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/join", callID), u2.token, nil)
	if code != http.StatusOK || body["token"] == nil {
		t.Fatalf("вход после автоотклонения: %d %v", code, body)
	}
}

// ---------- Присутствие (онлайн/офлайн) ----------

func TestPresenceOnlineOffline(t *testing.T) {
	a := newTestApp(t, nil)
	u := a.register(t, "User1")
	if a.srv.Hub.IsOnline(u.id) {
		t.Fatal("до подключения пользователь не должен быть онлайн")
	}
	conn := dialWS(t, a, u.token)
	deadline := time.Now().Add(2 * time.Second)
	for !a.srv.Hub.IsOnline(u.id) {
		if time.Now().After(deadline) {
			t.Fatal("пользователь не стал онлайн")
		}
		time.Sleep(20 * time.Millisecond)
	}
	_ = conn.Close()
	deadline = time.Now().Add(2 * time.Second)
	for a.srv.Hub.IsOnline(u.id) {
		if time.Now().After(deadline) {
			t.Fatal("пользователь не стал офлайн")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestKickedAndBannedEvents(t *testing.T) {
	a := newTestApp(t, nil)
	admin := a.register(t, "Admin")
	u1 := a.register(t, "User1")
	u2 := a.register(t, "User2")
	ch := a.mustChannel(t, u1.token, "Канал", false)
	a.join(t, u2.token, ch)

	conn := dialWS(t, a, u2.token)
	defer conn.Close()

	code, _ := a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/members/%d/ban", ch, u2.id), u1.token,
		map[string]string{"reason": "причина бана"})
	if code != http.StatusOK {
		t.Fatalf("бан: %d", code)
	}
	// Читаем события, пока не придёт banned (до него приходят presence и т.п.).
	readUntil := func(typ string) map[string]interface{} {
		t.Helper()
		_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		for {
			var msg map[string]interface{}
			if err := conn.ReadJSON(&msg); err != nil {
				t.Fatalf("не пришло событие %s: %v", typ, err)
			}
			if msg["type"] == typ {
				return msg
			}
		}
	}
	msg := readUntil("banned")
	if msg["data"].(map[string]interface{})["reason"] != "причина бана" {
		t.Fatalf("некорректное событие бана: %v", msg)
	}
	code, _ = a.do(t, http.MethodPost, fmt.Sprintf("/api/admin/users/%d/server-ban", u2.id), admin.token,
		map[string]string{"reason": "серверный бан"})
	if code != http.StatusOK {
		t.Fatalf("серверный бан: %d", code)
	}
	msg = readUntil("server_banned")
	if msg["data"].(map[string]interface{})["reason"] != "серверный бан" {
		t.Fatalf("некорректное событие: %v", msg)
	}
}

// ---------- Пнуть (Punch) ----------

func TestPunchRateLimit(t *testing.T) {
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
	a.do(t, http.MethodPost, fmt.Sprintf("/api/calls/%d/accept", callID), u2.token, nil)

	callerConn := dialWS(t, a, caller.token)
	defer callerConn.Close()
	u2Conn := dialWS(t, a, u2.token)
	defer u2Conn.Close()

	if err := callerConn.WriteJSON(map[string]interface{}{
		"type": "call.punch", "data": map[string]int64{"call_id": callID, "target_user_id": u2.id},
	}); err != nil {
		t.Fatal(err)
	}
	// Читаем события, пока не придёт punch (до него идут presence).
	_ = u2Conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var msg map[string]interface{}
	for {
		if err := u2Conn.ReadJSON(&msg); err != nil {
			t.Fatalf("первый пинок не дошёл: %v", err)
		}
		if msg["type"] == "punch" {
			break
		}
	}
	// Второй пинок в течение 10 секунд блокируется.
	if err := callerConn.WriteJSON(map[string]interface{}{
		"type": "call.punch", "data": map[string]int64{"call_id": callID, "target_user_id": u2.id},
	}); err != nil {
		t.Fatal(err)
	}
	_ = u2Conn.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	if err := u2Conn.ReadJSON(&msg); err == nil {
		t.Fatalf("второй пинок не должен дойти: %v", msg)
	}
}

// ---------- Конфиг и WebSocket ----------

func TestConfigEndpoint(t *testing.T) {
	a := newTestApp(t, func(c *config.Config) {
		c.LiveKitURL = "wss://livekit.example.com"
		c.TurnSharedSecret = "turn-secret"
		c.TurnURLs = []string{"turn:turn.example.com:3478"}
	})
	u := a.register(t, "User1")
	code, cfg := a.do(t, http.MethodGet, "/api/config", u.token, nil)
	if code != http.StatusOK {
		t.Fatalf("config: %d", code)
	}
	if cfg["livekit_url"] != "wss://livekit.example.com" {
		t.Fatalf("livekit_url: %v", cfg)
	}
	turn := cfg["turn"].(map[string]interface{})
	if turn["username"] == nil || turn["credential"] == nil {
		t.Fatal("должны выдаваться временные TURN-учётные данные")
	}
}

func TestWSRequiresAuth(t *testing.T) {
	a := newTestApp(t, nil)
	_, status, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(a.ts.URL, "http")+"/ws", nil)
	if err == nil {
		t.Fatal("WS без токена должен отклоняться")
	}
	_ = status
}

func TestInviteDeliveredOnlineImmediately(t *testing.T) {
	a := newTestApp(t, nil)
	user1 := a.register(t, "User1")
	user2 := a.register(t, "User2")
	ch := a.mustChannel(t, user1.token, "Приват", true)

	conn := dialWS(t, a, user2.token)
	defer conn.Close()
	// Приглашение отправляется после подключения.
	code, _ := a.do(t, http.MethodPost, fmt.Sprintf("/api/channels/%d/invites", ch), user1.token,
		map[string]int64{"user_id": user2.id})
	if code != http.StatusCreated {
		t.Fatalf("приглашение: %d", code)
	}
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	for {
		var msg map[string]interface{}
		if err := conn.ReadJSON(&msg); err != nil {
			t.Fatalf("не пришло приглашение: %v", err)
		}
		if msg["type"] == "invite.new" {
			return
		}
	}
}
