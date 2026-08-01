package livekit

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestTokenClaims(t *testing.T) {
	token, err := Token("api-key", "api-secret", "user-42", "call-7", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := jwt.Parse(token, func(t *jwt.Token) (interface{}, error) {
		return []byte("api-secret"), nil
	})
	if err != nil || !parsed.Valid {
		t.Fatalf("токен не парсится: %v", err)
	}
	claims := parsed.Claims.(jwt.MapClaims)
	if claims["iss"] != "api-key" || claims["identity"] != "user-42" {
		t.Fatalf("некорректные claims: %v", claims)
	}
	video, ok := claims["video"].(map[string]interface{})
	if !ok {
		t.Fatal("нет video grant")
	}
	if video["room"] != "call-7" || video["roomJoin"] != true {
		t.Fatalf("некорректный video grant: %v", video)
	}
	// Токен с неверным секретом не валиден.
	bad, err := jwt.Parse(token, func(t *jwt.Token) (interface{}, error) {
		return []byte("wrong-secret"), nil
	})
	if err == nil && bad.Valid {
		t.Fatal("токен с неверным секретом не должен быть валиден")
	}
}

func TestTurnCredentials(t *testing.T) {
	user, cred, err := TurnCredentials("shared-secret", "realm", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.SplitN(user, ":", 2)
	if len(parts) != 2 {
		t.Fatalf("username должен быть expiry:user: %s", user)
	}
	// Проверяем HMAC-SHA1(secret, username).
	mac := hmac.New(sha1.New, []byte("shared-secret"))
	mac.Write([]byte(user))
	expected := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	if cred != expected {
		t.Fatal("учётные данные не совпадают с HMAC")
	}
	// Без секрета — пустые учётные данные.
	u2, c2, err := TurnCredentials("", "realm", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if u2 != "" || c2 != "" {
		t.Fatal("без секрета учётные данные должны быть пустыми")
	}
}
