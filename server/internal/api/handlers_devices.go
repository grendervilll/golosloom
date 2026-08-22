package api

import (
	"net/http"
	"strconv"

	"golosloom/server/internal/devices"
)

// handleRegisterDevice — POST /api/devices
// Registers a Signal Protocol device with identity key, signed pre-key,
// and a batch of one-time pre-keys.
func (s *Server) handleRegisterDevice(w http.ResponseWriter, r *http.Request) {
	var req devices.RegisterDeviceRequest
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "некорректный запрос")
		return
	}
	if req.DeviceID == "" || len(req.IdentityKey) == 0 || len(req.SignedPreKey) == 0 {
		writeErr(w, http.StatusBadRequest, "device_id, identity_key и signed_pre_key обязательны")
		return
	}
	if len(req.PreKeys) == 0 {
		writeErr(w, http.StatusBadRequest, "необходимо загрузить хотя бы один pre-key")
		return
	}
	userID := userIDFrom(r)
	if err := s.Store.RegisterSignalDevice(userID, req.DeviceID, req.IdentityKey, req.SignedPreKey, req.PreKeys); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Notify other devices of the user about the new device registration.
	s.publishUser(userID, centrifugoEvent{
		Type: "device.registered",
		Data: map[string]interface{}{
			"user_id":   userID,
			"device_id": req.DeviceID,
		},
	})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleDeleteDevice — DELETE /api/devices/{device_id}
// Deletes a Signal Protocol device and its one-time pre-keys.
func (s *Server) handleDeleteDevice(w http.ResponseWriter, r *http.Request) {
	deviceID := r.PathValue("device_id")
	if deviceID == "" {
		writeErr(w, http.StatusBadRequest, "device_id обязателен")
		return
	}
	userID := userIDFrom(r)
	if err := s.Store.DeleteSignalDevice(userID, deviceID); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleListUserDevices — GET /api/users/{id}/devices
// Lists all Signal Protocol devices for a user (public keys only).
func (s *Server) handleListUserDevices(w http.ResponseWriter, r *http.Request) {
	targetID := pathID(r, "id")
	if targetID == 0 {
		writeErr(w, http.StatusBadRequest, "неверный id")
		return
	}
	devs, err := s.Store.ListUserSignalDevices(targetID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, devs)
}

// handleConsumePreKey — GET /api/devices/{device_id}/prekey
// Atomically consumes one one-time pre-key for the given device.
func (s *Server) handleConsumePreKey(w http.ResponseWriter, r *http.Request) {
	deviceID := r.PathValue("device_id")
	if deviceID == "" {
		writeErr(w, http.StatusBadRequest, "device_id обязателен")
		return
	}
	// The pre-key belongs to the device owner, not the requester.
	// The client specifies the target user_id in query params.
	var targetUserID int64
	if v := r.URL.Query().Get("user_id"); v != "" {
		targetUserID, _ = strconv.ParseInt(v, 10, 64)
	}
	if targetUserID == 0 {
		targetUserID = userIDFrom(r) // default to self
	}
	preKey, err := s.Store.ConsumeOneTimePreKey(targetUserID, deviceID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "нет доступных pre-ключей")
		return
	}
	// Check if pool is low and notify the device owner to replenish.
	count, _ := s.Store.PreKeyCount(targetUserID, deviceID)
	if count < 20 {
		s.publishUser(targetUserID, centrifugoEvent{
			Type: "session.needed",
			Data: map[string]interface{}{
				"user_id":   targetUserID,
				"device_id": deviceID,
				"remaining": count,
			},
		})
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"pre_key": preKey,
	})
}

// handleUploadPreKeys — POST /api/devices/{device_id}/prekeys
// Uploads new batch of one-time pre-keys for replenishment.
func (s *Server) handleUploadPreKeys(w http.ResponseWriter, r *http.Request) {
	deviceID := r.PathValue("device_id")
	if deviceID == "" {
		writeErr(w, http.StatusBadRequest, "device_id обязателен")
		return
	}
	var req struct {
		PreKeys [][]byte `json:"pre_keys"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "некорректный запрос")
		return
	}
	if len(req.PreKeys) == 0 {
		writeErr(w, http.StatusBadRequest, "pre_keys не может быть пустым")
		return
	}
	// Verify the device belongs to the authenticated user.
	userID := userIDFrom(r)
	if _, err := s.Store.GetSignalDevice(userID, deviceID); err != nil {
		writeErr(w, http.StatusForbidden, "устройство не найдено")
		return
	}
	if err := s.Store.UploadOneTimePreKeys(userID, deviceID, req.PreKeys); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
