// Тесты вложений: загрузка, привязка к сообщению, раздача по токену,
// удаление файла вместе с сообщением.
package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strconv"
	"testing"

	"golosloom/server/internal/config"
)

func (a *testApp) getFile(t *testing.T, fileID int64, token string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, a.ts.URL+"/api/files/"+strconv.FormatInt(fileID, 10)+"?token="+token, nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

// fileToken запрашивает короткоживущий файловый токен (как клиент).
func (a *testApp) fileToken(t *testing.T, token string) string {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, a.ts.URL+"/api/files/token", nil)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("файловый токен: %d", resp.StatusCode)
	}
	var out map[string]interface{}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	tk, _ := out["token"].(string)
	if tk == "" {
		t.Fatal("пустой файловый токен")
	}
	return tk
}

func uploadFile(a *testApp, t *testing.T, token string, channelID int64, name string, content []byte) (int, map[string]interface{}) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="%s"`, name))
	h.Set("Content-Type", "text/plain")
	fw, _ := mw.CreatePart(h)
	_, _ = fw.Write(content)
	_ = mw.Close()
	req, err := http.NewRequest(http.MethodPost, a.ts.URL+"/api/channels/"+strconv.FormatInt(channelID, 10)+"/files", &buf)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]interface{}
	if resp.StatusCode == http.StatusCreated {
		_ = json.NewDecoder(resp.Body).Decode(&out)
	} else {
		b := new(bytes.Buffer)
		_, _ = b.ReadFrom(resp.Body)
		t.Logf("upload %d: %s", resp.StatusCode, b.String())
	}
	return resp.StatusCode, out
}

func TestFileUploadAttachSendDelete(t *testing.T) {
	a := newTestApp(t, nil)
	u := a.register(t, "FileUser")
	ch := a.mustChannel(t, u.token, "files", false)
	other := a.register(t, "FileOther")
	a.join(t, other.token, ch)

	// Без токена — 401.
	// Без токена — 401.
	if code, _ := uploadFile(a, t, "", ch, "a.txt", []byte("hello")); code != http.StatusUnauthorized {
		t.Fatalf("загрузка без токена: %d", code)
	}
	// Успешная загрузка.
	code, f := uploadFile(a, t, u.token, ch, "привет.txt", []byte("hello world"))
	if code != http.StatusCreated {
		t.Fatalf("загрузка: %d", code)
	}
	fileID := int64(f["id"].(float64))
	if f["filename"] != "привет.txt" {
		t.Fatalf("имя файла: %v", f["filename"])
	}

	// Отдача файла по ?token= участнику канала (файловый токен).
	uFileToken := a.fileToken(t, u.token)
	resp := a.getFile(t, fileID, uFileToken)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("отдача файла: %d", resp.StatusCode)
	}
	body := new(bytes.Buffer)
	_, _ = body.ReadFrom(resp.Body)
	resp.Body.Close()
	if body.String() != "hello world" {
		t.Fatalf("содержимое файла: %q", body.String())
	}
	if ct := resp.Header.Get("Content-Type"); ct == "" {
		t.Fatalf("нет Content-Type")
	}

	// Основной JWT в URL файла НЕ принимается (только файловый токен).
	resp = a.getFile(t, fileID, u.token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("основной токен в URL: ожидали 401, получили %d", resp.StatusCode)
	}

	// Посторонний (не участник канала) — 403 даже с валидным файловым токеном.
	outsider := a.register(t, "FileOutsider")
	outToken := a.fileToken(t, outsider.token)
	resp = a.getFile(t, fileID, outToken)
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("посторонний: ожидали 403, получили %d", resp.StatusCode)
	}
	// Без токена — 401.
	resp = a.getFile(t, fileID, "")
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("без токена: ожидали 401, получили %d", resp.StatusCode)
	}

	// Привязка к сообщению (отправитель — владелец файла).
	code, msg := a.do(t, http.MethodPost, "/api/channels/"+strconv.FormatInt(ch, 10)+"/messages", u.token,
		map[string]interface{}{"ciphertext": b64("с файлом"), "iv": "aXY=", "attachment_id": fileID, "protocol_version": 2})
	if code != http.StatusCreated {
		t.Fatalf("отправка с файлом: %d", code)
	}
	att, ok := msg["attachment"].(map[string]interface{})
	if !ok || int64(att["id"].(float64)) != fileID {
		t.Fatalf("attachment в ответе: %v", msg["attachment"])
	}
	mid := int64(msg["id"].(float64))

	// В истории сообщение приходит с attachment.
	_, list := a.doList(t, http.MethodGet, "/api/channels/"+strconv.FormatInt(ch, 10)+"/messages", u.token, nil)
	found := false
	for _, item := range list {
		m := item.(map[string]interface{})
		if int64(m["id"].(float64)) == mid {
			if m["attachment"] == nil {
				t.Fatalf("в истории нет attachment")
			}
			found = true
		}
	}
	if !found {
		t.Fatalf("сообщение с файлом не найдено в истории")
	}

	// Повторная привязка того же файла — 403 (файл уже занят).
	code, _ = a.do(t, http.MethodPost, "/api/channels/"+strconv.FormatInt(ch, 10)+"/messages", u.token,
		map[string]interface{}{"ciphertext": b64("дубль"), "iv": "aXY=", "attachment_id": fileID, "protocol_version": 2})
	if code != http.StatusForbidden {
		t.Fatalf("повторная привязка: ожидали 403, получили %d", code)
	}

	// Файл чужого пользователя привязать нельзя.
	_, f2 := uploadFile(a, t, other.token, ch, "b.txt", []byte("other"))
	fileID2 := int64(f2["id"].(float64))
	code, _ = a.do(t, http.MethodPost, "/api/channels/"+strconv.FormatInt(ch, 10)+"/messages", u.token,
		map[string]interface{}{"ciphertext": b64("чужой"), "iv": "aXY=", "attachment_id": fileID2, "protocol_version": 2})
	if code != http.StatusForbidden {
		t.Fatalf("чужой файл: ожидали 403, получили %d", code)
	}

	// Удаление сообщения удаляет и файл (404 при раздаче).
	code, _ = a.do(t, http.MethodDelete, "/api/channels/"+strconv.FormatInt(ch, 10)+"/messages/"+strconv.FormatInt(mid, 10), u.token, nil)
	if code != http.StatusOK {
		t.Fatalf("удаление сообщения: %d", code)
	}
	resp = a.getFile(t, fileID, a.fileToken(t, u.token))
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("файл после удаления сообщения: ожидали 404, получили %d", resp.StatusCode)
	}
}

func TestFileUploadMaxSize(t *testing.T) {
	a := newTestApp(t, func(cfg *config.Config) { cfg.MaxFileSize = 1024 })
	u := a.register(t, "BigFile")
	ch := a.mustChannel(t, u.token, "big", false)

	// Маленький файл — ок.
	if code, _ := uploadFile(a, t, u.token, ch, "small.txt", []byte("ok")); code != http.StatusCreated {
		t.Fatalf("маленький файл: %d", code)
	}
	// Больше лимита (1024 байта) — ошибка.
	big := bytes.Repeat([]byte("x"), 2048)
	if code, _ := uploadFile(a, t, u.token, ch, "big.txt", big); code != http.StatusBadRequest {
		t.Fatalf("большой файл: ожидали 400, получили %d", code)
	}
}
