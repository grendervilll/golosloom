package api

import (
	"bytes"
	"io"
	"mime/multipart"
	"net/http"
	"testing"
)

func TestAdminStatsForbiddenForRegularUser(t *testing.T) {
	a := newTestApp(t, nil)
	a.register(t, "RealAdmin") // первый юзер теста — админ сервера
	u := a.register(t, "PlainUser")
	code, _ := a.do(t, http.MethodGet, "/api/admin/stats", u.token, nil)
	if code != http.StatusForbidden {
		t.Fatalf("статистика для обычного юзера: ожидали 403, получили %d", code)
	}
}

func TestAdminBackupRestoreRoundTrip(t *testing.T) {
	a := newTestApp(t, nil)
	admin := a.register(t, "Adm1n")
	if err := a.srv.Store.SetServerAdmin(admin.id, true); err != nil {
		t.Fatal(err)
	}
	u := a.register(t, "BackupUser")
	ch := a.mustChannel(t, u.token, "Бэкап-канал", false)
	a.sendMsg(t, u.token, ch, "сообщение в бэкап")

	// Скачиваем бэкап (сырые байты).
	req, _ := http.NewRequest(http.MethodGet, a.ts.URL+"/api/admin/backup", nil)
	req.Header.Set("Authorization", "Bearer "+admin.token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("бэкап: %d", resp.StatusCode)
	}
	if len(body) < 100 || !bytes.HasPrefix(body, []byte("SQLite format 3")) {
		t.Fatal("бэкап не похож на SQLite-файл")
	}

	// Удаляем сообщения, чтобы восстановление было заметно.
	if _, err := a.srv.Store.Exec("DELETE FROM messages"); err != nil {
		t.Fatal(err)
	}

	// Восстанавливаем из загруженного файла.
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, err := w.CreateFormFile("file", "backup.db")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fw.Write(body); err != nil {
		t.Fatal(err)
	}
	w.Close()
	req2, _ := http.NewRequest(http.MethodPost, a.ts.URL+"/api/admin/restore", &buf)
	req2.Header.Set("Authorization", "Bearer "+admin.token)
	req2.Header.Set("Content-Type", w.FormDataContentType())
	resp2, err := http.DefaultClient.Do(req2)
	if err != nil {
		t.Fatal(err)
	}
	resp2.Body.Close()
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("восстановление: %d", resp2.StatusCode)
	}
	n, err := a.srv.Store.CountMessages()
	if err != nil || n != 1 {
		t.Fatalf("после восстановления сообщений: %d (%v)", n, err)
	}
}

func TestAdminRestoreRejectsInvalidFile(t *testing.T) {
	a := newTestApp(t, nil)
	admin := a.register(t, "Adm1n2")
	if err := a.srv.Store.SetServerAdmin(admin.id, true); err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, _ := w.CreateFormFile("file", "fake.db")
	_, _ = fw.Write([]byte("это не база данных вообще"))
	w.Close()
	req, _ := http.NewRequest(http.MethodPost, a.ts.URL+"/api/admin/restore", &buf)
	req.Header.Set("Authorization", "Bearer "+admin.token)
	req.Header.Set("Content-Type", w.FormDataContentType())
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("невалидный файл: ожидали 400, получили %d", resp.StatusCode)
	}
}

func TestAdminStatsShape(t *testing.T) {
	a := newTestApp(t, nil)
	admin := a.register(t, "Adm1n3")
	if err := a.srv.Store.SetServerAdmin(admin.id, true); err != nil {
		t.Fatal(err)
	}
	code, raw := a.do(t, http.MethodGet, "/api/admin/stats", admin.token, nil)
	if code != http.StatusOK {
		t.Fatalf("статистика: %d", code)
	}
	stats := raw
	for _, key := range []string{"users", "channels", "messages", "online", "db_size", "uptime_sec"} {
		if _, exists := stats[key]; !exists {
			t.Fatalf("в статистике нет поля %s: %v", key, raw)
		}
	}
}
