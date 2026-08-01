package main

import (
	"os"
	"fmt"
	"net"
	"net/http"
	"testing"
	"time"

	"golosloom/server/internal/config"
)

func freePort(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return fmt.Sprintf("%d", l.Addr().(*net.TCPAddr).Port)
}

func TestServeSmoke(t *testing.T) {
	t.Setenv("PORT", freePort(t))
	t.Setenv("DB_PATH", t.TempDir()+"/main.db")
	t.Setenv("JWT_SECRET", "test-secret")
	go func() { _ = serve() }()
	deadline := time.Now().Add(3 * time.Second)
	for {
		resp, err := http.Get("http://127.0.0.1:" + os.Getenv("PORT") + "/api/config")
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return
			}
		}
		if time.Now().After(deadline) {
			t.Fatal("сервер не поднялся")
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func TestServePortInUse(t *testing.T) {
	// Невалидный порт заставляет ListenAndServe вернуть ошибку сразу.
	t.Setenv("PORT", "99999")
	t.Setenv("DB_PATH", t.TempDir()+"/main.db")
	if err := serve(); err == nil {
		t.Fatal("serve должен вернуть ошибку, если порт некорректен")
	}
}

func TestServeBadDBPath(t *testing.T) {
	// /dev/null — файл, а не директория: MkdirAll не сможет создать подпуть.
	t.Setenv("DB_PATH", "/dev/null/golosloom.db")
	t.Setenv("PORT", freePort(t))
	if err := serve(); err == nil {
		t.Fatal("serve должен вернуть ошибку при невозможности открыть БД")
	}
}

var _ = config.Load
