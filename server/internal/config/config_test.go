package config

import (
	"testing"
	"time"
)

func TestLoadDefaults(t *testing.T) {
	cfg := Load()
	if cfg.Port != "8080" {
		t.Fatalf("порт по умолчанию: %s", cfg.Port)
	}
	if cfg.JWTSecret == "" {
		t.Fatal("секрет не должен быть пустым")
	}
	if cfg.JWTTTL != 30*24*time.Hour {
		t.Fatalf("ttl по умолчанию: %v", cfg.JWTTTL)
	}
	if cfg.MaxMessageLen != 2000 {
		t.Fatalf("максимальная длина сообщения: %d", cfg.MaxMessageLen)
	}
	if cfg.MessageRatePerSec != 10 {
		t.Fatalf("rate limit по умолчанию: %d", cfg.MessageRatePerSec)
	}
	if cfg.PunchInterval != 10*time.Second {
		t.Fatalf("интервал пинка: %v", cfg.PunchInterval)
	}
	if cfg.RingTimeout != 20*time.Second {
		t.Fatalf("таймаут звонка: %v", cfg.RingTimeout)
	}
	if len(cfg.TurnURLs) != 0 {
		t.Fatal("TURN URLs по умолчанию пусты")
	}
}

func TestLoadFromEnv(t *testing.T) {
	t.Setenv("PORT", "9090")
	t.Setenv("DB_PATH", "/tmp/x.db")
	t.Setenv("JWT_SECRET", "env-secret")
	t.Setenv("JWT_TTL", "1h")
	t.Setenv("MAX_MESSAGE_LEN", "100")
	t.Setenv("MESSAGE_RATE_PER_SEC", "5")
	t.Setenv("PUNCH_INTERVAL", "3s")
	t.Setenv("RING_TIMEOUT", "7s")
	t.Setenv("TURN_URLS", "turn:a.example.com:3478, turn:b.example.com:3478")
	t.Setenv("ALLOW_ORIGINS", "https://x.example.com, https://y.example.com")
	t.Setenv("LIVEKIT_URL", "wss://lk.example.com")
	t.Setenv("LIVEKIT_API_KEY", "lk-key")
	t.Setenv("LIVEKIT_API_SECRET", "lk-secret")
	t.Setenv("TURN_SHARED_SECRET", "turn-secret")
	t.Setenv("TURN_REALM", "golosloom")

	cfg := Load()
	if cfg.Port != "9090" || cfg.DBPath != "/tmp/x.db" || cfg.JWTSecret != "env-secret" {
		t.Fatal("значения из env не применились")
	}
	if cfg.JWTTTL != time.Hour {
		t.Fatalf("JWT_TTL: %v", cfg.JWTTTL)
	}
	if cfg.MaxMessageLen != 100 || cfg.MessageRatePerSec != 5 {
		t.Fatal("лимиты из env не применились")
	}
	if cfg.PunchInterval != 3*time.Second || cfg.RingTimeout != 7*time.Second {
		t.Fatal("интервалы из env не применились")
	}
	if len(cfg.TurnURLs) != 2 || cfg.TurnURLs[0] != "turn:a.example.com:3478" {
		t.Fatalf("TURN URLs: %v", cfg.TurnURLs)
	}
	if len(cfg.AllowOrigins) != 2 {
		t.Fatalf("AllowOrigins: %v", cfg.AllowOrigins)
	}
	if cfg.LiveKitURL != "wss://lk.example.com" || cfg.LiveKitAPIKey != "lk-key" || cfg.LiveKitAPISecret != "lk-secret" {
		t.Fatal("LiveKit настройки не применились")
	}
	if cfg.TurnSharedSecret != "turn-secret" || cfg.TurnRealm != "golosloom" {
		t.Fatal("TURN настройки не применились")
	}
}

func TestInvalidEnvValuesFallBack(t *testing.T) {
	t.Setenv("MESSAGE_RATE_PER_SEC", "not-a-number")
	t.Setenv("JWT_TTL", "not-a-duration")
	cfg := Load()
	if cfg.MessageRatePerSec != 10 {
		t.Fatalf("невалидное число должно давать дефолт: %d", cfg.MessageRatePerSec)
	}
	if cfg.JWTTTL != 30*24*time.Hour {
		t.Fatalf("невалидная длительность должна давать дефолт: %v", cfg.JWTTTL)
	}
}
