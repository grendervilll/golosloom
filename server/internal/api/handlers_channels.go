package api

import (
	"net/http"

	"golosloom/server/internal/auth"
	"golosloom/server/internal/hub"
	"golosloom/server/internal/models"
	"golosloom/server/internal/store"
)

type createChannelReq struct {
	Name    string `json:"name"`
	Private bool   `json:"private"`
}

func (s *Server) handleCreateChannel(w http.ResponseWriter, r *http.Request) {
	var req createChannelReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "некорректный запрос")
		return
	}
	req.Name = auth.NormalizeNick(req.Name)
	if req.Name == "" {
		writeErr(w, http.StatusBadRequest, "название канала не может быть пустым")
		return
	}
	c, err := s.Store.CreateChannel(req.Name, req.Private, userIDFrom(r))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Создатель автоматически становится админом канала.
	if err := s.Store.AddMember(c.ID, userIDFrom(r), models.RoleChannelAdmin); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Приватный канал виден только его участникам; публичный — всем.
	// Создатель уже является участником (и админом канала).
	s.Hub.SendToChannel(c.ID, hub.NewEvent("channel.created", c))
	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"id":         c.ID,
		"name":       c.Name,
		"private":    c.Private,
		"creator_id": c.CreatorID,
		"created_at": c.CreatedAt,
		"is_member":  true,
		"role":       models.RoleChannelAdmin,
	})
}

func (s *Server) handleListChannels(w http.ResponseWriter, r *http.Request) {
	var channels []models.Channel
	var err error
	u, _ := s.Store.GetUserByID(userIDFrom(r))
	if u != nil && u.IsServerAdmin {
		// Админ сервера видит все каналы, включая приватные.
		channels, err = s.Store.ListAllChannels()
	} else {
		channels, err = s.Store.ListChannelsForUser(userIDFrom(r))
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Добавляем флаг is_member и роль для текущего пользователя.
	out := make([]map[string]interface{}, 0, len(channels))
	for _, c := range channels {
		item := map[string]interface{}{
			"id":         c.ID,
			"name":       c.Name,
			"private":    c.Private,
			"creator_id": c.CreatorID,
			"created_at": c.CreatedAt,
			"is_member":  false,
		}
		if m, err := s.Store.GetMember(c.ID, userIDFrom(r)); err == nil && !m.Banned {
			item["is_member"] = true
			item["role"] = m.Role
		}
		out = append(out, item)
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleGetChannel(w http.ResponseWriter, r *http.Request) {
	id := pathID(r, "id")
	c, err := s.Store.GetChannel(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "канал не найден")
		return
	}
	u, err := s.Store.GetUserByID(userIDFrom(r))
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "пользователь не найден")
		return
	}
	member := u.IsServerAdmin
	role := models.RoleServerAdmin
	if !member {
		m, err := s.Store.GetMember(id, u.ID)
		if err == nil && !m.Banned {
			member = true
			role = m.Role
		}
	}
	if !member && c.Private {
		writeErr(w, http.StatusForbidden, "нет доступа к каналу")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"id":         c.ID,
		"name":       c.Name,
		"private":    c.Private,
		"creator_id": c.CreatorID,
		"created_at": c.CreatedAt,
		"is_member":  member,
		"role":       role,
	})
}

