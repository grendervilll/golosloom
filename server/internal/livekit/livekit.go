package livekit

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type VideoGrant struct {
	Room         string `json:"room,omitempty"`
	RoomJoin     bool   `json:"roomJoin,omitempty"`
	RoomAdmin    bool   `json:"roomAdmin,omitempty"`
	CanPublish   bool   `json:"canPublish,omitempty"`
	CanSubscribe bool   `json:"canSubscribe,omitempty"`
}

// Token создаёт JWT-токен LiveKit для входа в комнату звонка.
// Важно: identity участника LiveKit берёт из claim "sub" (стандарт
// livekit-server-sdk: sub = identity). Identity должен быть уникален на
// УСТРОЙСТВО (userID:deviceID): если два устройства входят с одним
// identity, LiveKit выкидывает второе (DUPLICATE_IDENTITY).
func Token(apiKey, apiSecret, identity, name, room string, ttl time.Duration) (string, error) {
	claims := jwt.MapClaims{
		"iss": apiKey,
		"sub": identity,
		"nbf": time.Now().Unix(),
		"exp": time.Now().Add(ttl).Unix(),
		"jti": fmt.Sprintf("%d", time.Now().UnixNano()),
		"video": VideoGrant{
			Room:         room,
			RoomJoin:     true,
			CanPublish:   true,
			CanSubscribe: true,
		},
		"identity": identity,
		"name":     name,
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(apiSecret))
}

// RoomAdminToken — токен с правами администратора комнаты для серверных
// вызовов API LiveKit (например, ListParticipants для сверки звонков).
func RoomAdminToken(apiKey, apiSecret, room string, ttl time.Duration) (string, error) {
	claims := jwt.MapClaims{
		"iss": apiKey,
		"sub": "golosloom-reconciler",
		"nbf": time.Now().Unix(),
		"exp": time.Now().Add(ttl).Unix(),
		"jti": fmt.Sprintf("%d", time.Now().UnixNano()),
		"video": VideoGrant{
			Room:      room,
			RoomAdmin: true,
		},
		"identity": "golosloom-reconciler",
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(apiSecret))
}

// TurnCredentials возвращает временные учётные данные coturn по
// static-auth-secret (RFC 5766 / spec draft: username = expiry:user, password = HMAC).
func TurnCredentials(sharedSecret, realm string, ttl time.Duration) (username, credential string, err error) {
	if sharedSecret == "" {
		return "", "", nil
	}
	expiry := time.Now().Add(ttl).Unix()
	username = fmt.Sprintf("%d:%s", expiry, "golosloom")
	mac := hmac.New(sha1.New, []byte(sharedSecret))
	mac.Write([]byte(username))
	credential = base64.StdEncoding.EncodeToString(mac.Sum(nil))
	return username, credential, nil
}
