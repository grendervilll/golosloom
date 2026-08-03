package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"golosloom/server/internal/config"
	"golosloom/server/internal/hub"
	"golosloom/server/internal/store"
)

type Server struct {
	Cfg       config.Config
	Store     *store.Store
	Hub       *hub.Hub
	startedAt time.Time

	msgMu     sync.Mutex
	lastMsg   map[string]time.Time // ключ: channel:user:hex(ct):hex(iv) -> время
	buckets   map[int64]*bucket    // rate limit сообщений на пользователя
	punchMu   sync.Mutex
	lastPunch map[string]time.Time // ключ: from:to

	loginLimiter    *limiter
	registerLimiter *limiter
}

type bucket struct {
	mu    sync.Mutex
	used  int
	reset time.Time
}

func New(cfg config.Config, st *store.Store) *Server {
	// Завершаем звонки, оставшиеся «активными» после предыдущего запуска
	// (например, при падении или перезапуске сервера).
	_ = st.EndAllActiveCalls()
	return &Server{
		Cfg:             cfg,
		Store:           st,
		Hub:             hub.New(),
		startedAt:       time.Now(),
		lastMsg:         map[string]time.Time{},
		loginLimiter:    newLimiter(20, 15*time.Minute, 8, 15*time.Minute),
		registerLimiter: newLimiter(15, 15*time.Minute, 0, 0),
		buckets:         map[int64]*bucket{},
		lastPunch:       map[string]time.Time{},
	}
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func readJSON(r *http.Request, v interface{}) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(v)
}

func (s *Server) logf(format string, args ...interface{}) {
	log.Printf(format, args...)
}

// allowMessageRate — проверка лимита частоты сообщений на пользователя.
func (s *Server) allowMessageRate(userID int64) bool {
	s.msgMu.Lock()
	b := s.buckets[userID]
	now := time.Now()
	if b == nil {
		b = &bucket{reset: now.Add(time.Second)}
		s.buckets[userID] = b
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	s.msgMu.Unlock()
	if now.After(b.reset) {
		b.used = 0
		b.reset = now.Add(time.Second)
	}
	if b.used >= s.Cfg.MessageRatePerSec {
		return false
	}
	b.used++
	return true
}

// isDuplicateMessage — проверка отправки одинакового сообщения дважды подряд.
func (s *Server) isDuplicateMessage(channelID, userID int64, ciphertext, iv []byte) bool {
	key := timeKey(channelID, userID, ciphertext, iv)
	s.msgMu.Lock()
	defer s.msgMu.Unlock()
	if t, ok := s.lastMsg[key]; ok && time.Since(t) < 10*time.Second {
		return true
	}
	s.lastMsg[key] = time.Now()
	return false
}

// allowPunch — кнопку "Пнуть" можно нажимать раз в 10 секунд (на пару from->to).
func (s *Server) allowPunch(from, to int64) bool {
	key := punchKey(from, to)
	s.punchMu.Lock()
	defer s.punchMu.Unlock()
	if t, ok := s.lastPunch[key]; ok && time.Since(t) < s.Cfg.PunchInterval {
		return false
	}
	s.lastPunch[key] = time.Now()
	return true
}

func timeKey(parts ...interface{}) string {
	out := ""
	for _, p := range parts {
		out += stringify(p) + ":"
	}
	return out
}

func stringify(v interface{}) string {
	switch t := v.(type) {
	case []byte:
		return fmt.Sprintf("%x", t)
	case string:
		return t
	case int64:
		return fmt.Sprintf("%d", t)
	default:
		return fmt.Sprintf("%v", t)
	}
}

func punchKey(from, to int64) string { return timeKey(from, to) }
