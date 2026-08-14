// Вложения сообщений: загрузка (multipart, максимум 100 МБ) и отдача.
// Файлы доступны только участникам канала (auth по query-параметру token —
// иначе <img>/<video> не смогли бы передать Authorization).
package api

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golosloom/server/internal/auth"
)

const maxFilenameLen = 200

// sanitizeFilename — безопасное имя файла: только базовое имя, без спецсимволов.
func sanitizeFilename(name string) string {
	name = filepath.Base(strings.TrimSpace(name))
	name = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 || strings.ContainsRune(`/\:*?"<>|`, r) {
			return '_'
		}
		return r
	}, name)
	if name == "." || name == "" {
		name = "file"
	}
	if len(name) > maxFilenameLen {
		ext := filepath.Ext(name)
		name = name[:maxFilenameLen-len(ext)] + ext
	}
	return name
}

func (s *Server) handleFileUpload(w http.ResponseWriter, r *http.Request) {
	channelID := pathID(r, "id")
	userID := userIDFrom(r)
	if !s.Store.IsMember(channelID, userID) {
		writeErr(w, http.StatusForbidden, "вы не участник канала")
		return
	}
	// Жёсткий лимит размера: не даёт загрузить больше MAX_FILE_SIZE.
	r.Body = http.MaxBytesReader(w, r.Body, s.Cfg.MaxFileSize)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeErr(w, http.StatusBadRequest, "не удалось прочитать файл")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "нет поля file")
		return
	}
	defer file.Close()

	filename := sanitizeFilename(header.Filename)
	mimeType := header.Header.Get("Content-Type")
	if mimeType == "" || strings.HasPrefix(mimeType, "application/octet-stream") {
		// Определяем тип по содержимому (первые 512 байт).
		buf := make([]byte, 512)
		n, _ := io.ReadFull(file, buf)
		if n > 0 {
			mimeType = http.DetectContentType(buf[:n])
			if _, err := file.Seek(0, io.SeekStart); err != nil {
				writeErr(w, http.StatusInternalServerError, "ошибка чтения файла")
				return
			}
		}
	}
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	// Уникальное имя на диске: случайный hex + исходное расширение.
	ext := filepath.Ext(filename)
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		writeErr(w, http.StatusInternalServerError, "ошибка генерации имени")
		return
	}
	stored := filepath.Join(s.Cfg.FilesDir, hex.EncodeToString(buf)+ext)
	if err := os.MkdirAll(s.Cfg.FilesDir, 0o755); err != nil {
		writeErr(w, http.StatusInternalServerError, "ошибка создания каталога")
		return
	}
	dst, err := os.Create(stored)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "ошибка сохранения файла")
		return
	}
	size, copyErr := io.Copy(dst, file)
	closeErr := dst.Close()
	if copyErr != nil || closeErr != nil {
		_ = os.Remove(stored)
		writeErr(w, http.StatusInternalServerError, "ошибка сохранения файла")
		return
	}

	f, err := s.Store.CreateFile(channelID, userID, filename, mimeType, stored, size)
	if err != nil {
		_ = os.Remove(stored)
		writeErr(w, http.StatusInternalServerError, "ошибка сохранения файла")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"id": f.ID, "filename": f.Filename, "mime": f.Mime, "size": f.Size,
	})
}

// handleFileToken выдаёт короткоживущий файловый токен (5 минут, scope=file).
// В URL файлов попадает только он — основной JWT никуда не утекает.
func (s *Server) handleFileToken(w http.ResponseWriter, r *http.Request) {
	t, err := auth.GenerateFileToken(userIDFrom(r), s.Cfg.JWTSecret)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "не удалось выпустить токен")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"token":      t,
		"expires_in": int(auth.FileTokenTTL.Seconds()),
	})
}

// handleFileGet — отдача файла участнику канала. Auth по короткоживущему
// ?token= (файловый токен, для <img>/<video> в браузере), ?download=1 —
// принудительное скачивание.
func (s *Server) handleFileGet(w http.ResponseWriter, r *http.Request) {
	fileID := pathID(r, "id")
	token := r.URL.Query().Get("token")
	// Только файловый токен: обычный JWT здесь не принимается.
	userID, err := auth.ParseFileToken(token, s.Cfg.JWTSecret)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "требуется авторизация")
		return
	}
	f, err := s.Store.GetFile(fileID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "файл не найден")
		return
	}
	// Админ сервера видит файлы любых каналов (админ-панель «Файлы»),
	// остальные — только участники канала.
	isAdmin := false
	if u, err := s.Store.GetUserByID(userID); err == nil {
		isAdmin = u.IsServerAdmin
	}
	if !isAdmin && !s.Store.IsMember(f.ChannelID, userID) {
		writeErr(w, http.StatusForbidden, "вы не участник канала")
		return
	}
	fh, err := os.Open(f.Path)
	if err != nil {
		writeErr(w, http.StatusNotFound, "файл не найден")
		return
	}
	defer fh.Close()
	// Браузер открывает в новой вкладке (просмотр), а не скачивает.
	disposition := "inline"
	if r.URL.Query().Get("download") == "1" {
		disposition = "attachment"
	}
	w.Header().Set("Content-Type", f.Mime)
	if ct := mime.TypeByExtension(filepath.Ext(f.Filename)); ct != "" && strings.HasPrefix(f.Mime, "application/octet-stream") {
		w.Header().Set("Content-Type", ct)
	}
	w.Header().Set("Content-Disposition", fmt.Sprintf(`%s; filename*=UTF-8''%s`, disposition, urlPathEscape(f.Filename)))
	w.Header().Set("Cache-Control", "private, max-age=3600")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", f.Size))
	mod := time.Time{}
	if st, err := fh.Stat(); err == nil {
		mod = st.ModTime()
	}
	http.ServeContent(w, r, f.Filename, mod, fh)
}

func urlPathEscape(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(s, " ", "%20"), "'", "%27")
}
