// Web Push: уведомления пользователям, у которых приложение закрыто.
// Пуш отправить может только сервер, а сервер не знает содержимое сообщений
// (E2E), поэтому в уведомлениях — только факт события, без текста сообщений.
package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/SherClockHolmes/webpush-go"

	"golosloom/server/internal/store"
)

// pushService — обёртка над webpush-go: VAPID-ключи и отправка сообщения.
type pushService struct {
	publicKey  string
	privateKey string
	subject    string
}

func (p *pushService) sendNotification(payload []byte, sub store.PushSubscription) (*http.Response, error) {
	return webpush.SendNotification(payload, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys: webpush.Keys{
			P256dh: sub.P256dh,
			Auth:   sub.Auth,
		},
	}, &webpush.Options{
		VAPIDPublicKey:  p.publicKey,
		VAPIDPrivateKey: p.privateKey,
		Subscriber:      p.subject,
		TTL:             3600, // час: просроченные пуши отбрасываются
	})
}

// pushNotify отправляет пуш пользователю, если у него нет активного
// WS-соединения (приложение открыто — уведомление не нужно).
func (s *Server) pushNotify(userID int64, title, body, tag string) {
	// Приложение открыто — событие и так придёт по WebSocket.
	if s.Hub.IsOnline(userID) {
		return
	}
	payload, _ := json.Marshal(map[string]string{"title": title, "body": body, "tag": tag})
	if s.push != nil {
		subs, err := s.Store.PushSubscriptions(userID)
		if err == nil && len(subs) > 0 {
			s.sendWebPush(userID, subs, payload)
		}
	}
	if s.fcm != nil {
		tokens, err := s.Store.FcmTokens(userID)
		if err == nil && len(tokens) > 0 {
			s.sendFcm(userID, tokens, title, body, tag)
		}
	}
}

func (s *Server) sendWebPush(userID int64, subs []store.PushSubscription, payload []byte) {
	// Отправка по сети не должна задерживать обработчик.
	go func() {
		for _, sub := range subs {
			resp, err := s.push.sendNotification(payload, sub)
			if err != nil {
				continue
			}
			resp.Body.Close()
			// Подписка устарела/удалена у браузера — чистим.
			if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone {
				_ = s.Store.RemovePushSubscription(userID, sub.Endpoint)
			}
		}
	}()
}

func (s *Server) sendFcm(userID int64, tokens []string, title, body, tag string) {
	go func() {
		for _, token := range tokens {
			err := s.fcm.send(token, title, body, tag)
			if errors.Is(err, errFcmGone) {
				_ = s.Store.RemoveFcmToken(userID, token)
			}
		}
	}()
}

// pushChannelMessage — уведомление офлайн-участникам канала о новом сообщении.
// Текст сообщения серверу недоступен (E2E-шифрование), поэтому в пуше —
// только факт и канал. tag по каналу: несколько сообщений сворачиваются в одно.
func (s *Server) pushChannelMessage(channelID, senderID int64) {
	if s.push == nil {
		return
	}
	nick := s.nickOf(senderID)
	name := s.channelName(channelID)
	members, err := s.Store.ListMembers(channelID)
	if err != nil {
		return
	}
	for _, m := range members {
		if m.UserID == senderID {
			continue
		}
		s.pushNotify(m.UserID, "💬 "+nick, "Новое сообщение в канале «"+name+"»", fmt.Sprintf("ch-%d", channelID))
	}
}

// handlePushSubscribe — регистрация подписки на пуши (авторизован).
func (s *Server) handlePushSubscribe(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Endpoint string `json:"endpoint"`
		P256dh   string `json:"p256dh"`
		Auth     string `json:"auth"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "некорректный запрос")
		return
	}
	if req.Endpoint == "" || req.P256dh == "" || req.Auth == "" {
		writeErr(w, http.StatusBadRequest, "endpoint, p256dh и auth обязательны")
		return
	}
	if err := s.Store.AddPushSubscription(userIDFrom(r), req.Endpoint, req.P256dh, req.Auth); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handlePushUnsubscribe — отписка от пушей.
func (s *Server) handlePushUnsubscribe(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Endpoint string `json:"endpoint"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "некорректный запрос")
		return
	}
	if req.Endpoint == "" {
		writeErr(w, http.StatusBadRequest, "endpoint обязателен")
		return
	}
	if err := s.Store.RemovePushSubscription(userIDFrom(r), req.Endpoint); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleFcmSubscribe — регистрация FCM-токена приложения (авторизован).
func (s *Server) handleFcmSubscribe(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token string `json:"token"`
	}
	if err := readJSON(r, &req); err != nil || req.Token == "" {
		writeErr(w, http.StatusBadRequest, "token обязателен")
		return
	}
	if err := s.Store.AddFcmToken(userIDFrom(r), req.Token); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleFcmUnsubscribe — удаление FCM-токена.
func (s *Server) handleFcmUnsubscribe(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token string `json:"token"`
	}
	if err := readJSON(r, &req); err != nil || req.Token == "" {
		writeErr(w, http.StatusBadRequest, "token обязателен")
		return
	}
	if err := s.Store.RemoveFcmToken(userIDFrom(r), req.Token); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
