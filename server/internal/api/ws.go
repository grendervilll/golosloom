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
	userID, err := auth.ParseToken(token, s.Cfg.JWTSecret)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "требуется авторизация")
		return
	}
	u, err := s.Store.GetUserByID(userID)
	if err != nil || u.ServerBanned {
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
		// Если отключившийся пользователь был единственным участником звонка
		// (например, инициатор закрыл браузер) — звонок завершается, иначе
		// он навсегда остался бы «активным» и заблокировал новые вызовы.
		s.endCallsIfSoleParticipant(c.UserID)
	}()
	c.Conn.SetReadLimit(4096)
	_ = c.Conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	c.Conn.SetPongHandler(func(string) error {
		_ = c.Conn.SetReadDeadline(time.Now().Add(90 * time.Second))
		return nil
	})
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

// endCallsIfSoleParticipant завершает звонки, где отключившийся пользователь
// был единственным участником.
func (s *Server) endCallsIfSoleParticipant(userID int64) {
	if s.Hub.IsOnline(userID) {
		return // есть другие подключения пользователя
	}
	calls, err := s.Store.ActiveCallsForParticipant(userID)
	if err != nil {
		return
	}
	for _, call := range calls {
		n, err := s.Store.CallParticipantCount(call.ID)
		if err != nil || n != 1 {
			continue
		}
		s.finishCall(call, "единственный участник отключился")
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
}
