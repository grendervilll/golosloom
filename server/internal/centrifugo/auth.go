package centrifugo

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// GenerateConnectionToken creates a Centrifugo connection JWT.
// This token does NOT contain a channel list — clients use subscription
// tokens (per-channel) for dynamic channel joins.
func GenerateConnectionToken(userID int64, nick string, isServerAdmin bool, secret string, ttl time.Duration) (string, error) {
	info := map[string]interface{}{
		"nick":             nick,
		"is_server_admin":  isServerAdmin,
	}
	infoRaw, err := json.Marshal(info)
	if err != nil {
		return "", fmt.Errorf("centrifugo auth: marshal info: %w", err)
	}
	claims := jwt.MapClaims{
		"sub":  fmt.Sprintf("%d", userID),
		"exp":  time.Now().Add(ttl).Unix(),
		"info": json.RawMessage(infoRaw),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// GenerateSubscriptionToken creates a Centrifugo subscription token
// for a specific channel. Issued on demand after verifying channel membership.
func GenerateSubscriptionToken(userID int64, channel string, secret string, ttl time.Duration) (string, error) {
	claims := jwt.MapClaims{
		"sub":     fmt.Sprintf("%d", userID),
		"exp":     time.Now().Add(ttl).Unix(),
		"channel": channel,
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}
