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

func GenerateToken(userID, version int64, secret string, ttl time.Duration) (string, error) {
	claims := jwt.MapClaims{
		"sub": fmt.Sprintf("%d", userID),
		"ver": version,
		"exp": time.Now().Add(ttl).Unix(),
		"iat": time.Now().Unix(),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
}

// FileTokenTTL — время жизни файлового токена: ссылка на файл живёт 5 минут.
// Этого хватает на открытие/просмотр, но утёкшая ссылка быстро умирает
// и не даёт доступа к аккаунту (в отличие от основного JWT).
const FileTokenTTL = 5 * time.Minute

// GenerateFileToken — короткоживущий токен ТОЛЬКО для файлов (scope: file).
// Раздаётся по запросу /api/files/token; в URL файлов основной JWT
// никогда не попадает.
func GenerateFileToken(userID, version int64, secret string) (string, error) {
	claims := jwt.MapClaims{
		"sub":   fmt.Sprintf("%d", userID),
		"ver":   version,
		"scope": "file",
		"exp":   time.Now().Add(FileTokenTTL).Unix(),
		"iat":   time.Now().Unix(),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
}

// ParseFileToken — разбор файлового токена: валидная подпись, не истёк,
// scope=file. Обычный (полный) JWT здесь отклоняется: файлы нельзя
// открывать «токеном аккаунта».
func ParseFileToken(token, secret string) (int64, int64, error) {
	id, ver, err := parseTokenClaims(token, secret, "file")
	if err != nil {
		return 0, 0, err
	}
	return id, ver, nil
}

// parseTokenClaims — общий разбор: подпись, срок, sub, ver и (опционально)
// scope. Если needScope непустой — токен без этого scope отклоняется.
func parseTokenClaims(token, secret, needScope string) (int64, int64, error) {
	t, err := jwt.Parse(token, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return []byte(secret), nil
	})
	if err != nil || !t.Valid {
		return 0, 0, errors.New("invalid token")
	}
	claims, ok := t.Claims.(jwt.MapClaims)
	if !ok {
		return 0, 0, errors.New("invalid claims")
	}
	if needScope != "" && claims["scope"] != needScope {
		return 0, 0, errors.New("not a file token")
	}
	sub, ok := claims["sub"].(string)
	if !ok {
		return 0, 0, errors.New("invalid subject")
	}
	var id int64
	if _, err := fmt.Sscanf(sub, "%d", &id); err != nil {
		return 0, 0, errors.New("invalid subject")
	}
	var ver int64
	if v, ok := claims["ver"].(float64); ok {
		ver = int64(v)
	}
	return id, ver, nil
}

// ParseToken возвращает (userID, версия токена, ошибка). Версия нужна
// для «разлогина везде»: после смены пароля она растёт и старые токены
// отклоняются.
func ParseToken(token, secret string) (int64, int64, error) {
	id, ver, err := parseTokenClaims(token, secret, "")
	if err != nil {
		return 0, 0, err
	}
	return id, ver, nil
}

// NormalizeNick приводит ник к единому виду для сравнения уникальности.
func NormalizeNick(nick string) string {
	return strings.ToLower(strings.TrimSpace(nick))
}
