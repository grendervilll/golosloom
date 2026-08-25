package api

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golosloom/server/internal/auth"
)

func ringtonePath(s *Server) string {
	// Храним рядом с другими данными: data/ringtone.mp3 (FilesDir = data/files)
	base := filepath.Dir(s.Cfg.FilesDir)
	if base == "." || base == "" {
		base = "data"
	}
	return filepath.Join(base, "ringtone.mp3")
}

func ringtoneMeta(s *Server) (exists bool, hash string, size int64, updatedAt time.Time, contentType string) {
	p := ringtonePath(s)
	fi, err := os.Stat(p)
	if err != nil {
		return false, "", 0, time.Time{}, ""
	}
	f, err := os.Open(p)
	if err != nil {
		return false, "", 0, time.Time{}, ""
	}
	defer f.Close()
	h := sha256.New()
	n, _ := io.Copy(h, f)
	hash = hex.EncodeToString(h.Sum(nil))
	// Определяем content-type по первым байтам
	f.Seek(0, io.SeekStart)
	buf := make([]byte, 512)
	m, _ := f.Read(buf)
	ct := http.DetectContentType(buf[:m])
	// Принудительно для mp3
	if strings.HasSuffix(strings.ToLower(p), ".mp3") && strings.HasPrefix(ct, "application/octet-stream") {
		ct = "audio/mpeg"
	}
	return true, hash, n, fi.ModTime(), ct
}

func userIDFromRingtoneRequest(s *Server, r *http.Request) (int64, bool) {
	// 1. Пробуем Authorization: Bearer (JWT)
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		if uid, err := s.authenticate(r); err == nil {
			return uid, true
		}
	}
	// 2. Пробуем ?token= — может быть JWT или файловый токен
	if token := r.URL.Query().Get("token"); token != "" {
		// Сначала как JWT
		if uid, ver, err := auth.ParseToken(token, s.Cfg.JWTSecret); err == nil {
			if u, err := s.Store.GetUserByID(uid); err == nil && u.TokenVersion == ver {
				return uid, true
			}
		}
		// Затем как файловый токен
		if uid, ver, err := auth.ParseFileToken(token, s.Cfg.JWTSecret); err == nil {
			if u, err := s.Store.GetUserByID(uid); err == nil && u.TokenVersion == ver {
				return uid, true
			}
		}
	}
	return 0, false
}

func (s *Server) handleRingtoneInfo(w http.ResponseWriter, r *http.Request) {
	if _, ok := userIDFromRingtoneRequest(s, r); !ok {
		writeErr(w, http.StatusUnauthorized, "требуется авторизация")
		return
	}
	exists, hash, size, updatedAt, ct := ringtoneMeta(s)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"exists":       exists,
		"hash":         hash,
		"size":         size,
		"updated_at":   updatedAt.UTC().Format(time.RFC3339),
		"content_type": ct,
	})
}

func (s *Server) handleRingtoneGet(w http.ResponseWriter, r *http.Request) {
	if _, ok := userIDFromRingtoneRequest(s, r); !ok {
		writeErr(w, http.StatusUnauthorized, "требуется авторизация")
		return
	}
	p := ringtonePath(s)
	if _, err := os.Stat(p); err != nil {
		writeErr(w, http.StatusNotFound, "рингтон не установлен")
		return
	}
	// Кэширование: ETag по хешу
	_, hash, _, _, ct := ringtoneMeta(s)
	if hash != "" {
		w.Header().Set("ETag", `"`+hash+`"`)
		if match := r.Header.Get("If-None-Match"); match != "" && strings.Contains(match, hash) {
			w.WriteHeader(http.StatusNotModified)
			return
		}
	}
	if ct == "" {
		ct = "audio/mpeg"
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Cache-Control", "public, max-age=3600")
	http.ServeFile(w, r, p)
}

func (s *Server) handleAdminUploadRingtone(w http.ResponseWriter, r *http.Request) {
	// Ограничение 5 МБ (как аватар), но для мелодии можно чуть больше — 5 МБ достаточно для mp3
	r.Body = http.MaxBytesReader(w, r.Body, 5<<20)
	if err := r.ParseMultipartForm(5 << 20); err != nil {
		writeErr(w, http.StatusBadRequest, "файл слишком большой (макс 5 МБ)")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "файл не получен (поле file)")
		return
	}
	defer file.Close()

	// Проверка типа — только аудио
	ct := header.Header.Get("Content-Type")
	if ct == "" {
		ct = "audio/mpeg"
	}
	if !strings.HasPrefix(ct, "audio/") && !strings.HasSuffix(strings.ToLower(header.Filename), ".mp3") && !strings.HasSuffix(strings.ToLower(header.Filename), ".wav") && !strings.HasSuffix(strings.ToLower(header.Filename), ".ogg") && !strings.HasSuffix(strings.ToLower(header.Filename), ".m4a") {
		writeErr(w, http.StatusBadRequest, "разрешён только аудио-файл (mp3/wav/ogg/m4a)")
		return
	}

	// Сохраняем
	p := ringtonePath(s)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		writeErr(w, http.StatusInternalServerError, "не удалось создать директорию")
		return
	}
	tmp := p + ".tmp"
	dst, err := os.Create(tmp)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "не удалось создать файл")
		return
	}
	h := sha256.New()
	tr := io.TeeReader(file, h)
	if _, err := io.Copy(dst, tr); err != nil {
		dst.Close()
		os.Remove(tmp)
		writeErr(w, http.StatusInternalServerError, "не удалось сохранить файл")
		return
	}
	dst.Close()
	if err := os.Rename(tmp, p); err != nil {
		os.Remove(tmp)
		writeErr(w, http.StatusInternalServerError, "не удалось сохранить файл")
		return
	}
	hash := hex.EncodeToString(h.Sum(nil))
	// Публикуем событие для всех клиентов
	_ = s.Centi.Publish("ringtone", centrifugoEvent{
		Type: "ringtone.updated",
		Data: map[string]interface{}{
			"hash":       hash,
			"updated_at": time.Now().UTC().Format(time.RFC3339),
		},
	})
	// Также шлём push для офлайн-клиентов (если нужно — пока только centrifugo)
	writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "hash": hash})
}

func (s *Server) handleAdminDeleteRingtone(w http.ResponseWriter, r *http.Request) {
	p := ringtonePath(s)
	if _, err := os.Stat(p); err != nil {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	_ = os.Remove(p)
	_ = s.Centi.Publish("ringtone", centrifugoEvent{
		Type: "ringtone.updated",
		Data: map[string]interface{}{
			"hash":       "",
			"updated_at": time.Now().UTC().Format(time.RFC3339),
			"deleted":    true,
		},
	})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
