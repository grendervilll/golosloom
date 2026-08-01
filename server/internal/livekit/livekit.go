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
	Room        string `json:"room,omitempty"`
	RoomJoin    bool   `json:"roomJoin,omitempty"`
	CanPublish  bool   `json:"canPublish,omitempty"`
	CanSubscribe bool  `json:"canSubscribe,omitempty"`
}

// Token создаёт JWT-токен LiveKit для входа в комнату звонка.
func Token(apiKey, apiSecret, identity, room string, ttl time.Duration) (string, error) {
	claims := jwt.MapClaims{
		"iss": apiKey,
		"sub": apiKey,
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
		"name":     identity,
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
