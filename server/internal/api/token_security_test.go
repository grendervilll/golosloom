// Тест безопасности токенов: смена пароля инвалидирует все выданные
// токены («разлогин везде»), файловый токен тоже умирает.
package api

import (
	"fmt"
	"net/http"
	"testing"
)

func TestPasswordResetInvalidatesTokens(t *testing.T) {
	a := newTestApp(t, nil)
	admin := a.register(t, "TokAdmin") // первый пользователь — админ сервера
	u := a.register(t, "TokUser")

	// Токен пользователя работает.
	if code, _ := a.do(t, http.MethodGet, "/api/me", u.token, nil); code != http.StatusOK {
		t.Fatalf("токен до смены пароля: %d", code)
	}
	// Файловый токен тоже выдаётся.
	if code, _ := a.do(t, http.MethodGet, "/api/files/token", u.token, nil); code != http.StatusOK {
		t.Fatalf("файловый токен до смены пароля: %d", code)
	}

	// Админ сбрасывает пароль — версия токенов пользователя растёт.
	code, _ := a.do(t, http.MethodPost, "/api/admin/users/"+fmt.Sprint(u.id)+"/password", admin.token,
		map[string]string{"password": "NewPassword123!"})
	if code != http.StatusOK {
		t.Fatalf("сброс пароля: %d", code)
	}

	// Старый токен больше не действует нигде.
	if code, _ := a.do(t, http.MethodGet, "/api/me", u.token, nil); code != http.StatusUnauthorized {
		t.Fatalf("старый токен после смены пароля: ожидали 401, получили %d", code)
	}
	if code, _ := a.do(t, http.MethodGet, "/api/files/token", u.token, nil); code != http.StatusUnauthorized {
		t.Fatalf("старый файловый токен после смены пароля: ожидали 401, получили %d", code)
	}

	// Новый вход выдаёт рабочий токен.
	if code, _ := a.do(t, http.MethodPost, "/api/login", "", map[string]string{"nick": "tokuser", "password": "NewPassword123!"}); code != http.StatusOK {
		t.Fatalf("вход новым паролем: %d", code)
	}
}
