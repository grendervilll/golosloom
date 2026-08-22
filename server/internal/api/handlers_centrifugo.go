package api

import (
	"net/http"
	"strconv"
	"time"

	"golosloom/server/internal/centrifugo"
)

// handleCentrifugoToken — POST /api/centrifugo/token
// Issues a Centrifugo connection JWT to the client.
// The token does NOT contain a channel list — clients use subscription
// tokens (per-channel) for dynamic channel joins.
func (s *Server) handleCentrifugoToken(w http.ResponseWriter, r *http.Request) {
	userID := userIDFrom(r)
	u, err := s.Store.GetUserByID(userID)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "пользователь не найден")
		return
	}
	token, err := centrifugo.GenerateConnectionToken(
		userID, u.Nick, u.IsServerAdmin,
		s.Cfg.CentrifugoSecret, time.Hour,
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "ошибка генерации токена")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"token":    token,
		"centrifugo_url": "/centrifugo",
	})
}

// handleCentrifugoSubscribe — POST /api/centrifugo/subscribe
// Issues a Centrifugo subscription token for a specific channel after
// verifying the user is a member of that channel.
func (s *Server) handleCentrifugoSubscribe(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Channel string `json:"channel"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "некорректный запрос")
		return
	}
	if req.Channel == "" {
		writeErr(w, http.StatusBadRequest, "channel обязателен")
		return
	}
	userID := userIDFrom(r)

	// Verify channel membership.
	// Channel format: "channel:{id}" -> extract ID.
	channelID, err := strconv.ParseInt(trimChannelPrefix(req.Channel), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "неверный формат канала")
		return
	}
	if _, ok := s.requireChannelMember(w, r, channelID); !ok {
		return
	}

	token, err := centrifugo.GenerateSubscriptionToken(
		userID, req.Channel,
		s.Cfg.CentrifugoSecret, time.Hour,
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "ошибка генерации токена")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"token": token,
	})
}

// trimChannelPrefix strips the "channel:" prefix from a Centrifugo channel name.
func trimChannelPrefix(ch string) string {
	if len(ch) > 8 && ch[:8] == "channel:" {
		return ch[8:]
	}
	return ch
}
