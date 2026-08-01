package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port              string
	DBPath            string
	JWTSecret         string
	JWTTTL            time.Duration
	LiveKitURL        string
	LiveKitAPIKey     string
	LiveKitAPISecret  string
	TurnURLs          []string
	TurnSharedSecret  string
	TurnRealm         string
	AllowOrigins      []string
	MaxMessageLen     int
	MessageRatePerSec int
	PunchInterval     time.Duration
	RingTimeout       time.Duration
}

func Load() Config {
	return Config{
		Port:              getenv("PORT", "8080"),
		DBPath:            getenv("DB_PATH", "data/golosloom.db"),
		JWTSecret:         getenv("JWT_SECRET", "dev-secret-change-me"),
		JWTTTL:            getenvDur("JWT_TTL", 30*24*time.Hour),
		LiveKitURL:        getenv("LIVEKIT_URL", "ws://localhost:7880"),
		LiveKitAPIKey:     getenv("LIVEKIT_API_KEY", ""),
		LiveKitAPISecret:  getenv("LIVEKIT_API_SECRET", ""),
		TurnURLs:          splitEnv("TURN_URLS"),
		TurnSharedSecret:  getenv("TURN_SHARED_SECRET", ""),
		TurnRealm:         getenv("TURN_REALM", ""),
		AllowOrigins:      splitEnv("ALLOW_ORIGINS"),
		MaxMessageLen:     getenvInt("MAX_MESSAGE_LEN", 2000),
		MessageRatePerSec: getenvInt("MESSAGE_RATE_PER_SEC", 10),
		PunchInterval:     getenvDur("PUNCH_INTERVAL", 10*time.Second),
		RingTimeout:       getenvDur("RING_TIMEOUT", 20*time.Second),
	}
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func getenvInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func getenvDur(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}

func splitEnv(key string) []string {
	raw := os.Getenv(key)
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
