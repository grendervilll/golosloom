// Скользящее окно лимита попыток по IP и блокировка по аккаунту.
package api

import (
	"net"
	"net/http"
	"sync"
	"time"
)

type ipBucket struct {
	windowStart time.Time
	count       int
}

type accountBucket struct {
	windowStart time.Time
	failed      int
	lockedUntil time.Time
}

type limiter struct {
	mu            sync.Mutex
	ipBuckets     map[string]*ipBucket
	account       map[string]*accountBucket
	ipLimit       int
	window        time.Duration
	accountLock   int
	lockDuration  time.Duration
}

func newLimiter(ipLimit int, window time.Duration, accountLock int, lockDuration time.Duration) *limiter {
	return &limiter{
		ipBuckets:    make(map[string]*ipBucket),
		account:      make(map[string]*accountBucket),
		ipLimit:      ipLimit,
		window:       window,
		accountLock:  accountLock,
		lockDuration: lockDuration,
	}
}

func clientIP(r *http.Request) string {
	// За Caddy (один прокси) доверяем X-Forwarded-For.
	if v := r.Header.Get("X-Forwarded-For"); v != "" {
		if host, _, err := net.SplitHostPort(v); err == nil {
			return host
		}
		if ip := net.ParseIP(v); ip != nil {
			return ip.String()
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// allowIP проверяет лимит попыток с IP (скользящее окно).
func (l *limiter) allowIP(ip string) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	b, ok := l.ipBuckets[ip]
	if !ok || now.Sub(b.windowStart) >= l.window {
		l.ipBuckets[ip] = &ipBucket{windowStart: now, count: 1}
		return true
	}
	b.count++
	return b.count <= l.ipLimit
}

// accountLocked возвращает true, если аккаунт заблокирован.
func (l *limiter) accountLocked(nick string) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	b, ok := l.account[nick]
	if !ok {
		return false
	}
	if now.Sub(b.windowStart) >= l.window {
		b.failed = 0
		b.lockedUntil = time.Time{}
	}
	return now.Before(b.lockedUntil)
}

// recordFailure фиксирует неудачный вход; при превышении порога — блокировка.
func (l *limiter) recordFailure(nick string) {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	b, ok := l.account[nick]
	if !ok || now.Sub(b.windowStart) >= l.window {
		b = &accountBucket{windowStart: now}
		l.account[nick] = b
	}
	b.failed++
	if b.failed >= l.accountLock {
		b.lockedUntil = now.Add(l.lockDuration)
	}
}

// recordSuccess сбрасывает счётчик неудач после успешного входа.
func (l *limiter) recordSuccess(nick string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.account, nick)
}

func (l *limiter) handle(w http.ResponseWriter, r *http.Request, next func(w http.ResponseWriter, r *http.Request)) {
	ip := clientIP(r)
	if !l.allowIP(ip) {
		writeErr(w, http.StatusTooManyRequests, "слишком много попыток, попробуйте позже")
		return
	}
	next(w, r)
}


