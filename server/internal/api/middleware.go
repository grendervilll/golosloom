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
		for _, o := range s.Cfg.AllowOrigins {
			if o == "*" || strings.EqualFold(o, origin) {
				allowed = true
				break
			}
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
	return auth.ParseToken(strings.TrimPrefix(h, "Bearer "), s.Cfg.JWTSecret)
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
