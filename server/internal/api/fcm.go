// FCM-гейтвей (Firebase Cloud Messaging HTTP v1): отправка нативных пушей.
// Требует файл сервисного аккаунта Firebase (Console → Project settings →
// Service accounts → Generate new private key), путь — FCM_SERVICE_ACCOUNT_FILE.
// Без файла гейтвей не создаётся, пуши работают только Web Push.
package api

import (
	"bytes"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

var errFcmGone = errors.New("fcm token invalid")

type serviceAccount struct {
	ClientEmail string `json:"client_email"`
	PrivateKey  string `json:"private_key"`
	ProjectID   string `json:"project_id"`
}

type fcmGateway struct {
	mu       sync.Mutex
	sa       *serviceAccount
	oauth    string
	oauthExp time.Time
	http     *http.Client
}

func newFcmGateway(path string) *fcmGateway {
	if path == "" {
		return nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var sa serviceAccount
	if err := json.Unmarshal(data, &sa); err != nil || sa.ClientEmail == "" || sa.PrivateKey == "" || sa.ProjectID == "" {
		return nil
	}
	return &fcmGateway{sa: &sa, http: &http.Client{Timeout: 10 * time.Second}}
}

// send отправляет уведомление на FCM-токен. Возвращает errFcmGone,
// если токен мёртв (его нужно удалить).
func (g *fcmGateway) send(token, title, body, tag string) error {
	at, err := g.accessToken()
	if err != nil {
		return err
	}
	payload := map[string]interface{}{
		"message": map[string]interface{}{
			"token":        token,
			"notification": map[string]string{"title": title, "body": body},
			"data":         map[string]string{"tag": tag},
		},
	}
	raw, _ := json.Marshal(payload)
	url := fmt.Sprintf("https://fcm.googleapis.com/v1/projects/%s/messages:send", g.sa.ProjectID)
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+at)
	req.Header.Set("Content-Type", "application/json")
	resp, err := g.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusOK {
		return nil
	}
	bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
	msg := string(bodyBytes)
	// Мёртвые токены: 404, либо UNREGISTERED/INVALID_ARGUMENT.
	if resp.StatusCode == http.StatusNotFound ||
		strings.Contains(msg, "UNREGISTERED") ||
		strings.Contains(msg, "INVALID_ARGUMENT") {
		return errFcmGone
	}
	return fmt.Errorf("fcm: %d %s", resp.StatusCode, msg)
}

// accessToken — OAuth-токен через JWT-обмен (RS256).
func (g *fcmGateway) accessToken() (string, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.oauth != "" && time.Now().Before(g.oauthExp.Add(-2*time.Minute)) {
		return g.oauth, nil
	}
	key, err := g.parsePrivateKey()
	if err != nil {
		return "", err
	}
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256","typ":"JWT"}`))
	claims, _ := json.Marshal(map[string]interface{}{
		"iss":   g.sa.ClientEmail,
		"scope": "https://www.googleapis.com/auth/firebase.messaging",
		"aud":   "https://oauth2.googleapis.com/token",
		"iat":   time.Now().Unix(),
		"exp":   time.Now().Add(time.Hour).Unix(),
	})
	payload := base64.RawURLEncoding.EncodeToString(claims)
	digest := sha256.Sum256([]byte(header + "." + payload))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		return "", err
	}
	assertion := header + "." + payload + "." + base64.RawURLEncoding.EncodeToString(sig)

	form := url.Values{
		"grant_type": {"urn:ietf:params:oauth:grant-type:jwt-bearer"},
		"assertion":  {assertion},
	}
	resp, err := g.http.PostForm("https://oauth2.googleapis.com/token", form)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("oauth: %d", resp.StatusCode)
	}
	var out struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int64  `json:"expires_in"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	g.oauth = out.AccessToken
	g.oauthExp = time.Now().Add(time.Duration(out.ExpiresIn) * time.Second)
	return g.oauth, nil
}

func (g *fcmGateway) parsePrivateKey() (*rsa.PrivateKey, error) {
	block, _ := pem.Decode([]byte(g.sa.PrivateKey))
	if block == nil {
		return nil, errors.New("fcm: некорректный приватный ключ")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	key, ok := parsed.(*rsa.PrivateKey)
	if !ok {
		return nil, errors.New("fcm: ключ не RSA")
	}
	return key, nil
}
