package api

import (
	"errors"
	"net/http"
	"os"
	"strconv"

	"golosloom/server/internal/hub"
	"golosloom/server/internal/models"
)

func (s *Server) handleListMessages(w http.ResponseWriter, r *http.Request) {
	channelID := pathID(r, "id")
	role, ok := s.requireChannelMember(w, r, channelID)
	if !ok {
		return
	}
	beforeID, _ := parseQueryInt64(r, "before")
	limit := 50
	if v, err := parseQueryInt(r, "limit"); err == nil && v > 0 && v <= 200 {
		limit = v
	}
	msgs, err := s.Store.ListMessages(channelID, beforeID, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	canSeeOriginals := s.hasViewOriginals(role, channelID)
	out := make([]map[string]interface{}, 0, len(msgs))
	for _, m := range msgs {
		if m.Deleted && !canSeeOriginals {
			// Обычные пользователи не видят удалённые сообщения вовсе;
			// модераторы и админы видят их с оригинальным текстом.
			continue
		}
		out = append(out, s.messageJSON(m, canSeeOriginals))
	}
	writeJSON(w, http.StatusOK, out)
}

// hasViewOriginals — право видеть оригиналы удалённых/изменённых сообщений
// (модератор, админ канала, админ сервера).
func (s *Server) hasViewOriginals(role models.Role, channelID int64) bool {
	if role == models.RoleServerAdmin || role == models.RoleChannelAdmin || role == models.RoleChannelModerator {
		return true
	}
	return false
}

func (s *Server) messageJSON(m models.Message, withHistory bool) map[string]interface{} {
	out := map[string]interface{}{
		"id":         m.ID,
		"channel_id": m.ChannelID,
		"sender_id":  m.SenderID,
		"sender_nick": s.nickOf(m.SenderID),
		"ciphertext": m.Ciphertext,
		"iv":         m.IV,
		"created_at": m.CreatedAt,
		"deleted":    m.Deleted,
	}
	if m.EditedAt != nil {
		out["edited_at"] = m.EditedAt
	}
	if m.DeletedBy != nil {
		out["deleted_by"] = *m.DeletedBy
	}
	if withHistory && len(m.History) > 0 {
		out["history"] = m.History
	}
	if m.Attachment != nil {
		out["attachment"] = m.Attachment
	}
	if m.ReplyTo != nil {
		out["reply_to"] = *m.ReplyTo
	}
	return out
}

func (s *Server) handleSendMessage(w http.ResponseWriter, r *http.Request) {
	channelID := pathID(r, "id")
	role, ok := s.requireChannelMember(w, r, channelID)
	if !ok {
		return
	}
	if !s.can(w, role, channelID, models.PermSendMessage) {
		return
	}
	if !s.allowMessageRate(userIDFrom(r)) {
		writeErr(w, http.StatusTooManyRequests, "слишком много сообщений, подождите")
		return
	}
	var req struct {
		Ciphertext   []byte `json:"ciphertext"`
		IV           []byte `json:"iv"`
		AttachmentID int64  `json:"attachment_id"`
		ReplyToID    int64  `json:"reply_to_id"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "некорректный запрос")
		return
	}
	if len(req.Ciphertext) == 0 || len(req.IV) == 0 {
		writeErr(w, http.StatusBadRequest, "пустое сообщение")
		return
	}
	if len(req.Ciphertext) > s.Cfg.MaxMessageLen+16 {
		writeErr(w, http.StatusBadRequest, "сообщение слишком длинное")
		return
	}
	// Ответ на сообщение: оно должно существовать в этом же канале.
	if req.ReplyToID != 0 {
		replied, err := s.Store.GetMessage(req.ReplyToID)
		if err != nil || replied.ChannelID != channelID {
			writeErr(w, http.StatusNotFound, "сообщение для ответа не найдено")
			return
		}
	}
	// Вложение: файл должен существовать, принадлежать отправителю и каналу,
	// и ещё не быть привязанным к сообщению.
	if req.AttachmentID != 0 {
		f, err := s.Store.GetFile(req.AttachmentID)
		if err != nil {
			writeErr(w, http.StatusNotFound, "файл не найден")
			return
		}
		if f.UserID != userIDFrom(r) || f.ChannelID != channelID || f.MessageID != 0 {
			writeErr(w, http.StatusForbidden, "файл нельзя прикрепить к этому сообщению")
			return
		}
	}
	if s.isDuplicateMessage(channelID, userIDFrom(r), req.Ciphertext, req.IV) {
		writeErr(w, http.StatusConflict, "сообщение уже отправлено")
		return
	}
	m, err := s.Store.CreateMessage(channelID, userIDFrom(r), req.Ciphertext, req.IV, req.ReplyToID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if req.AttachmentID != 0 {
		if err := s.Store.AttachFileToMessage(req.AttachmentID, m.ID); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		// Перечитываем сообщение, чтобы в ответе был attachment.
		m, _ = s.Store.GetMessage(m.ID)
	}
	s.Hub.SendToChannel(channelID, hub.NewEvent("message.new", s.messageJSON(*m, true)))
	// Пуши офлайн-участникам канала — в фоне, не задерживаем ответ отправителю.
	go s.pushChannelMessage(channelID, userIDFrom(r))
	writeJSON(w, http.StatusCreated, s.messageJSON(*m, false))
}

func (s *Server) handleEditMessage(w http.ResponseWriter, r *http.Request) {
	channelID := pathID(r, "id")
	mid := pathID(r, "mid")
	role, ok := s.requireChannelMember(w, r, channelID)
	if !ok {
		return
	}
	if !s.can(w, role, channelID, models.PermSendMessage) {
		return
	}
	m, err := s.Store.GetMessage(mid)
	if err != nil {
		writeErr(w, http.StatusNotFound, "сообщение не найдено")
		return
	}
	if m.ChannelID != channelID {
		writeErr(w, http.StatusNotFound, "сообщение не найдено")
		return
	}
	if m.SenderID != userIDFrom(r) {
		writeErr(w, http.StatusForbidden, "можно редактировать только свои сообщения")
		return
	}
	var req struct {
		Ciphertext []byte `json:"ciphertext"`
		IV         []byte `json:"iv"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "некорректный запрос")
		return
	}
	edited, err := s.Store.EditMessage(mid, req.Ciphertext, req.IV)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.Hub.SendToChannel(channelID, hub.NewEvent("message.edited", s.messageJSON(*edited, true)))
	writeJSON(w, http.StatusOK, s.messageJSON(*edited, false))
}

