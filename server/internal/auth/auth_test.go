package auth

import (
	"testing"
	"time"
)

func ttlSeconds(n int) time.Duration { return time.Duration(n) * time.Second }

func TestValidatePassword(t *testing.T) {
	cases := []struct {
		name    string
		pw      string
		wantErr bool
	}{
		{"короткий", "Aa1!", true},
		{"ровно 12 без спецсимвола", "abcdefABCDEF", true},
		{"без заглавных", "abcdef12345!", true},
		{"без строчных", "ABCDEF12345!", true},
		{"корректный 12 символов", "Abcdef12345!", false},
		{"корректный длинный", "aB!1qwertyuiopasdfghjkl", false},
		{"пустой", "", true},
		{"кириллица разный регистр и спецсимвол", "ПриветМирКакДела!", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidatePassword(tc.pw)
			if tc.wantErr && err == nil {
				t.Fatalf("ожидали ошибку для %q", tc.pw)
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("не ожидали ошибку для %q: %v", tc.pw, err)
			}
		})
	}
}

func TestHashAndCheck(t *testing.T) {
	hash, err := HashPassword("Abcdef12345!")
	if err != nil {
		t.Fatal(err)
	}
	if hash == "Abcdef12345!" {
		t.Fatal("пароль не должен храниться в открытом виде")
	}
	if !CheckPassword(hash, "Abcdef12345!") {
		t.Fatal("верный пароль не прошёл проверку")
	}
	if CheckPassword(hash, "WrongPassword1!") {
		t.Fatal("неверный пароль прошёл проверку")
	}
}

func TestGenerateAndParseToken(t *testing.T) {
	secret := "test-secret"
	token, err := GenerateToken(42, 7, secret, ttlSeconds(3600))
	if err != nil {
		t.Fatal(err)
	}
	id, ver, err := ParseToken(token, secret)
	if err != nil {
		t.Fatal(err)
	}
	if id != 42 || ver != 7 {
		t.Fatalf("ожидали id/ver 42/7, получили %d/%d", id, ver)
	}
	if _, _, err := ParseToken(token, "wrong-secret"); err == nil {
		t.Fatal("токен с неверным секретом не должен парситься")
	}
	if _, _, err := ParseToken("garbage.token.here", secret); err == nil {
		t.Fatal("мусорный токен не должен парситься")
	}
	// Разлогин везде: версия токена не совпадает — отклоняем.
	stale, _ := GenerateToken(42, 6, secret, ttlSeconds(3600))
	if _, ver2, err := ParseToken(stale, secret); err != nil || ver2 != 6 {
		t.Fatal("старый токен с другой версией должен парситься (проверку версии делает сервер)")
	}
}

func TestNormalizeNick(t *testing.T) {
	if NormalizeNick("  UserName  ") != "username" {
		t.Fatal("ник должен нормализоваться в нижний регистр")
	}
}
