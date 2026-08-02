package api

import (
	"net/http"

	perms "golosloom/server/internal/perm"

	"golosloom/server/internal/livekit"
	"golosloom/server/internal/models"
)

// NewRouter собирает все маршруты REST и WebSocket.
func (s *Server) Router() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/config", s.handleConfig)
	mux.HandleFunc("POST /api/register", func(w http.ResponseWriter, r *http.Request) {
		s.registerLimiter.handle(w, r, s.handleRegister)
	})
	mux.HandleFunc("POST /api/login", func(w http.ResponseWriter, r *http.Request) {
		s.loginLimiter.handle(w, r, s.handleLogin)
	})
	mux.HandleFunc("GET /ws", s.handleWS)

	mux.HandleFunc("GET /api/me", s.requireAuth(s.handleMe))

	// Админ панель сервера
	mux.HandleFunc("GET /api/admin/users", s.requireServerAdmin(s.handleAdminListUsers))
	mux.HandleFunc("POST /api/admin/users", s.requireServerAdmin(s.handleAdminCreateUser))
	mux.HandleFunc("POST /api/admin/users/{id}/password", s.requireServerAdmin(s.handleAdminResetPassword))
	mux.HandleFunc("POST /api/admin/users/{id}/server-ban", s.requireServerAdmin(s.handleAdminServerBan))
	mux.HandleFunc("DELETE /api/admin/users/{id}/server-ban", s.requireServerAdmin(s.handleAdminServerUnban))
	mux.HandleFunc("POST /api/admin/settings/registration", s.requireServerAdmin(s.handleAdminSetRegistration))
	mux.HandleFunc("GET /api/admin/channels", s.requireServerAdmin(s.handleAdminListChannels))

	// Пользователи
	mux.HandleFunc("POST /api/users/key", s.requireAuth(s.handleUploadKey))
	mux.HandleFunc("GET /api/users", s.requireAuth(s.handleListUsers))

	// Каналы
	mux.HandleFunc("POST /api/channels", s.requireAuth(s.handleCreateChannel))
	mux.HandleFunc("GET /api/channels", s.requireAuth(s.handleListChannels))
	mux.HandleFunc("GET /api/channels/{id}", s.requireAuth(s.handleGetChannel))
	mux.HandleFunc("DELETE /api/channels/{id}", s.requireAuth(s.handleDeleteChannel))
	mux.HandleFunc("POST /api/channels/{id}/join", s.requireAuth(s.handleJoinChannel))
	mux.HandleFunc("GET /api/channels/{id}/members", s.requireAuth(s.handleListMembers))
	mux.HandleFunc("GET /api/channels/{id}/banned", s.requireAuth(s.handleListBannedMembers))
	mux.HandleFunc("POST /api/channels/{id}/members/{uid}/role", s.requireAuth(s.handleSetMemberRole))
	mux.HandleFunc("POST /api/channels/{id}/members/{uid}/ban", s.requireAuth(s.handleBanMember))
	mux.HandleFunc("DELETE /api/channels/{id}/members/{uid}/ban", s.requireAuth(s.handleUnbanMember))
	mux.HandleFunc("POST /api/channels/{id}/members/{uid}/kick", s.requireAuth(s.handleKickMember))
	mux.HandleFunc("GET /api/channels/{id}/permissions", s.requireAuth(s.handleGetChannelPermissions))
	mux.HandleFunc("POST /api/channels/{id}/permissions", s.requireAuth(s.handleSetChannelPermission))

	// Приглашения
	mux.HandleFunc("POST /api/channels/{id}/invites", s.requireAuth(s.handleCreateInvite))
	mux.HandleFunc("GET /api/invites", s.requireAuth(s.handleListMyInvites))
	mux.HandleFunc("POST /api/invites/{id}/accept", s.requireAuth(s.handleAcceptInvite))
	mux.HandleFunc("POST /api/invites/{id}/decline", s.requireAuth(s.handleDeclineInvite))

	// Ключи каналов
	mux.HandleFunc("POST /api/channels/{id}/keys/wrap", s.requireAuth(s.handleUploadWrappedKey))
	mux.HandleFunc("GET /api/channels/{id}/keys/me", s.requireAuth(s.handleGetMyWrappedKey))
	mux.HandleFunc("GET /api/channels/{id}/keys/pending", s.requireAuth(s.handlePendingKeyTargets))

	// Сообщения
	mux.HandleFunc("GET /api/channels/{id}/messages", s.requireAuth(s.handleListMessages))
	mux.HandleFunc("POST /api/channels/{id}/messages", s.requireAuth(s.handleSendMessage))
	mux.HandleFunc("PATCH /api/channels/{id}/messages/{mid}", s.requireAuth(s.handleEditMessage))
	mux.HandleFunc("DELETE /api/channels/{id}/messages/{mid}", s.requireAuth(s.handleDeleteMessage))

	// Звонки
	mux.HandleFunc("POST /api/calls", s.requireAuth(s.handleCreateCall))
	mux.HandleFunc("GET /api/channels/{id}/calls", s.requireAuth(s.handleListCalls))
	mux.HandleFunc("POST /api/calls/{id}/accept", s.requireAuth(s.handleAcceptCall))
	mux.HandleFunc("POST /api/calls/{id}/decline", s.requireAuth(s.handleDeclineCall))
	mux.HandleFunc("POST /api/calls/{id}/join", s.requireAuth(s.handleJoinCall))
	mux.HandleFunc("POST /api/calls/{id}/leave", s.requireAuth(s.handleLeaveCall))

	return withCORS(s, mux)
}

