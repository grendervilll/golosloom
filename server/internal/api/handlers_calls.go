package api

import (
	"net/http"
	"time"

	"golosloom/server/internal/hub"
	"golosloom/server/internal/livekit"
	"golosloom/server/internal/models"
)

type createCallReq struct {
	ChannelID int64   `json:"channel_id"`
	TargetIDs []int64 `json:"target_ids"`
}

// handleCreateCall — инициация звонка одному, нескольким или всем пользователям канала.
func (s *Server) handleCreateCall(w http.ResponseWriter, r *http.Request) {
	var req createCallReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "некорректный запрос")
		return
	}
	channelID := req.ChannelID
	u, err := s.Store.GetUserByID(userIDFrom(r))
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "пользователь не найден")
		return
	}
	if !u.IsServerAdmin {
		role, ok := s.requireChannelMember(w, r, channelID)
		if !ok {
			return
		}
		_ = role
	}
	if len(req.TargetIDs) == 0 {
		writeErr(w, http.StatusBadRequest, "выберите хотя бы одного пользователя")
		return
	}
	// Двойной вызов не допускается: у инициатора не может быть двух активных
	// звонков в одном канале одновременно.
	n, err := s.Store.CountCallsByInitiator(channelID, userIDFrom(r))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if n > 0 {
		writeErr(w, http.StatusConflict, "у вас уже есть активный звонок в этом канале")
		return
	}

	call, err := s.Store.CreateCall(channelID, userIDFrom(r))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Инициатор сразу является участником (слышит звук дозвона).
	if err := s.Store.AddCallParticipant(call.ID, userIDFrom(r)); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	callerNick := s.nickOf(userIDFrom(r))

	invited := 0
	for _, targetID := range req.TargetIDs {
		if targetID == userIDFrom(r) {
			continue
		}
		if !s.Store.IsMember(channelID, targetID) {
			continue
		}
		// Если человек уже приглашён в другой звонок этого канала —
		// не дублируем приглашение.
		has, err := s.Store.HasRingingCallWithUser(channelID, targetID)
		if err != nil || has {
			continue
		}
		// Если человек уже разговаривает в другом звонке — приглашение всё
		// равно уходит (он увидит оповещение), но не выдёргиваем его.
		if err := s.Store.CreateCallInvite(call.ID, targetID); err != nil {
			continue
		}
		s.Hub.SendToUser(targetID, hub.NewEvent("call.invite", map[string]interface{}{
			"call_id":      call.ID,
			"channel_id":   channelID,
			"initiator_id": userIDFrom(r),
			"initiator_nick": callerNick,
		}))
		invited++
	}

	if invited == 0 && len(req.TargetIDs) > 0 {
		// Некому звонить — отменяем звонок.
		s.finishCall(*call, "нет доступных получателей")
		writeErr(w, http.StatusBadRequest, "нет доступных получателей вызова")
		return
	}

	// Таймер автоотклонения: через 20 секунд звонок для непринявших отклоняется.
	go s.autoDeclineRinging(call.ID)

	// Оповещаем канал о новом звонке (для кнопки "Войти в звонок").
	s.Hub.SendToChannel(channelID, hub.NewEvent("call.created", map[string]interface{}{
		"call":       call,
		"caller_nick": callerNick,
	}))
	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"call": call,
		"token": s.livekitToken(call, userIDFrom(r)),
	})
}

// autoDeclineRinging — через 20 секунд отклоняет звонки, которые не приняли.
func (s *Server) autoDeclineRinging(callID int64) {
	call, err := s.Store.GetCall(callID)
	if err != nil {
		return
	}
	time.Sleep(s.Cfg.RingTimeout)
	call, err = s.Store.GetCall(callID)
	if err != nil || call.Status == models.CallEnded {
		return
	}
	ringing, err := s.Store.RingingInvites(callID)
	if err != nil {
		return
	}
	changed := false
	for _, inv := range ringing {
		if err := s.Store.UpdateCallInviteStatus(callID, inv.UserID, models.CallInviteAutoDeclined); err == nil {
			changed = true
			s.Hub.SendToUser(inv.UserID, hub.NewEvent("call.invite.timeout", map[string]int64{"call_id": callID}))
		}
	}
	if !changed {
		return
	}
	// Если в звонке никого не осталось — он завершается.
	count, _ := s.Store.CallParticipantCount(callID)
	ringingAfter, _ := s.Store.RingingInvites(callID)
	if count == 0 && len(ringingAfter) == 0 {
		s.finishCall(*call, "никого не осталось")
	}
}

func (s *Server) livekitToken(call *models.Call, userID int64) string {
	token, err := livekit.Token(
		s.Cfg.LiveKitAPIKey, s.Cfg.LiveKitAPISecret,
		callIdentity(userID), s.callRoom(call.ID), time.Hour,
	)
	if err != nil {
		return ""
	}
	return token
}

func callIdentity(userID int64) string  { return itoa(userID) }
func (s *Server) callRoom(callID int64) string { return "call-" + itoa(callID) }

