package api

import (
	"net/http"
	"strconv"

	"golosloom/server/internal/auth"
	"golosloom/server/internal/hub"
	"golosloom/server/internal/store"
)

type registerReq struct {
	Nick     string `json:"nick"`
	Password string `json:"password"`
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req registerReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "некорректный запрос")
		return
	}
	nick := auth.NormalizeNick(req.Nick)
	if nick == "" {
		writeErr(w, http.StatusBadRequest, "ник не может быть пустым")
		return
	}
	if err := auth.ValidatePassword(req.Password); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if !s.Store.IsRegistrationEnabled() {
		writeErr(w, http.StatusForbidden, "регистрация новых пользователей запрещена админом сервера")
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	u, err := s.Store.CreateUser(nick, hash)
	if err != nil {
		if err == store.ErrDuplicateNick {
			writeErr(w, http.StatusConflict, "ник уже занят")
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.issueToken(w, u.ID)
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req registerReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "некорректный запрос")
		return
	}
	u, err := s.Store.GetUserByNick(auth.NormalizeNick(req.Nick))
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "неверный логин или пароль")
		return
	}
	if u.ServerBanned {
		writeErr(w, http.StatusForbidden, "пользователь забанен на сервере")
		return
	}
	hash, err := s.Store.PasswordHash(u.ID)
	if err != nil || !auth.CheckPassword(hash, req.Password) {
		writeErr(w, http.StatusUnauthorized, "неверный логин или пароль")
		return
	}
	s.issueToken(w, u.ID)
}

func (s *Server) issueToken(w http.ResponseWriter, userID int64) {
	token, err := auth.GenerateToken(userID, s.Cfg.JWTSecret, s.Cfg.JWTTTL)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"token": token})
}

// ---------- Админ панель сервера ----------

func (s *Server) handleAdminCreateUser(w http.ResponseWriter, r *http.Request) {
	var req registerReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "некорректный запрос")
		return
	}
	nick := auth.NormalizeNick(req.Nick)
	if nick == "" {
		writeErr(w, http.StatusBadRequest, "ник не может быть пустым")
		return
	}
	if err := auth.ValidatePassword(req.Password); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	u, err := s.Store.CreateUser(nick, hash)
	if err != nil {
		if err == store.ErrDuplicateNick {
			writeErr(w, http.StatusConflict, "ник уже занят")
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, u)
}

type passwordReq struct {
	Password string `json:"password"`
}

func (s *Server) handleAdminResetPassword(w http.ResponseWriter, r *http.Request) {
	id := pathID(r, "id")
	if id == 0 {
		writeErr(w, http.StatusBadRequest, "неверный id")
		return
	}
	var req passwordReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "некорректный запрос")
		return
	}
	if err := auth.ValidatePassword(req.Password); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := s.Store.SetPassword(id, hash); err != nil {
		writeErr(w, http.StatusNotFound, "пользователь не найден")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

type banReq struct {
	Reason string `json:"reason"`
}

func (s *Server) handleAdminServerBan(w http.ResponseWriter, r *http.Request) {
	id := pathID(r, "id")
	if id == 0 {
		writeErr(w, http.StatusBadRequest, "неверный id")
		return
	}
	var req banReq
	_ = readJSON(r, &req)
	if err := s.Store.SetServerBan(id, req.Reason); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	// Разрываем активные подключения забаненного.
	s.Hub.SendToUser(id, hub.NewEvent("server_banned", map[string]string{"reason": req.Reason}))
	s.Hub.CloseUser(id)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleAdminServerUnban(w http.ResponseWriter, r *http.Request) {
	id := pathID(r, "id")
	if id == 0 {
		writeErr(w, http.StatusBadRequest, "неверный id")
		return
	}
	if err := s.Store.UnbanServer(id); err != nil {
		writeErr(w, http.StatusNotFound, "пользователь не найден")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

type registrationReq struct {
	Enabled bool `json:"enabled"`
}

func (s *Server) handleAdminSetRegistration(w http.ResponseWriter, r *http.Request) {
	var req registrationReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "некорректный запрос")
		return
	}
	if err := s.Store.SetRegistrationEnabled(req.Enabled); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleUploadKey(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DeviceID  string `json:"device_id"`
		PublicKey string `json:"public_key"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "некорректный запрос")
		return
	}
	if req.DeviceID == "" || req.PublicKey == "" {
		writeErr(w, http.StatusBadRequest, "device_id и public_key обязательны")
		return
	}
	if err := s.Store.UpsertDevice(userIDFrom(r), req.DeviceID, req.PublicKey); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Новое устройство зарегистрировано — остальные устройства пользователя
	// должны раздать ему ключи каналов (обёрнутый ключ может создать только
	// клиент, у которого есть открытый ключ канала).
	s.Hub.SendToUser(userIDFrom(r), hub.NewEvent("device.registered", map[string]interface{}{
		"device_id": req.DeviceID,
	}))
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func pathID(r *http.Request, name string) int64 {
	id, err := strconv.ParseInt(r.PathValue(name), 10, 64)
	if err != nil {
		return 0
	}
	return id
}
