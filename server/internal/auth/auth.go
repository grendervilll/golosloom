package auth

import (
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

var (
	ErrWeakPassword = errors.New("слабый пароль: минимум 12 символов, заглавные и строчные буквы, спецсимволы")
)

// ValidatePassword проверяет требования к паролю: минимум 12 символов,
// разный регистр и спецсимволы.
func ValidatePassword(pw string) error {
	if len(pw) < 12 {
		return ErrWeakPassword
	}
	var hasUpper, hasLower, hasSpecial bool
	for _, r := range pw {
		switch {
		case unicode.IsUpper(r):
			hasUpper = true
		case unicode.IsLower(r):
			hasLower = true
		case unicode.IsPunct(r) || unicode.IsSymbol(r):
			hasSpecial = true
		}
	}
	if !hasUpper || !hasLower || !hasSpecial {
		return ErrWeakPassword
	}
	return nil
}

func HashPassword(pw string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func CheckPassword(hash, pw string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(pw)) == nil
}

func GenerateToken(userID int64, secret string, ttl time.Duration) (string, error) {
	claims := jwt.MapClaims{
		"sub": fmt.Sprintf("%d", userID),
		"exp": time.Now().Add(ttl).Unix(),
		"iat": time.Now().Unix(),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
}

func ParseToken(token, secret string) (int64, error) {
	t, err := jwt.Parse(token, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return []byte(secret), nil
	})
	if err != nil || !t.Valid {
		return 0, errors.New("invalid token")
	}
	claims, ok := t.Claims.(jwt.MapClaims)
	if !ok {
		return 0, errors.New("invalid claims")
	}
	sub, ok := claims["sub"].(string)
	if !ok {
		return 0, errors.New("invalid subject")
	}
	var id int64
	if _, err := fmt.Sscanf(sub, "%d", &id); err != nil {
		return 0, errors.New("invalid subject")
	}
	return id, nil
}

// NormalizeNick приводит ник к единому виду для сравнения уникальности.
func NormalizeNick(nick string) string {
	return strings.ToLower(strings.TrimSpace(nick))
}
