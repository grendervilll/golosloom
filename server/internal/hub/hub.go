package hub

import (
	"encoding/json"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Event struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data,omitempty"`
}

func NewEvent(typ string, data interface{}) Event {
	raw, _ := json.Marshal(data)
	return Event{Type: typ, Data: raw}
}

type Client struct {
	Conn     *websocket.Conn
	UserID   int64
	Nick     string
	Send     chan []byte
	channels map[int64]bool
	mu       sync.Mutex
}

func (c *Client) JoinChannel(channelID int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.channels[channelID] = true
}

func (c *Client) LeaveChannel(channelID int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.channels, channelID)
}

func (c *Client) Channels() []int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]int64, 0, len(c.channels))
	for id := range c.channels {
		out = append(out, id)
	}
	return out
}

func NewClient(conn *websocket.Conn, userID int64, nick string) *Client {
	return &Client{
		Conn:     conn,
		UserID:   userID,
		Nick:     nick,
		Send:     make(chan []byte, 256),
		channels: map[int64]bool{},
	}
}

// Hub — менеджер WebSocket-подключений.
type Hub struct {
	mu        sync.RWMutex
	clients   map[*Client]bool
	byUser    map[int64]map[*Client]bool
	byChannel map[int64]map[*Client]bool
}

func New() *Hub {
	return &Hub{
		clients:   map[*Client]bool{},
		byUser:    map[int64]map[*Client]bool{},
		byChannel: map[int64]map[*Client]bool{},
	}
}

func (h *Hub) Add(c *Client, channelIDs []int64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.clients[c] = true
	if h.byUser[c.UserID] == nil {
		h.byUser[c.UserID] = map[*Client]bool{}
	}
	h.byUser[c.UserID][c] = true
	for _, id := range channelIDs {
		c.JoinChannel(id)
		if h.byChannel[id] == nil {
			h.byChannel[id] = map[*Client]bool{}
		}
		h.byChannel[id][c] = true
	}
}

func (h *Hub) Remove(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.clients, c)
	if users, ok := h.byUser[c.UserID]; ok {
		delete(users, c)
		if len(users) == 0 {
			delete(h.byUser, c.UserID)
		}
	}
	for _, id := range c.Channels() {
		if ch, ok := h.byChannel[id]; ok {
			delete(ch, c)
			if len(ch) == 0 {
				delete(h.byChannel, id)
			}
		}
	}
}

func (h *Hub) JoinChannel(c *Client, channelID int64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if !h.clients[c] {
		return
	}
	c.JoinChannel(channelID)
	if h.byChannel[channelID] == nil {
		h.byChannel[channelID] = map[*Client]bool{}
	}
	h.byChannel[channelID][c] = true
}

func (h *Hub) LeaveChannel(c *Client, channelID int64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	c.LeaveChannel(channelID)
	if ch, ok := h.byChannel[channelID]; ok {
		delete(ch, c)
	}
}

// IsOnline — есть ли у пользователя хотя бы одно активное подключение.
func (h *Hub) IsOnline(userID int64) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.byUser[userID]) > 0
}

// OnlineCount — сколько пользователей онлайн (хотя бы одно подключение).
func (h *Hub) OnlineCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.byUser)
}

func (h *Hub) OnlineUserIDs() []int64 {
	h.mu.RLock()
	defer h.mu.RUnlock()
	out := make([]int64, 0, len(h.byUser))
	for id := range h.byUser {
		out = append(out, id)
	}
	return out
}

func (h *Hub) SendToUser(userID int64, ev Event) {
	h.mu.RLock()
	clients := h.byUser[userID]
	buf, _ := json.Marshal(ev)
	targets := make([]*Client, 0, len(clients))
	for c := range clients {
		targets = append(targets, c)
	}
	h.mu.RUnlock()
	for _, c := range targets {
		select {
		case c.Send <- buf:
		default:
		}
	}
}

func (h *Hub) SendToChannel(channelID int64, ev Event) {
	h.mu.RLock()
	clients := h.byChannel[channelID]
	buf, _ := json.Marshal(ev)
	targets := make([]*Client, 0, len(clients))
	for c := range clients {
		targets = append(targets, c)
	}
	h.mu.RUnlock()
	for _, c := range targets {
		select {
		case c.Send <- buf:
		default:
		}
	}
}

// CloseUser закрывает все подключения пользователя, дожидаясь
// отправки накопленных сообщений (например, уведомления о бане).
func (h *Hub) CloseUser(userID int64) {
	h.mu.RLock()
	clients := h.byUser[userID]
	targets := make([]*Client, 0, len(clients))
	for c := range clients {
		targets = append(targets, c)
	}
	h.mu.RUnlock()
	for _, c := range targets {
		deadline := time.Now().Add(500 * time.Millisecond)
		for len(c.Send) > 0 && time.Now().Before(deadline) {
			time.Sleep(10 * time.Millisecond)
		}
		// Запас времени на фактическую запись в сокет writePump'ом.
		time.Sleep(150 * time.Millisecond)
		_ = c.Conn.Close()
	}
}
