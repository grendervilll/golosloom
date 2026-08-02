package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestRateLimitLoginByIP(t *testing.T) {
	lim := newLimiter(3, time.Minute, 0, 0)
	allowed := 0
	for i := 0; i < 5; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/login", nil)
		req.RemoteAddr = "1.2.3.4:9999"
		w := httptest.NewRecorder()
		lim.handle(w, req, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusUnauthorized) })
		if w.Code != http.StatusTooManyRequests {
			allowed++
		}
	}
	if allowed != 3 {
		t.Fatalf("ожидали 3 разрешённых запроса, получили %d", allowed)
	}
}

func TestAccountLockout(t *testing.T) {
	lim := newLimiter(100, time.Minute, 3, 15*time.Minute)
	nick := "bruteforce"
	if lim.accountLocked(nick) {
		t.Fatal("аккаунт не должен быть заблокирован изначально")
	}
	lim.recordFailure(nick)
	lim.recordFailure(nick)
	if lim.accountLocked(nick) {
		t.Fatal("блокировка не должна наступить до порога")
	}
	lim.recordFailure(nick)
	if !lim.accountLocked(nick) {
		t.Fatal("аккаунт должен быть заблокирован после 3 неудач")
	}
	lim.recordSuccess(nick)
	if lim.accountLocked(nick) {
		t.Fatal("после успешного входа блокировка должна сняться")
	}
}

func TestRateLimitRegister(t *testing.T) {
	lim := newLimiter(2, time.Minute, 0, 0)
	allowed := 0
	for i := 0; i < 5; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/register", nil)
		req.RemoteAddr = "5.6.7.8:1"
		w := httptest.NewRecorder()
		lim.handle(w, req, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusCreated) })
		if w.Code != http.StatusTooManyRequests {
			allowed++
		}
	}
	if allowed != 2 {
		t.Fatalf("ожидали 2 разрешённых запроса, получили %d", allowed)
	}
}

func TestClientIP(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.0.1:5555"
	req.Header.Set("X-Forwarded-For", "8.8.8.8")
	if got := clientIP(req); got != "8.8.8.8" {
		t.Fatalf("ожидали 8.8.8.8, получили %s", got)
	}
	req2 := httptest.NewRequest(http.MethodGet, "/", nil)
	req2.RemoteAddr = "10.0.0.2:6666"
	if got := clientIP(req2); got != "10.0.0.2" {
		t.Fatalf("ожидали 10.0.0.2, получили %s", got)
	}
}

// Реальный эндпоинт /api/login с одного IP: после лимита — 429.
func TestLoginHandlerRateLimited(t *testing.T) {
	a := newTestApp(t, nil)
	a.srv.loginLimiter = newLimiter(2, time.Minute, 0, 0)
	router := a.srv.Router()
	for i := 0; i < 3; i++ {
		payload, _ := json.Marshal(map[string]string{"nick": "ghost", "password": "x"})
		req := httptest.NewRequest(http.MethodPost, "/api/login", bytes.NewReader(payload))
		req.RemoteAddr = "9.9.9.9:1234"
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if i < 2 && w.Code != http.StatusUnauthorized {
			t.Fatalf("запрос %d: ожидали 401, получили %d", i+1, w.Code)
		}
		if i == 2 && w.Code != http.StatusTooManyRequests {
			t.Fatalf("запрос 3: ожидали 429, получили %d", w.Code)
		}
	}
}