func (s *Server) handleDeleteChannel(w http.ResponseWriter, r *http.Request) {
	id := pathID(r, "id")
	c, err := s.Store.GetChannel(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "канал не найден")
		return
	}
	u, _ := s.Store.GetUserByID(userIDFrom(r))
	if !u.IsServerAdmin {
		role, ok := s.requireChannelMember(w, r, id)
		if !ok {
			return
		}
		if !s.can(w, role, id, models.PermDeleteChannel) {
			return
		}
		if c.CreatorID != u.ID {
			writeErr(w, http.StatusForbidden, "админ канала может удалить только свой канал")
			return
		}
	}
	s.endChannelCalls(id, "канал удалён")
	if err := s.Store.DeleteChannel(id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.Hub.SendToChannel(id, hub.NewEvent("channel.deleted", map[string]int64{"channel_id": id}))
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// endChannelCalls завершает все активные звонки канала.
func (s *Server) endChannelCalls(channelID int64, reason string) {
	calls, err := s.Store.ActiveCallsInChannel(channelID)
	if err != nil {
		return
	}
	for _, call := range calls {
		s.finishCall(call, reason)
	}
}

func (s *Server) handleJoinChannel(w http.ResponseWriter, r *http.Request) {
	id := pathID(r, "id")
	c, err := s.Store.GetChannel(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "канал не найден")
		return
	}
	if c.Private {
		writeErr(w, http.StatusForbidden, "приватный канал — вход только по приглашению")
		return
	}
	u, err := s.Store.GetUserByID(userIDFrom(r))
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "пользователь не найден")
		return
	}
	if u.IsServerAdmin {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	if m, err := s.Store.GetMember(id, u.ID); err == nil {
		if m.Banned {
			writeErr(w, http.StatusForbidden, "пользователь забанен в канале")
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	if err := s.Store.AddMember(id, u.ID, models.RoleUser); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Участники с ключом канала обернут его для нового участника.
	s.broadcastKeyNeeded(id, u.ID)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// broadcastKeyNeeded сообщает участникам канала устройства нового участника,
// чтобы владельцы ключа канала обернули его для него.
func (s *Server) broadcastKeyNeeded(channelID, userID int64) {
	devices, err := s.Store.UserDevices(userID)
	if err != nil {
		return
	}
	for _, d := range devices {
		s.Hub.SendToChannel(channelID, hub.NewEvent("key.needed", map[string]interface{}{
			"channel_id": channelID,
			"user_id":    userID,
			"device_id":  d.DeviceID,
			"public_key": d.PublicKey,
		}))
	}
}

// ---------- Приглашения ----------

func (s *Server) handleCreateInvite(w http.ResponseWriter, r *http.Request) {
	channelID := pathID(r, "id")
	c, err := s.Store.GetChannel(channelID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "канал не найден")
		return
	}
	u, _ := s.Store.GetUserByID(userIDFrom(r))
	if !u.IsServerAdmin {
		role, ok := s.requireChannelMember(w, r, channelID)
		if !ok {
			return
		}
		if !s.can(w, role, channelID, models.PermInvite) {
			return
		}
	}
	var req struct {
		UserID int64 `json:"user_id"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "некорректный запрос")
		return
	}
	if req.UserID == 0 {
		writeErr(w, http.StatusBadRequest, "user_id обязателен")
		return
	}
	if _, err := s.Store.GetUserByID(req.UserID); err != nil {
		writeErr(w, http.StatusBadRequest, "пользователь не найден")
		return
	}
	if m, err := s.Store.GetMember(channelID, req.UserID); err == nil && !m.Banned {
		writeErr(w, http.StatusConflict, "пользователь уже в этом канале")
		return
	}
	inv, err := s.Store.CreateInvite(channelID, req.UserID, userIDFrom(r))
	if err != nil {
		if err.Error() == "приглашение уже отправлено" {
			writeErr(w, http.StatusConflict, "приглашение уже отправлено")
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = c
	data := map[string]interface{}{
		"invite":       inv,
		"channel_name": s.channelName(channelID),
	}
	// Приглашение приходит сразу (онлайн — мгновенно, офлайн — очередь при входе).
	s.Hub.SendToUser(req.UserID, hub.NewEvent("invite.new", data))
	// Пуш, если приложение закрыто.
	s.pushNotify(req.UserID, "📨 Приглашение в канал",
		"Вас пригласили в канал «"+s.channelName(channelID)+"»", "invite")
	writeJSON(w, http.StatusCreated, inv)
}

func (s *Server) channelName(channelID int64) string {
	if c, err := s.Store.GetChannel(channelID); err == nil {
		return c.Name
	}
	return ""
}

func (s *Server) handleListMyInvites(w http.ResponseWriter, r *http.Request) {
	invites, err := s.Store.PendingInvitesForUser(userIDFrom(r))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(invites))
	for _, inv := range invites {
		out = append(out, map[string]interface{}{
			"id":           inv.ID,
			"channel_id":   inv.ChannelID,
			"channel_name": s.channelName(inv.ChannelID),
			"invited_by":   inv.InvitedBy,
			"invited_by_nick": s.nickOf(inv.InvitedBy),
			"created_at":   inv.CreatedAt,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) nickOf(userID int64) string {
	if u, err := s.Store.GetUserByID(userID); err == nil {
		return u.Nick
	}
	return ""
}

func (s *Server) respondInvite(w http.ResponseWriter, r *http.Request, status string) {
	inv, err := s.Store.GetInvite(pathID(r, "id"))
	if err != nil {
		writeErr(w, http.StatusNotFound, "приглашение не найдено")
		return
	}
	if inv.UserID != userIDFrom(r) {
		writeErr(w, http.StatusForbidden, "это не ваше приглашение")
		return
	}
	if inv.Status != models.InvitePending {
		writeErr(w, http.StatusConflict, "приглашение уже обработано")
		return
	}
	if err := s.Store.RespondInvite(inv.ID, status); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if status == models.InviteAccepted {
		if err := s.Store.AddMember(inv.ChannelID, inv.UserID, models.RoleUser); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		// Участники с ключом канала обернут его для нового участника.
		s.broadcastKeyNeeded(inv.ChannelID, inv.UserID)
	}
	s.Hub.SendToChannel(inv.ChannelID, hub.NewEvent("invite.updated", map[string]interface{}{"invite": inv}))
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleAcceptInvite(w http.ResponseWriter, r *http.Request) {
	s.respondInvite(w, r, models.InviteAccepted)
}

func (s *Server) handleDeclineInvite(w http.ResponseWriter, r *http.Request) {
	s.respondInvite(w, r, models.InviteDeclined)
}

// ---------- Участники ----------

func (s *Server) handleListMembers(w http.ResponseWriter, r *http.Request) {
	channelID := pathID(r, "id")
	if _, ok := s.requireChannelMember(w, r, channelID); !ok {
		return
	}
	members, err := s.Store.ListMembers(channelID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(members))
	for _, m := range members {
		nick := s.nickOf(m.UserID)
		isAdmin := false
		if u, err := s.Store.GetUserByID(m.UserID); err == nil {
			isAdmin = u.IsServerAdmin
		}
		out = append(out, map[string]interface{}{
			"user_id":        m.UserID,
			"nick":           nick,
			"role":           m.Role,
			"is_server_admin": isAdmin,
			"online":         s.Hub.IsOnline(m.UserID),
			"joined_at":      m.JoinedAt,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

// handleListBannedMembers — забаненные участники канала (для разбана).
func (s *Server) handleListBannedMembers(w http.ResponseWriter, r *http.Request) {
	channelID := pathID(r, "id")
	if _, ok := s.requireChannelMember(w, r, channelID); !ok {
		return
	}
	members, err := s.Store.ListBannedMembers(channelID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(members))
	for _, m := range members {
		out = append(out, map[string]interface{}{
			"user_id":    m.UserID,
			"nick":       s.nickOf(m.UserID),
			"ban_reason": m.BanReason,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleSetMemberRole(w http.ResponseWriter, r *http.Request) {
	channelID := pathID(r, "id")
	targetID := pathID(r, "uid")
	u, _ := s.Store.GetUserByID(userIDFrom(r))
	if !u.IsServerAdmin {
		role, ok := s.requireChannelMember(w, r, channelID)
		if !ok {
			return
		}
		if !s.can(w, role, channelID, models.PermManageMembers) {
			return
		}
	}
	var req struct {
		Role models.Role `json:"role"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "некорректный запрос")
		return
	}
	switch req.Role {
	case models.RoleUser, models.RoleChannelModerator, models.RoleChannelAdmin:
	default:
		writeErr(w, http.StatusBadRequest, "недопустимая роль")
		return
	}
	target, err := s.Store.GetUserByID(targetID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "пользователь не найден")
		return
	}
	if target.IsServerAdmin {
		writeErr(w, http.StatusForbidden, "нельзя изменить роль админа сервера")
		return
	}
	if _, err := s.Store.GetMember(channelID, targetID); err != nil {
		writeErr(w, http.StatusNotFound, "участник не найден")
		return
	}
	// Снять права админа канала может только админ сервера.
	if req.Role != models.RoleChannelAdmin {
		if m, _ := s.Store.GetMember(channelID, targetID); m.Role == models.RoleChannelAdmin && !u.IsServerAdmin {
			writeErr(w, http.StatusForbidden, "снять права админа канала может только админ сервера")
			return
		}
	}
	if err := s.Store.SetRole(channelID, targetID, req.Role); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Если админа канала разжаловали и нового не назначили — канал удаляется.
	if req.Role != models.RoleChannelAdmin {
		if !s.Store.HasChannelAdmin(channelID) {
			s.deleteChannelNoAdmin(channelID)
		}
	}
	s.Hub.SendToChannel(channelID, hub.NewEvent("role.changed", map[string]interface{}{
		"channel_id": channelID, "user_id": targetID, "role": req.Role,
	}))
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// deleteChannelNoAdmin — автоудаление канала, оставшегося без админа канала.
func (s *Server) deleteChannelNoAdmin(channelID int64) {
	s.endChannelCalls(channelID, "канал удалён")
	if err := s.Store.DeleteChannel(channelID); err != nil {
		return
	}
	s.Hub.SendToChannel(channelID, hub.NewEvent("channel.deleted", map[string]int64{"channel_id": channelID}))
}

func (s *Server) handleBanMember(w http.ResponseWriter, r *http.Request) {
	channelID := pathID(r, "id")
	targetID := pathID(r, "uid")
	u, _ := s.Store.GetUserByID(userIDFrom(r))
	if !u.IsServerAdmin {
		role, ok := s.requireChannelMember(w, r, channelID)
		if !ok {
			return
		}
		if !s.can(w, role, channelID, models.PermBan) {
			return
		}
	}
	target, err := s.Store.GetUserByID(targetID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "пользователь не найден")
		return
	}
	if target.IsServerAdmin {
		writeErr(w, http.StatusForbidden, "нельзя забанить админа сервера")
		return
	}
	var req banReq
	_ = readJSON(r, &req)
	if err := s.Store.SetBanned(channelID, targetID, req.Reason); err != nil {
		writeErr(w, http.StatusNotFound, "участник не найден")
		return
	}
	// Бан разрывает подключение к каналу.
	s.Hub.SendToUser(targetID, hub.NewEvent("banned", map[string]interface{}{
		"channel_id": channelID, "reason": req.Reason,
	}))
	s.Hub.SendToChannel(channelID, hub.NewEvent("member.banned", map[string]interface{}{
		"channel_id": channelID, "user_id": targetID,
	}))
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleUnbanMember(w http.ResponseWriter, r *http.Request) {
	channelID := pathID(r, "id")
	targetID := pathID(r, "uid")
	u, _ := s.Store.GetUserByID(userIDFrom(r))
	if !u.IsServerAdmin {
		role, ok := s.requireChannelMember(w, r, channelID)
		if !ok {
			return
		}
		if !s.can(w, role, channelID, models.PermBan) {
			return
		}
	}
	if err := s.Store.Unban(channelID, targetID); err != nil {
		writeErr(w, http.StatusNotFound, "участник не найден")
		return
	}
	s.Hub.SendToChannel(channelID, hub.NewEvent("member.unbanned", map[string]interface{}{
		"channel_id": channelID, "user_id": targetID,
	}))
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleKickMember(w http.ResponseWriter, r *http.Request) {
	channelID := pathID(r, "id")
	targetID := pathID(r, "uid")
	u, _ := s.Store.GetUserByID(userIDFrom(r))
	if !u.IsServerAdmin {
		role, ok := s.requireChannelMember(w, r, channelID)
		if !ok {
			return
		}
		if !s.can(w, role, channelID, models.PermKick) {
			return
		}
	}
	target, err := s.Store.GetUserByID(targetID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "пользователь не найден")
		return
	}
	if target.IsServerAdmin {
		writeErr(w, http.StatusForbidden, "нельзя кикнуть админа сервера")
		return
	}
	if _, err := s.Store.GetMember(channelID, targetID); err != nil {
		writeErr(w, http.StatusNotFound, "участник не найден")
		return
	}
	var req banReq
	_ = readJSON(r, &req)
	// Кик выкидывает из канала; сразу после кика можно вернуться.
	s.Hub.SendToUser(targetID, hub.NewEvent("kicked", map[string]interface{}{
		"channel_id": channelID, "reason": req.Reason,
	}))
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ---------- Права групп ----------

func (s *Server) handleGetChannelPermissions(w http.ResponseWriter, r *http.Request) {
	channelID := pathID(r, "id")
	if _, ok := s.requireChannelMember(w, r, channelID); !ok {
		return
	}
	perms, err := s.Store.ChannelPermissions(channelID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, perms)
}

func (s *Server) handleSetChannelPermission(w http.ResponseWriter, r *http.Request) {
	channelID := pathID(r, "id")
	u, _ := s.Store.GetUserByID(userIDFrom(r))
	if !u.IsServerAdmin {
		role, ok := s.requireChannelMember(w, r, channelID)
		if !ok {
			return
		}
		if !s.can(w, role, channelID, models.PermManageMembers) {
			return
		}
	}
	var req struct {
		Role       models.Role       `json:"role"`
		Permission models.Permission `json:"permission"`
		Allowed    bool              `json:"allowed"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "некорректный запрос")
		return
	}
	validRole := req.Role == models.RoleUser || req.Role == models.RoleChannelModerator || req.Role == models.RoleChannelAdmin
	if !validRole {
		writeErr(w, http.StatusBadRequest, "недопустимая роль")
		return
	}
	validPerm := false
	for _, p := range models.AllPermissions {
		if p == req.Permission {
			validPerm = true
			break
		}
	}
	if !validPerm {
		writeErr(w, http.StatusBadRequest, "недопустимое право")
		return
	}
	if err := s.Store.SetRolePermission(channelID, req.Role, req.Permission, req.Allowed); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ---------- Ключи каналов ----------

func (s *Server) handleUploadWrappedKey(w http.ResponseWriter, r *http.Request) {
	channelID := pathID(r, "id")
	if _, ok := s.requireChannelMember(w, r, channelID); !ok {
		return
	}
	var req struct {
		UserID      int64  `json:"user_id"`
		DeviceID    string `json:"device_id"`
		WrappedKey  []byte `json:"wrapped_key"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "некорректный запрос")
		return
	}
	// Цель должна быть участником канала, а обёрнутый ключ загружает участник.
	target, err := s.Store.GetDevice(req.UserID, req.DeviceID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "устройство цели не найдено")
		return
	}
	_ = target
	if !s.Store.IsMember(channelID, req.UserID) {
		writeErr(w, http.StatusBadRequest, "цель не является участником канала")
		return
	}
	if len(req.WrappedKey) == 0 {
		writeErr(w, http.StatusBadRequest, "wrapped_key не может быть пустым")
		return
	}
	if err := s.Store.UpsertChannelKey(channelID, req.UserID, req.DeviceID, req.WrappedKey); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Уведомляем цель о выдаче ключа.
	s.Hub.SendToUser(req.UserID, hub.NewEvent("key.granted", map[string]int64{"channel_id": channelID}))
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleGetMyWrappedKey(w http.ResponseWriter, r *http.Request) {
	channelID := pathID(r, "id")
	if _, ok := s.requireChannelMember(w, r, channelID); !ok {
		return
	}
	deviceID := r.URL.Query().Get("device_id")
	if deviceID == "" {
		writeErr(w, http.StatusBadRequest, "device_id обязателен")
		return
	}
	wrapped, err := s.Store.GetChannelKey(channelID, userIDFrom(r), deviceID)
	if err == store.ErrNotFound {
		writeJSON(w, http.StatusOK, map[string]interface{}{"wrapped_key": nil})
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"wrapped_key": wrapped})
}

func (s *Server) handlePendingKeyTargets(w http.ResponseWriter, r *http.Request) {
	channelID := pathID(r, "id")
	if _, ok := s.requireChannelMember(w, r, channelID); !ok {
		return
	}
	targets, err := s.Store.PendingKeyTargets(channelID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(targets))
	for _, d := range targets {
		out = append(out, map[string]interface{}{
			"user_id":    d.UserID,
			"device_id":  d.DeviceID,
			"public_key": d.PublicKey,
		})
	}
	writeJSON(w, http.StatusOK, out)
}