func (s *Server) handleListCalls(w http.ResponseWriter, r *http.Request) {
	channelID := pathID(r, "id")
	if _, ok := s.requireChannelMember(w, r, channelID); !ok {
		return
	}
	calls, err := s.Store.CallsVisibleToUser(channelID, userIDFrom(r))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(calls))
	for _, c := range calls {
		participants, _ := s.Store.CallParticipantIDs(c.ID)
		out = append(out, map[string]interface{}{
			"id":           c.ID,
			"channel_id":   c.ChannelID,
			"initiator_id": c.InitiatorID,
			"status":       c.Status,
			"created_at":   c.CreatedAt,
			"participants": participants,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleAcceptCall(w http.ResponseWriter, r *http.Request) {
	callID := pathID(r, "id")
	call, err := s.Store.GetCall(callID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "звонок не найден")
		return
	}
	if call.Status == models.CallEnded {
		writeErr(w, http.StatusGone, "звонок завершён")
		return
	}
	u, _ := s.Store.GetUserByID(userIDFrom(r))
	if !u.IsServerAdmin {
		inv, err := s.Store.GetCallInvite(callID, userIDFrom(r))
		if err != nil {
			writeErr(w, http.StatusForbidden, "вы не приглашены в этот звонок")
			return
		}
		if inv.Status != models.CallInviteRinging {
			writeErr(w, http.StatusConflict, "приглашение уже обработано")
			return
		}
	}
	if err := s.Store.UpdateCallInviteStatus(callID, userIDFrom(r), models.CallInviteAccepted); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := s.Store.AddCallParticipant(callID, userIDFrom(r)); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	firstAccept := call.Status == models.CallRinging
	if firstAccept {
		if err := s.Store.UpdateCallStatus(callID, models.CallActive); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		// Звук дозвона у звонящего прекращается.
		s.Hub.SendToChannel(call.ChannelID, hub.NewEvent("call.started", map[string]int64{"call_id": callID}))
	}
	s.broadcastParticipants(callID)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"call":  call,
		"token": s.livekitToken(call, userIDFrom(r)),
	})
}

func (s *Server) handleDeclineCall(w http.ResponseWriter, r *http.Request) {
	callID := pathID(r, "id")
	call, err := s.Store.GetCall(callID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "звонок не найден")
		return
	}
	inv, err := s.Store.GetCallInvite(callID, userIDFrom(r))
	if err != nil {
		writeErr(w, http.StatusForbidden, "вы не приглашены в этот звонок")
		return
	}
	if inv.Status != models.CallInviteRinging {
		writeErr(w, http.StatusConflict, "приглашение уже обработано")
		return
	}
	if err := s.Store.UpdateCallInviteStatus(callID, userIDFrom(r), models.CallInviteDeclined); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.Hub.SendToUser(call.InitiatorID, hub.NewEvent("call.declined", map[string]interface{}{
		"call_id": callID, "user_id": userIDFrom(r),
	}))
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleJoinCall — "Войти в звонок" (после отклонения или позже).
func (s *Server) handleJoinCall(w http.ResponseWriter, r *http.Request) {
	callID := pathID(r, "id")
	call, err := s.Store.GetCall(callID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "звонок не найден")
		return
	}
	if call.Status == models.CallEnded {
		writeErr(w, http.StatusGone, "звонок завершён")
		return
	}
	u, _ := s.Store.GetUserByID(userIDFrom(r))
	if !u.IsServerAdmin {
		inv, err := s.Store.GetCallInvite(callID, userIDFrom(r))
		if err != nil {
			writeErr(w, http.StatusForbidden, "в звонок могут войти только приглашённые")
			return
		}
		_ = inv
	}
	count, err := s.Store.CallParticipantCount(callID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if count == 0 {
		// В звонке никого нет — ошибка, звонок исчезает.
		s.finishCall(*call, "звонок пуст")
		writeErr(w, http.StatusGone, "в звонке никого нет, звонок завершён")
		return
	}
	if err := s.Store.AddCallParticipant(callID, userIDFrom(r)); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if call.Status == models.CallRinging {
		_ = s.Store.UpdateCallStatus(callID, models.CallActive)
		s.Hub.SendToChannel(call.ChannelID, hub.NewEvent("call.started", map[string]int64{"call_id": callID}))
	}
	s.broadcastParticipants(callID)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"call":  call,
		"token": s.livekitToken(call, userIDFrom(r)),
	})
}

func (s *Server) handleLeaveCall(w http.ResponseWriter, r *http.Request) {
	callID := pathID(r, "id")
	call, err := s.Store.GetCall(callID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "звонок не найден")
		return
	}
	if err := s.Store.RemoveCallParticipant(callID, userIDFrom(r)); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	count, _ := s.Store.CallParticipantCount(callID)
	if count == 0 {
		// Звонок полностью завершается, если в нём никого не осталось.
		s.finishCall(*call, "все покинули звонок")
	} else {
		s.broadcastParticipants(callID)
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) broadcastParticipants(callID int64) {
	call, err := s.Store.GetCall(callID)
	if err != nil {
		return
	}
	participants, _ := s.Store.CallParticipantIDs(callID)
	s.Hub.SendToChannel(call.ChannelID, hub.NewEvent("call.participants", map[string]interface{}{
		"call_id": callID, "participants": participants,
	}))
}

func (s *Server) finishCall(call models.Call, reason string) {
	if call.Status == models.CallEnded {
		return
	}
	_ = s.Store.EndCall(call.ID)
	s.Hub.SendToChannel(call.ChannelID, hub.NewEvent("call.ended", map[string]interface{}{
		"call_id": call.ID, "reason": reason,
	}))
}

func itoa(v int64) string {
	if v == 0 {
		return "0"
	}
	neg := v < 0
	if neg {
		v = -v
	}
	var b [20]byte
	i := len(b)
	for v > 0 {
		i--
		b[i] = byte('0' + v%10)
		v /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}