func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	username, credential, err := livekit.TurnCredentials(s.Cfg.TurnSharedSecret, s.Cfg.TurnRealm, 24*3600)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "turn credentials error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ws_path":       "/ws",
		"livekit_url":   s.Cfg.LiveKitURL,
		"max_message_len": s.Cfg.MaxMessageLen,
		"turn": map[string]interface{}{
			"urls":       s.Cfg.TurnURLs,
			"username":   username,
			"credential": credential,
		},
	})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	u, err := s.Store.GetUserByID(userIDFrom(r))
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "пользователь не найден")
		return
	}
	writeJSON(w, http.StatusOK, u)
}

// handleListUsers — список пользователей сервера (для приглашений и выбора).
func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.Store.ListUsers()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(users))
	for _, u := range users {
		out = append(out, map[string]interface{}{
			"id":              u.ID,
			"nick":            u.Nick,
			"is_server_admin": u.IsServerAdmin,
			"online":          s.Hub.IsOnline(u.ID),
		})
	}
	writeJSON(w, http.StatusOK, out)
}

// ---------- Валидация доступа к каналу ----------

// requireChannelMember возвращает канал и роль пользователя, если он участник.
func (s *Server) requireChannelMember(w http.ResponseWriter, r *http.Request, channelID int64) (models.Role, bool) {
	u, err := s.Store.GetUserByID(userIDFrom(r))
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "пользователь не найден")
		return "", false
	}
	if u.IsServerAdmin {
		return models.RoleServerAdmin, true
	}
	m, err := s.Store.GetMember(channelID, userIDFrom(r))
	if err != nil || m.Banned {
		writeErr(w, http.StatusForbidden, "нет доступа к каналу")
		return "", false
	}
	return m.Role, true
}

func (s *Server) can(w http.ResponseWriter, role models.Role, channelID int64, permission models.Permission) bool {
	if !perms.Can(s.Store, channelID, role, permission) {
		writeErr(w, http.StatusForbidden, "недостаточно прав")
		return false
	}
	return true
}

// ---------- Админ панель ----------

func (s *Server) handleAdminListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.Store.ListUsers()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(users))
	for _, u := range users {
		out = append(out, map[string]interface{}{
			"id":              u.ID,
			"nick":            u.Nick,
			"is_server_admin": u.IsServerAdmin,
			"server_banned":   u.ServerBanned,
			"server_ban_reason": u.ServerBanReason,
			"online":          s.Hub.IsOnline(u.ID),
			"created_at":      u.CreatedAt,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleAdminListChannels(w http.ResponseWriter, r *http.Request) {
	channels, err := s.Store.ListAllChannels()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(channels))
	for _, c := range channels {
		creator, err := s.Store.GetUserByID(c.CreatorID)
		if err != nil {
			creator = &models.User{}
		}
		out = append(out, map[string]interface{}{
			"id":           c.ID,
			"name":         c.Name,
			"private":      c.Private,
			"creator_id":   c.CreatorID,
			"creator_nick": creator.Nick,
			"created_at":   c.CreatedAt,
		})
	}
	writeJSON(w, http.StatusOK, out)
}
