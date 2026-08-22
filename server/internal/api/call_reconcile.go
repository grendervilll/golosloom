// Сверка участников звонка с фактическим составом комнаты LiveKit.
// Решает «зомби»: приложение убито/сеть пропала — POST leave не ушёл,
// а WS-страж не сработал (второе подключение). Раз в 30 секунд сервер
// спрашивает LiveKit, кто реально в комнате, и убирает отсутствующих
// (с грацией 60 секунд — чтобы не выкинуть при кратковременном блупе).
package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"golosloom/server/internal/livekit"
)

func (s *Server) startCallReconciler() {
	if s.Cfg.LiveKitAPIKey == "" || s.Cfg.LiveKitAPISecret == "" {
		return
	}
	go func() {
		absent := map[int64]time.Time{}
		var mu sync.Mutex
		t := time.NewTicker(30 * time.Second)
		defer t.Stop()
		for range t.C {
			func() {
				mu.Lock()
				defer mu.Unlock()
				s.reconcileCalls(absent)
			}()
		}
	}()
}

func (s *Server) reconcileCalls(absent map[int64]time.Time) {
	calls, err := s.Store.ActiveCalls()
	if err != nil {
		return
	}
	now := time.Now()
	for _, c := range calls {
		ids, err := s.Store.CallParticipantIDs(c.ID)
		if err != nil || len(ids) == 0 {
			continue
		}
		present := s.livekitRoomUserIDs(c.ID)
		var remove []int64
		for _, uid := range ids {
			if present[uid] {
				delete(absent, uid)
				continue
			}
			last, ok := absent[uid]
			if !ok {
				absent[uid] = now
				continue
			}
			if now.Sub(last) > 60*time.Second {
				remove = append(remove, uid)
			}
		}
		if len(remove) == 0 {
			// Даже без удаления: одиночный звонок (в комнате один участник,
			// никто не ждёт ответа) завершаем автоматически.
			presentCount := 0
			for _, uid := range ids {
				if present[uid] {
					presentCount++
				}
			}
			if presentCount <= 1 {
				ringing, _ := s.Store.RingingInvites(c.ID)
				if presentCount == 0 || len(ringing) == 0 {
					s.maybeFinishSoloCall(&c)
					continue
				}
			}
			continue
		}
		for _, uid := range remove {
			delete(absent, uid)
			_ = s.Store.RemoveCallParticipant(c.ID, uid)
		}
		s.maybeFinishSoloCall(&c)
		if c2, err := s.Store.GetCall(c.ID); err == nil && c2.Status != "ended" {
			s.publishChannel(c2.ChannelID, centrifugoEvent{
				Type: "call.participants",
				Data: map[string]interface{}{
					"call_id": c2.ID, "participants": mustParticipantIDs(s, c2.ID),
				},
			})
		}
	}
}

func mustParticipantIDs(s *Server, callID int64) []int64 {
	ids, _ := s.Store.CallParticipantIDs(callID)
	return ids
}

// livekitRoomUserIDs — множество userID участников комнаты по данным LiveKit.
func (s *Server) livekitRoomUserIDs(callID int64) map[int64]bool {
	out := map[int64]bool{}
	room := "call-" + itoa(callID)
	token, err := livekit.RoomAdminToken(s.Cfg.LiveKitAPIKey, s.Cfg.LiveKitAPISecret,
		room, 2*time.Minute)
	if err != nil {
		return out
	}
	base := s.Cfg.LiveKitURL
	base = strings.Replace(base, "wss://", "https://", 1)
	base = strings.Replace(base, "ws://", "http://", 1)
	body, _ := json.Marshal(map[string]string{"room": room})
	req, err := http.NewRequest(http.MethodPost,
		strings.TrimRight(base, "/")+"/twirp/livekit.RoomService/ListParticipants",
		bytes.NewReader(body))
	if err != nil {
		return out
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
	if err != nil {
		return out
	}
	defer resp.Body.Close()
	var data struct {
		Participants []struct {
			Identity string `json:"identity"`
		} `json:"participants"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return out
	}
	for _, p := range data.Participants {
		// identity = "<userID>:<deviceID>"
		if i := strings.IndexByte(p.Identity, ':'); i > 0 {
			var uid int64
			if _, err := fmt.Sscanf(p.Identity[:i], "%d", &uid); err == nil {
				out[uid] = true
			}
		}
	}
	return out
}
