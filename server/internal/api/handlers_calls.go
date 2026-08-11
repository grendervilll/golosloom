package api

import (
	"fmt"
	"net/http"
	"strings"
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
	// Занятые пользователи: уже разговаривают в другом звонке или
	// ждут ответа на другое приглашение.
	var busy []string
	for _, targetID := range req.TargetIDs {
		if targetID == userIDFrom(r) {
			continue
		}
		inCall, err1 := s.Store.ActiveCallForUser(targetID)
		ringing, err2 := s.Store.HasActiveRingingInvite(targetID)
		if err1 == nil && inCall != nil {
			busy = append(busy, s.nickOf(targetID))
		} else if err2 == nil && ringing {
			busy = append(busy, s.nickOf(targetID))
		}
	}
	if len(busy) > 0 {
		writeErr(w, http.StatusConflict,
			"этот пользователь уже с кем-то разговаривает: "+strings.Join(busy, ", "))
		return
	}
	// Двойной вызов не допускается: у инициатора не может быть двух активных
	// звонков в одном канале одновременно. Звонок-«зомби» (все вышли, но
	// соединения оборвались) завершаем автоматически.
	if n, err := s.Store.CountCallsByInitiator(channelID, userIDFrom(r)); err == nil && n > 0 {
		blocked := false
		if calls, err := s.Store.ActiveCallsByInitiator(channelID, userIDFrom(r)); err == nil {
			for _, c := range calls {
				count, _ := s.Store.CallParticipantCount(c.ID)
				ringing, _ := s.Store.RingingInvites(c.ID)
				if count > 1 || len(ringing) > 0 || c.Status == models.CallRinging {
					blocked = true
				} else {
					s.finishCall(c, "звонок завершён (все участники вышли)")
				}
			}
		}
		if blocked {
			writeErr(w, http.StatusConflict, "у вас уже есть активный звонок в этом канале")
			return
		}
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
	// Пользователь может быть только в одном активном звонке.
	s.leaveOtherCalls(call.ID, userIDFrom(r))
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
		// Пуш, если приложение закрыто: телефон должен узнать о звонке.
		s.pushNotify(targetID, "📞 Входящий звонок",
			callerNick+" звонит в канале «"+s.channelName(channelID)+"»", "call")
		invited++
	}

	if invited == 0 {
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
		"token": s.livekitToken(call, userIDFrom(r), deviceIDFromRequest(r)),
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
	// Если в звонке остался один участник (или никого) и никто больше
	// не звонит — звонок завершается.
	s.maybeFinishSoloCall(call)
}

// maybeFinishSoloCall завершает активный звонок, в котором не осталось
// собеседников: меньше двух участников и никто не ждёт ответа на приглашение.
// Звонок в статусе "ringing" (ещё никто не ответил) остаётся жить —
// приглашённые могут войти позже через «Войти в звонок».
func (s *Server) maybeFinishSoloCall(call *models.Call) {
	if call.Status == models.CallEnded {
		return
	}
	count, _ := s.Store.CallParticipantCount(call.ID)
	if count == 0 {
		s.finishCall(*call, "в звонке не осталось участников")
		return
	}
	if count == 1 {
		ringing, _ := s.Store.RingingInvites(call.ID)
		if len(ringing) > 0 || call.Status == models.CallRinging {
			return // ждём ответа на приглашение или выхода инициатора
		}
		s.finishCall(*call, "в звонке остался один участник")
	}
}

func (s *Server) livekitToken(call *models.Call, userID int64, deviceID string) string {
	token, err := livekit.Token(
		s.Cfg.LiveKitAPIKey, s.Cfg.LiveKitAPISecret,
		callIdentity(userID, deviceID), s.nickOf(userID), s.callRoom(call.ID), time.Hour,
	)
	if err != nil {
		return ""
	}
	return token
}

// callIdentity — identity участника в комнате LiveKit. Обязательно уникален
// на устройство: два устройства одного пользователя не должны конфликтовать
// (иначе LiveKit выкидывает второе как DUPLICATE_IDENTITY).
func callIdentity(userID int64, deviceID string) string {
	if deviceID == "" {
		deviceID = "dev"
	}
	return fmt.Sprintf("%d:%s", userID, deviceID)
}

func (s *Server) callRoom(callID int64) string { return "call-" + itoa(callID) }

// deviceIDFromRequest достаёт device_id из тела запроса (может отсутствовать).
func deviceIDFromRequest(r *http.Request) string {
	var req struct {
		DeviceID string `json:"device_id"`
	}
	_ = readJSON(r, &req)
	return req.DeviceID
}

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
	s.leaveOtherCalls(callID, userIDFrom(r))
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
		"token": s.livekitToken(call, userIDFrom(r), deviceIDFromRequest(r)),
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
	// Если в звонке остался один участник и больше никто не звонит —
	// звонок бессмыслен, завершаем его (иначе инициатор сидел бы в
	// одиночестве в вечно «активном» звонке).
	s.maybeFinishSoloCall(call)
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
	s.leaveOtherCalls(callID, userIDFrom(r))
	if call.Status == models.CallRinging {
		_ = s.Store.UpdateCallStatus(callID, models.CallActive)
		s.Hub.SendToChannel(call.ChannelID, hub.NewEvent("call.started", map[string]int64{"call_id": callID}))
	}
	s.broadcastParticipants(callID)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"call":  call,
		"token": s.livekitToken(call, userIDFrom(r), deviceIDFromRequest(r)),
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
	s.maybeFinishSoloCall(call)
	if c2, err := s.Store.GetCall(callID); err == nil && c2.Status != models.CallEnded {
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

// leaveOtherCalls — пользователь может быть только в одном активном звонке:
// входя в новый, он выходит из остальных (чинит «зомби» от оборванных
// соединений, из-за которых звонок никогда не завершался).
func (s *Server) leaveOtherCalls(callID, userID int64) {
	call, err := s.Store.ActiveCallForUser(userID)
	if err != nil || call == nil || call.ID == callID {
		return
	}
	_ = s.Store.RemoveCallParticipant(call.ID, userID)
	s.maybeFinishSoloCall(call)
	if c2, err := s.Store.GetCall(call.ID); err == nil && c2.Status != models.CallEnded {
		s.broadcastParticipants(call.ID)
	}
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
