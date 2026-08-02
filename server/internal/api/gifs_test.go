package api

import (
	"fmt"
	"net/http"
	"testing"

	"golosloom/server/internal/config"
)

func TestGifSearchAuthRequired(t *testing.T) {
	a := newTestApp(t, nil)
	code, _ := a.do(t, http.MethodGet, "/api/gifs/search?q=run", "", nil)
	if code != http.StatusUnauthorized {
		t.Fatalf("поиск GIF без токена: ожидали 401, получили %d", code)
	}
}

func TestGifSearchWithoutKey(t *testing.T) {
	a := newTestApp(t, func(cfg *config.Config) {
		cfg.GiphyAPIKey = ""
	})
	u := a.register(t, "GifUser")
	code, body := a.do(t, http.MethodGet, "/api/gifs/search?q=run", u.token, nil)
	if code != http.StatusNotImplemented {
		t.Fatalf("поиск GIF без ключа: ожидали 501, получили %d %v", code, body)
	}
}

func TestGifSearchBadQuery(t *testing.T) {
	a := newTestApp(t, nil)
	u := a.register(t, "GifUser2")
	// Длинный запрос обрезается, а не падает.
	code, _ := a.do(t, http.MethodGet, fmt.Sprintf("/api/gifs/search?q=%s", string(make([]byte, 300))), u.token, nil)
	if code != http.StatusOK && code != http.StatusBadGateway {
		t.Fatalf("длинный запрос: неожиданный код %d", code)
	}
}
