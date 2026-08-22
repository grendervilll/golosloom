// Package centrifugo provides an HTTP client for publishing events to
// Centrifugo via its HTTP API. The Go server acts as a publisher —
// clients are subscribers. No centrifuge-go library needed.
package centrifugo

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type Client struct {
	baseURL    string // http://centrifugo:8000
	apiKey     string
	httpClient *http.Client
}

func New(baseURL, apiKey string) *Client {
	return &Client{
		baseURL:    baseURL,
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
}

type apiRequest struct {
	Method string          `json:"method"`
	Params json.RawMessage `json:"params,omitempty"`
}

type apiResponse struct {
	Result json.RawMessage `json:"result"`
	Error  string          `json:"error"`
}

// Publish sends an event to a Centrifugo channel via the HTTP API.
func (c *Client) Publish(channel string, data interface{}) error {
	raw, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("centrifugo publish: marshal data: %w", err)
	}
	params, _ := json.Marshal(map[string]interface{}{
		"channel": channel,
		"data":    json.RawMessage(raw),
	})
	return c.do("publish", params)
}

// Broadcast sends the same event to multiple channels.
func (c *Client) Broadcast(channels []string, data interface{}) error {
	raw, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("centrifugo broadcast: marshal data: %w", err)
	}
	params, _ := json.Marshal(map[string]interface{}{
		"channels": channels,
		"data":     json.RawMessage(raw),
	})
	return c.do("broadcast", params)
}

// Disconnect forces disconnection of all client connections for a user.
// Used on ban, logout, device deletion.
func (c *Client) Disconnect(userID string) error {
	params, _ := json.Marshal(map[string]interface{}{
		"user": userID,
	})
	return c.do("disconnect", params)
}

func (c *Client) do(method string, params json.RawMessage) error {
	body, _ := json.Marshal(apiRequest{Method: method, Params: params})
	req, err := http.NewRequest(http.MethodPost, c.baseURL+"/api", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("centrifugo %s: %w", method, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("centrifugo %s: %d %s", method, resp.StatusCode, string(b))
	}

	var apiResp apiResponse
	if err := json.NewDecoder(resp.Body).Decode(&apiResp); err != nil {
		return fmt.Errorf("centrifugo %s: decode response: %w", method, err)
	}
	if apiResp.Error != "" {
		return fmt.Errorf("centrifugo %s: %s", method, apiResp.Error)
	}
	return nil
}
