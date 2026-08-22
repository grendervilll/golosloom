// Package devices provides types for Signal Protocol device management.
// The server stores ONLY public keys — ratchet state lives only on clients.
package devices

import "time"

// Device represents a Signal Protocol device registration.
type Device struct {
	ID             int64     `json:"id"`
	UserID         int64     `json:"user_id"`
	DeviceID       string    `json:"device_id"`
	IdentityKey    []byte    `json:"identity_key"`    // 32 bytes, public X25519
	SignedPreKey   []byte    `json:"signed_pre_key"`  // 32 bytes
	CreatedAt      time.Time `json:"created_at"`
}

// OneTimePreKey represents a pool entry for Signal Protocol one-time pre-keys.
type OneTimePreKey struct {
	ID       int64  `json:"id"`
	UserID   int64  `json:"user_id"`
	DeviceID string `json:"device_id"`
	PreKey   []byte `json:"pre_key"` // 32 bytes
}

// RegisterDeviceRequest is the payload for POST /api/devices.
type RegisterDeviceRequest struct {
	DeviceID       string   `json:"device_id"`
	IdentityKey    []byte   `json:"identity_key"`
	SignedPreKey   []byte   `json:"signed_pre_key"`
	PreKeys        [][]byte `json:"pre_keys"` // pool of one-time pre-keys
}
