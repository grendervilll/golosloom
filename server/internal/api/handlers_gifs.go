// Поиск GIF: прокси к Giphy API. Ключ хранится на сервере (GIPHY_API_KEY),
// клиент не знает ключ. Без ключа возвращаем 501 с подсказкой.
package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

type gifResult struct {
	URL     string `json:"url"`
	Preview string `json:"preview"`
	Title   string `json:"title"`
}

func (s *Server) handleGifSearch(w http.ResponseWriter, r *http.Request) {
	key := s.Cfg.GiphyAPIKey
	if key == "" {
		writeErr(w, http.StatusNotImplemented, "поиск GIF не настроен (нужен GIPHY_API_KEY)")
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
	apiURL := fmt.Sprintf(
		"https://api.giphy.com/v1/gifs/search?api_key=%s&q=%s&limit=%d&rating=g&lang=ru",
		url.QueryEscape(key), url.QueryEscape(q), limit,
	)
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(apiURL)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "не удалось обратиться к Giphy")
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		writeErr(w, http.StatusBadGateway, fmt.Sprintf("Giphy ответил %d", resp.StatusCode))
		return
	}
	var body struct {
		Data []struct {
			Title string `json:"title"`
			Images struct {
				FixedHeight struct {
					URL string `json:"url"`
				} `json:"fixed_height"`
				Downsized struct {
					URL string `json:"url"`
				} `json:"downsized"`
			} `json:"images"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadGateway, "некорректный ответ Giphy")
		return
	}
	out := make([]gifResult, 0, len(body.Data))
	for _, g := range body.Data {
		if g.Images.Downsized.URL == "" {
			continue
		}
		out = append(out, gifResult{
			URL:     g.Images.Downsized.URL,
			Preview: g.Images.FixedHeight.URL,
			Title:   g.Title,
		})
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"gifs": out})
}
