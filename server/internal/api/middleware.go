package api

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"golosloom/server/internal/auth"
)

type ctxKey string

const ctxUserID ctxKey = "userID"

func userIDFrom(r *http.Request) int64 {
	id, _ := r.Context().Value(ctxUserID).(int64)
	return id
}

func withCORS(s *Server, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		allowed := false
		// Explicit wildcard or exact match.
		for _, o := range s.Cfg.AllowOrigins {
			if o == "*" || strings.EqualFold(o, origin) {
				allowed = true
				break
			}
			// Prefix wildcard like "capacitor://*" or "tauri://*"
			if strings.HasSuffix(o, "*") {
				prefix := strings.TrimSuffix(o, "*")
				if strings.HasPrefix(origin, prefix) {
					allowed = true
					break
				}
			}
		}
		// Electron and some WebViews use file:// or null origin — always allow
		// them because the API is authenticated via Bearer token, not cookies.
		if !allowed && (origin == "" || origin == "null" || strings.HasPrefix(origin, "file://") ||
			strings.HasPrefix(origin, "capacitor://") || strings.HasPrefix(origin, "tauri://")) {
			allowed = true
			// For null/file origins, use "*" but without credentials, or echo origin
			// if present; for file:// we echo the origin.
			if origin == "" || origin == "null" {
				w.Header().Set("Access-Control-Allow-Origin", "*")
			} else {
				w.Header().Set("Access-Control-Allow-Origin", origin)
			}
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
			return
		}
		if allowed {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, err := s.authenticate(r)
		if err != nil {
			writeErr(w, http.StatusUnauthorized, "требуется авторизация")
			return
		}
		u, err := s.Store.GetUserByID(userID)
		if err != nil {
			writeErr(w, http.StatusUnauthorized, "пользователь не найден")
			return
		}
		if u.ServerBanned {
			writeErr(w, http.StatusForbidden, "пользователь забанен на сервере")
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), ctxUserID, userID)))
	}
}

func (s *Server) authenticate(r *http.Request) (int64, error) {
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		return 0, errors.New("no token")
	}
	userID, ver, err := auth.ParseToken(strings.TrimPrefix(h, "Bearer "), s.Cfg.JWTSecret)
	if err != nil {
		return 0, err
	}
	// Пароль сменили — версия токена устарела («разлогин везде»).
	u, err := s.Store.GetUserByID(userID)
	if err != nil || u.TokenVersion != ver {
		return 0, errors.New("token version mismatch")
	}
	return userID, nil
}

func (s *Server) requireServerAdmin(next http.HandlerFunc) http.HandlerFunc {
	return s.requireAuth(func(w http.ResponseWriter, r *http.Request) {
		u, err := s.Store.GetUserByID(userIDFrom(r))
		if err != nil {
			writeErr(w, http.StatusUnauthorized, "пользователь не найден")
			return
		}
		if !u.IsServerAdmin {
			writeErr(w, http.StatusForbidden, "нет прав админа сервера")
			return
		}
		next(w, r)
	})
}
