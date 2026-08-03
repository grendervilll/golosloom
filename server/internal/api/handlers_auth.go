package api

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strconv"

	"golosloom/server/internal/auth"
	"golosloom/server/internal/hub"
	"golosloom/server/internal/models"
	"golosloom/server/internal/store"
)

type registerReq struct {
	Nick     string `json:"nick"`
	Password string `json:"password"`
	Invite   string `json:"invite"`
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
	// Если регистрация запрещена — она доступна только по одноразовому
	// приглашению (действует 5 минут). Приглашение может давать доступ к каналу.
	var inviteChannel *int64
	if !s.Store.IsRegistrationEnabled() {
		if req.Invite == "" {
			writeErr(w, http.StatusForbidden, "регистрация новых пользователей запрещена — нужен код приглашения")
			return
		}
		ch, err := s.Store.ConsumeRegistrationInvite(req.Invite)
		if err != nil {
			writeErr(w, http.StatusForbidden, "приглашение недействительно или истекло (действует 5 минут)")
			return
		}
		inviteChannel = ch
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
	// Автоматический доступ к каналу, указанному в приглашении
	// (в т.ч. к приватному: членство даёт доступ).
	if inviteChannel != nil {
		_ = s.Store.AddMember(*inviteChannel, u.ID, models.RoleUser)
	}
	s.issueToken(w, u.ID)
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req registerReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "некорректный запрос")
		return
	}
	nick := auth.NormalizeNick(req.Nick)
	// Блокировка аккаунта после серии неудачных попыток.
	if nick != "" && s.loginLimiter.accountLocked(nick) {
		writeErr(w, http.StatusTooManyRequests, "слишком много неудачных попыток, аккаунт заблокирован на 15 минут")
		return
	}
	u, err := s.Store.GetUserByNick(nick)
	if err != nil {
		s.loginLimiter.recordFailure(nick)
		writeErr(w, http.StatusUnauthorized, "неверный логин или пароль")
		return
	}
	if u.ServerBanned {
		writeErr(w, http.StatusForbidden, "пользователь забанен на сервере")
		return
	}
	hash, err := s.Store.PasswordHash(u.ID)
	if err != nil || !auth.CheckPassword(hash, req.Password) {
		s.loginLimiter.recordFailure(nick)
		writeErr(w, http.StatusUnauthorized, "неверный логин или пароль")
		return
	}
	s.loginLimiter.recordSuccess(nick)
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

func (s *Server) handleAdminGetRegistration(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"enabled": s.Store.IsRegistrationEnabled()})
}

type createRegInviteReq struct {
	ChannelID *int64 `json:"channel_id"`
}

// handleCreateRegistrationInvite создаёт одноразовое приглашение на
// регистрацию (5 минут). Право: админ сервера (без канала или для любого),
// админ канала — приглашение для своего канала.
func (s *Server) handleCreateRegistrationInvite(w http.ResponseWriter, r *http.Request) {
	var req createRegInviteReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "некорректный запрос")
		return
	}
	u, err := s.Store.GetUserByID(userIDFrom(r))
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "пользователь не найден")
		return
	}
	var channelID *int64
	if req.ChannelID != nil && *req.ChannelID > 0 {
		if !u.IsServerAdmin {
			m, err := s.Store.GetMember(*req.ChannelID, u.ID)
			if err != nil || m.Role != models.RoleChannelAdmin {
				writeErr(w, http.StatusForbidden, "приглашение может создать админ сервера или админ канала")
				return
			}
		}
		channelID = req.ChannelID
	} else if !u.IsServerAdmin {
		writeErr(w, http.StatusForbidden, "приглашение может создать админ сервера или админ канала")
		return
	}
	token := make([]byte, 16)
	if _, err := rand.Read(token); err != nil {
		writeErr(w, http.StatusInternalServerError, "ошибка генерации приглашения")
		return
	}
	t := hex.EncodeToString(token)
	if err := s.Store.CreateRegistrationInvite(t, channelID, u.ID); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"token":      t,
		"expires_in": int(store.RegistrationInviteTTL.Seconds()),
		"channel_id": channelID,
	})
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