func (s *Server) handleDeleteMessage(w http.ResponseWriter, r *http.Request) {
	channelID := pathID(r, "id")
	mid := pathID(r, "mid")
	role, ok := s.requireChannelMember(w, r, channelID)
	if !ok {
		return
	}
	m, err := s.Store.GetMessage(mid)
	if err != nil {
		writeErr(w, http.StatusNotFound, "сообщение не найдено")
		return
	}
	if m.ChannelID != channelID {
		writeErr(w, http.StatusNotFound, "сообщение не найдено")
		return
	}
	// С админом сервера нельзя ничего сделать: другие пользователи не могут
	// удалить его сообщения (сам админ свои сообщения удаляет свободно).
	if m.SenderID != userIDFrom(r) {
		if sender, err := s.Store.GetUserByID(m.SenderID); err == nil && sender.IsServerAdmin {
			writeErr(w, http.StatusForbidden, "нельзя удалить сообщение админа сервера")
			return
		}
	}
	if m.SenderID != userIDFrom(r) && !s.hasViewOriginals(role, channelID) {
		writeErr(w, http.StatusForbidden, "недостаточно прав")
		return
	}
	if m.SenderID != userIDFrom(r) && !s.can(w, role, channelID, models.PermDeleteMessage) {
		return
	}
	if err := s.Store.SetMessageDeleted(mid, userIDFrom(r)); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Файл сообщения удаляется с диска вместе с сообщением.
	s.deleteMessageFiles(mid)
	s.Hub.SendToChannel(channelID, hub.NewEvent("message.deleted", map[string]interface{}{
		"channel_id": channelID, "message_id": mid, "deleted_by": userIDFrom(r),
	}))
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// deleteMessageFiles удаляет файлы сообщения: записи в БД + файлы с диска.
func (s *Server) deleteMessageFiles(messageID int64) {
	files, err := s.Store.FilesByMessage(messageID)
	if err != nil {
		return
	}
	ids := make([]int64, 0, len(files))
	for _, f := range files {
		ids = append(ids, f.ID)
		_ = os.Remove(f.Path)
	}
	_ = s.Store.DeleteFiles(ids)
}

// deleteChannelFiles удаляет все файлы канала (записи + диск).
func (s *Server) deleteChannelFiles(channelID int64) {
	files, err := s.Store.ChannelFiles(channelID)
	if err != nil {
		return
	}
	ids := make([]int64, 0, len(files))
	for _, f := range files {
		ids = append(ids, f.ID)
		_ = os.Remove(f.Path)
	}
	_ = s.Store.DeleteFiles(ids)
}

func parseQueryInt64(r *http.Request, name string) (int64, error) {
	v := r.URL.Query().Get(name)
	if v == "" {
		return 0, errors.New("empty")
	}
	return strconv.ParseInt(v, 10, 64)
}

func parseQueryInt(r *http.Request, name string) (int, error) {
	v := r.URL.Query().Get(name)
	if v == "" {
		return 0, errors.New("empty")
	}
	return strconv.Atoi(v)
}
