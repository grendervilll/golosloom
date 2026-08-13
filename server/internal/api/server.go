package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
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

	statsMu       sync.Mutex
	prevCPUIdle   uint64
	prevCPUTotal  uint64

	push *pushService
	fcm  *fcmGateway
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
	s := &Server{
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
	// Web Push: сервис создаётся только если задан приватный VAPID-ключ.
	if cfg.VAPIDPrivateKey != "" {
		s.push = &pushService{
			publicKey:  cfg.VAPIDPublicKey,
			privateKey: cfg.VAPIDPrivateKey,
			subject:    cfg.VAPIDSubject,
		}
	}
	// FCM: только если на сервере лежит файл сервисного аккаунта.
	s.fcm = newFcmGateway(cfg.FCMServiceAccount)
	if s.fcm != nil {
		log.Printf("FCM gateway: включён (%s)", cfg.FCMServiceAccount)
	} else {
		log.Printf("FCM gateway: выключен (файл %s не найден или невалиден)", cfg.FCMServiceAccount)
	}
	// Уборка заброшенных загрузок (файл загружен, сообщение так и не создано).
	s.startFileCleanup()
	// Сверка участников звонков с комнатами LiveKit.
	s.startCallReconciler()
	return s
}

// startFileCleanup удаляет файлы без сообщения старше 24 часов (раз в час).
func (s *Server) startFileCleanup() {
	go func() {
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			files, err := s.Store.OrphanFiles(time.Now().Add(-24 * time.Hour))
			if err != nil {
				continue
			}
			ids := make([]int64, 0, len(files))
			for _, f := range files {
				ids = append(ids, f.ID)
				_ = os.Remove(f.Path)
			}
			if len(ids) > 0 {
				_ = s.Store.DeleteFiles(ids)
				log.Printf("Файлы: удалено %d заброшенных загрузок", len(ids))
			}
		}
	}()
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
