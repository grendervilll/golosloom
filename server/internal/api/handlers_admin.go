// Админ-панель: мониторинг сервера, скачивание бэкапа базы данных
// и восстановление из загруженного файла. Доступно только админу сервера
// (роуты обёрнуты requireServerAdmin).
package api

import (
	"database/sql"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

func (s *Server) handleAdminStats(w http.ResponseWriter, r *http.Request) {
	users, _ := s.Store.CountUsers()
	channels, _ := s.Store.CountChannels()
	messages, _ := s.Store.CountMessages()
	calls, _ := s.Store.CountCalls()
	dbSize := int64(0)
	if fi, err := os.Stat(s.Cfg.DBPath); err == nil {
		dbSize = fi.Size()
	}
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"uptime_sec": int64(time.Since(s.startedAt).Seconds()),
		"version":    "1.2.0",
		"go":         runtime.Version(),
		"users":      users,
		"channels":   channels,
		"messages":   messages,
		"calls":      calls,
		"online":     s.Hub.OnlineCount(),
		"db_size":    dbSize,
		"mem_mb":     mem.Alloc / 1024 / 1024,
		"goroutines": runtime.NumGoroutine(),
	})
}

// handleAdminBackup отдаёт согласованный снапшот базы данных (VACUUM INTO).
func (s *Server) handleAdminBackup(w http.ResponseWriter, r *http.Request) {
	tmp := filepath.Join(os.TempDir(), fmt.Sprintf("golosloom-backup-%d.db", time.Now().Unix()))
	defer os.Remove(tmp)
	if err := s.Store.SnapshotTo(tmp); err != nil {
		writeErr(w, http.StatusInternalServerError, "не удалось создать бэкап: "+err.Error())
		return
	}
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="golosloom-backup-%s.db"`, time.Now().Format("20060102-150405")))
	w.Header().Set("Content-Type", "application/octet-stream")
	http.ServeFile(w, r, tmp)
}

// handleAdminRestore принимает загруженный файл бэкапа и разворачивает его.
func (s *Server) handleAdminRestore(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 512<<20) // 512 МБ
	file, _, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "файл не получен")
		return
	}
	defer file.Close()
	tmp := filepath.Join(os.TempDir(), fmt.Sprintf("golosloom-restore-%d.db", time.Now().Unix()))
	defer os.Remove(tmp)
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "не удалось сохранить файл")
		return
	}
	if _, err := io.Copy(out, file); err != nil {
		out.Close()
		writeErr(w, http.StatusBadRequest, "не удалось прочитать файл")
		return
	}
	out.Close()
	// Проверка: это SQLite-файл с нашей схемой.
	head := make([]byte, 16)
	if f, err := os.Open(tmp); err == nil {
		_, _ = f.Read(head)
		f.Close()
	}
	if string(head[:15]) != "SQLite format 3" {
		writeErr(w, http.StatusBadRequest, "файл не является базой данных SQLite")
		return
	}
	db, err := sql.Open("sqlite", tmp)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "файл не читается как база данных")
		return
	}
	var n int
	err = db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='users'`).Scan(&n)
	db.Close()
	if err != nil || n == 0 {
		writeErr(w, http.StatusBadRequest, "файл не похож на бэкап Golosloom (нет таблицы users)")
		return
	}
	if err := s.Store.RestoreFromFile(tmp); err != nil {
		writeErr(w, http.StatusInternalServerError, "не удалось восстановить базу: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
