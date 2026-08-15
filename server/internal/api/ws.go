package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gorilla/websocket"

	"golosloom/server/internal/auth"
	"golosloom/server/internal/hub"
	"golosloom/server/internal/models"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

type wsMsg struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data,omitempty"`
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	userID, ver, err := auth.ParseToken(token, s.Cfg.JWTSecret)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "требуется авторизация")
		return
	}
	u, err := s.Store.GetUserByID(userID)
	// Смена пароля инвалидирует старые токены (версия не совпала).
	if err != nil || u.TokenVersion != ver {
		writeErr(w, http.StatusUnauthorized, "требуется авторизация")
		return
	}
	if u.ServerBanned {
		writeErr(w, http.StatusForbidden, "доступ запрещён")
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	channels, _ := s.Store.MemberChannelIDs(userID)
	client := hub.NewClient(conn, userID, u.Nick)
	s.Hub.Add(client, channels)

	// Оповещаем о появлении в сети участников каналов, где состоит пользователь.
	for _, chID := range channels {
		s.Hub.SendToChannel(chID, hub.NewEvent("presence", map[string]interface{}{
			"user_id": userID, "online": true, "nick": u.Nick,
		}))
	}
	// Присылаем список ожидающих приглашений при входе.
	pending, _ := s.Store.PendingInvitesForUser(userID)
	for _, inv := range pending {
		s.Hub.SendToUser(userID, hub.NewEvent("invite.pending", map[string]interface{}{
			"invite": inv, "channel_name": s.channelName(inv.ChannelID),
		}))
	}

	go s.writePump(client)
	s.readPump(client, u.Nick)
}

func (s *Server) readPump(c *hub.Client, nick string) {
	defer func() {
		s.Hub.Remove(c)
		_ = c.Conn.Close()
		for _, chID := range c.Channels() {
			s.Hub.SendToChannel(chID, hub.NewEvent("presence", map[string]interface{}{
				"user_id": c.UserID, "online": false, "nick": nick,
			}))
		}
		// Полное отключение пользователя (закрыл браузер, пропала связь):
		// убираем его из активных звонков; звонок завершается, если в нём
		// осталось меньше двух участников — иначе он навсегда остался бы
		// «активным» и второй участник сидел бы в звонке в одиночестве.
		s.removeUserFromCalls(c.UserID)
	}()
	c.Conn.SetReadLimit(4096)
	_ = c.Conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	c.Conn.SetPongHandler(func(string) error {
		_ = c.Conn.SetReadDeadline(time.Now().Add(90 * time.Second))
		return nil
	})
	// Последний раз, когда это подключение слало «печатает…» (анти-спам).
	lastTyping := time.Time{}
	for {
		var msg wsMsg
		if err := c.Conn.ReadJSON(&msg); err != nil {
			return
		}
		switch msg.Type {
		case "ping":
			select {
			case c.Send <- []byte(`{"type":"pong"}`):
			default:
			}
		case "channel.join":
			var d struct {
				ChannelID int64 `json:"channel_id"`
			}
			if err := json.Unmarshal(msg.Data, &d); err != nil || d.ChannelID == 0 {
				continue
			}
			if s.Store.IsMember(d.ChannelID, c.UserID) {
				s.Hub.JoinChannel(c, d.ChannelID)
			}
		case "channel.leave":
			var d struct {
				ChannelID int64 `json:"channel_id"`
			}
			if err := json.Unmarshal(msg.Data, &d); err != nil {
				continue
			}
			s.Hub.LeaveChannel(c, d.ChannelID)
		case "typing":
			// Индикатор «печатает…»: рассылаем участникам канала, но не чаще
			// раза в 2 секунды с одного подключения (иначе спам по каждому
			// нажатию клавиши).
			var d struct {
				ChannelID int64 `json:"channel_id"`
			}
			if err := json.Unmarshal(msg.Data, &d); err != nil || d.ChannelID == 0 {
				continue
			}
			if time.Since(lastTyping) < 2*time.Second {
				continue
			}
			lastTyping = time.Now()
			if !s.Store.IsMember(d.ChannelID, c.UserID) {
				continue
			}
			s.Hub.SendToChannel(d.ChannelID, hub.NewEvent("typing", map[string]interface{}{
				"channel_id": d.ChannelID,
				"user_id":    c.UserID,
				"nick":       nick,
			}))
		case "call.punch":
			var d struct {
				CallID        int64 `json:"call_id"`
				TargetUserID  int64 `json:"target_user_id"`
			}
			if err := json.Unmarshal(msg.Data, &d); err != nil {
				continue
			}
			s.handlePunch(c.UserID, d.CallID, d.TargetUserID)
		}
	}
}

func (s *Server) writePump(c *hub.Client) {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		_ = c.Conn.Close()
	}()
	for {
		select {
		case msg, ok := <-c.Send:
			_ = c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				_ = c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.Conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// removeUserFromCalls убирает пользователя из всех активных звонков при
// полном отключении (закрыл вкладку, потеря связи). Звонок завершается,
// если участников осталось меньше двух, иначе участники оповещаются.
func (s *Server) removeUserFromCalls(userID int64) {
	if s.Hub.IsOnline(userID) {
		return // есть другие подключения пользователя
	}
	calls, err := s.Store.ActiveCallsForParticipant(userID)
	if err != nil {
		return
	}
	for _, call := range calls {
		_ = s.Store.RemoveCallParticipant(call.ID, userID)
		s.maybeFinishSoloCall(&call)
		if c2, err := s.Store.GetCall(call.ID); err == nil && c2.Status != models.CallEnded {
			s.broadcastParticipants(call.ID)
		}
	}
}

// handlePunch — кнопка "Пнуть" (не чаще раза в 10 секунд на пару).
func (s *Server) handlePunch(fromID, callID, targetID int64) {
	if targetID == 0 || callID == 0 {
		return
	}
	call, err := s.Store.GetCall(callID)
	if err != nil {
		return
	}
	if call.Status == models.CallEnded {
		return
	}
	// Проверяем, что оба в звонке.
	ids, _ := s.Store.CallParticipantIDs(callID)
	inCall := false
	for _, id := range ids {
		if id == fromID || id == targetID {
			inCall = true
		}
	}
	if !inCall {
		return
	}
	if !s.allowPunch(fromID, targetID) {
		return
	}
	nick := s.nickOf(fromID)
	s.Hub.SendToUser(targetID, hub.NewEvent("punch", map[string]interface{}{
		"call_id": callID, "by_user_id": fromID, "by_nick": nick,
	}))
	// Пуш, если приложение закрыто.
	s.pushNotify(targetID, "👊 Пинок", nick+" пнул вас в звонке", "punch")
}
