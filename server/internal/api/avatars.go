// Аватары пользователей: файлы на диске (DATA_DIR/avatars/<userID>.jpg),
// раздаются публично (GET /api/avatars/{id}). Ограничение — 5 МБ.
package api

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const maxAvatarBytes = 5 << 20 // 5 МБ

// avatarPath возвращает путь к файлу аватара пользователя.
func (s *Server) avatarPath(userID int64) string {
	return filepath.Join(s.Cfg.AvatarDir, strconv.FormatInt(userID, 10)+".jpg")
}

// handleAvatarUpload — загрузка своего аватара (multipart, поле "file").
func (s *Server) handleAvatarUpload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxAvatarBytes+1024)
	file, _, err := r.FormFile("file")
	if err != nil {
		if strings.Contains(err.Error(), "request body too large") {
			writeErr(w, http.StatusRequestEntityTooLarge, "аватар слишком большой: максимум 5 МБ")
			return
		}
		writeErr(w, http.StatusBadRequest, "файл не получен (поле file)")
		return
	}
	defer file.Close()
	if err := os.MkdirAll(s.Cfg.AvatarDir, 0o755); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	tmp := s.avatarPath(userIDFrom(r)) + ".tmp"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	n, copyErr := io.Copy(out, io.LimitReader(file, maxAvatarBytes+1))
	out.Close()
	if copyErr != nil {
		os.Remove(tmp)
		writeErr(w, http.StatusInternalServerError, "не удалось сохранить аватар")
		return
	}
	if n > maxAvatarBytes {
		os.Remove(tmp)
		writeErr(w, http.StatusRequestEntityTooLarge, "аватар слишком большой: максимум 5 МБ")
		return
	}
	if err := os.Rename(tmp, s.avatarPath(userIDFrom(r))); err != nil {
		os.Remove(tmp)
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := s.Store.SetUserAvatarAt(userIDFrom(r)); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleAvatarDelete — удаление своего аватара.
func (s *Server) handleAvatarDelete(w http.ResponseWriter, r *http.Request) {
	_ = os.Remove(s.avatarPath(userIDFrom(r)))
	if err := s.Store.ClearUserAvatarAt(userIDFrom(r)); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleAvatarGet — публичная раздача аватара (для img-тегов и уведомлений).
func (s *Server) handleAvatarGet(w http.ResponseWriter, r *http.Request) {
	userID := pathID(r, "userID")
	path := s.avatarPath(userID)
	if _, err := os.Stat(path); err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeFile(w, r, path)
}
