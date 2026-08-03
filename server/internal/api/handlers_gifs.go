// Поиск GIF: прокси к Klipy. Ключ хранится на сервере (GIF_API_KEY),
// клиент его не знает. Без ключа — 501 с подсказкой.
package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"time"
)

// Клиент с принудительным IPv4: в контейнере DNS может отдавать IPv6 первым,
// а IPv6-маршрут отсутствует — Go-клиент вис бы на нём до таймаута.
var gifHTTP = &http.Client{
	Timeout: 15 * time.Second,
	Transport: &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			return (&net.Dialer{Timeout: 8 * time.Second}).DialContext(ctx, "tcp4", addr)
		},
		TLSHandshakeTimeout: 8 * time.Second,
	},
}

type gifResult struct {
	URL     string `json:"url"`
	Preview string `json:"preview"`
	Title   string `json:"title"`
}

func (s *Server) handleGifSearch(w http.ResponseWriter, r *http.Request) {
	key := s.Cfg.GiphyAPIKey
	if key == "" {
		writeErr(w, http.StatusNotImplemented, "поиск GIF не настроен (нужен GIF_API_KEY — ключ Klipy)")
		return
	}
	q := r.URL.Query().Get("q")
	if len([]rune(q)) > 100 {
		q = string([]rune(q)[:100])
	}
	limit := 24
	if v, err := parseQueryInt(r, "limit"); err == nil && v > 0 && v <= 50 {
		limit = v
	}
	out, err := searchKlipy(key, q, limit)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"gifs": out})
}

func giphyGet(url string, out interface{}) error {
	resp, err := gifHTTP.Get(url)
	if err != nil {
		return fmt.Errorf("не удалось обратиться к GIF-провайдеру")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("GIF-провайдер ответил %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// searchKlipy — Klipy: ключ в пути URL, региональный хост.
// В чат уходит средний gif (md), в пикере — маленький (sm).
func searchKlipy(key, q string, limit int) ([]gifResult, error) {
	apiURL := fmt.Sprintf(
		"https://api-us-east4.klipy.com/api/v1/%s/gifs/search?q=%s&locale=ru&page=1&per_page=%d",
		url.PathEscape(key), url.QueryEscape(q), limit,
	)
	var body struct {
		Result bool `json:"result"`
		Data   struct {
			Data []struct {
				Title string `json:"title"`
				File  struct {
					Md struct {
						Gif struct {
							URL string `json:"url"`
						} `json:"gif"`
					} `json:"md"`
					Sm struct {
						Gif struct {
							URL string `json:"url"`
						} `json:"gif"`
					} `json:"sm"`
				} `json:"file"`
			} `json:"data"`
		} `json:"data"`
	}
	if err := giphyGet(apiURL, &body); err != nil {
		return nil, err
	}
	out := make([]gifResult, 0, len(body.Data.Data))
	for _, g := range body.Data.Data {
		if g.File.Md.Gif.URL == "" {
			continue
		}
		preview := g.File.Sm.Gif.URL
		if preview == "" {
			preview = g.File.Md.Gif.URL
		}
		out = append(out, gifResult{
			URL:     g.File.Md.Gif.URL,
			Preview: preview,
			Title:   g.Title,
		})
	}
	return out, nil
}
