// Публичный health check для Docker и внешнего мониторинга.
package api

import (
	"net/http"
	"time"
)

// handleHealth — лёгкая проверка живости сервиса и доступности базы данных.
// Без аутентификации: health check должен работать без токена.
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if err := s.Store.Ping(); err != nil {
		writeErr(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":     "ok",
		"version":    "1.2.5",
		"uptime_sec": int64(time.Since(s.startedAt).Seconds()),
	})
}
