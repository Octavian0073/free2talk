// Package call manages video call initiation and state.
package call

import (
	"context"
	"encoding/json"
	"net/http"

	"free2talk/backend/internal/chat"
	mw "free2talk/backend/internal/middleware"
	"free2talk/backend/internal/validate"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	DB  *pgxpool.Pool
	Hub *chat.Hub
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

type initiateRequest struct {
	CalleeID string `json:"callee_id"`
}

// POST /api/calls
// Creates a call record (status=pending) and notifies the callee via WS.
// Both parties must be accepted friends.
func (h *Handler) InitiateCall(w http.ResponseWriter, r *http.Request) {
	callerID := mw.GetUserID(r)

	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()

	var req initiateRequest
	if err := dec.Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if err := validate.UUID(req.CalleeID); err != nil {
		http.Error(w, "invalid callee_id", http.StatusBadRequest)
		return
	}
	if req.CalleeID == callerID {
		http.Error(w, "cannot call yourself", http.StatusBadRequest)
		return
	}

	// Both parties must be accepted friends.
	var areFriends bool
	if err := h.DB.QueryRow(context.Background(), `
		SELECT EXISTS(
			SELECT 1 FROM friendships
			WHERE ((sender_id = $1::uuid AND receiver_id = $2::uuid)
			    OR (sender_id = $2::uuid AND receiver_id = $1::uuid))
			  AND status = 'accepted'
		)`, callerID, req.CalleeID,
	).Scan(&areFriends); err != nil || !areFriends {
		http.Error(w, "you must be friends to start a call", http.StatusForbidden)
		return
	}

	// Look up caller's display name for the notification.
	var callerName string
	if err := h.DB.QueryRow(context.Background(),
		`SELECT display_name FROM users WHERE id = $1::uuid`, callerID,
	).Scan(&callerName); err != nil {
		http.Error(w, "caller not found", http.StatusInternalServerError)
		return
	}

	// Persist the call record.
	var callID string
	if err := h.DB.QueryRow(context.Background(),
		`INSERT INTO calls (caller_id, callee_id, status)
		 VALUES ($1::uuid, $2::uuid, 'pending')
		 RETURNING id::text`,
		callerID, req.CalleeID,
	).Scan(&callID); err != nil {
		http.Error(w, "could not create call", http.StatusInternalServerError)
		return
	}

	// Notify callee via WebSocket. Fire-and-forget — callee may be offline.
	notification, _ := json.Marshal(map[string]any{
		"type":        "call_incoming",
		"call_id":     callID,
		"from_id":     callerID,
		"from_name":   callerName,
	})
	h.Hub.Deliver(req.CalleeID, notification)

	writeJSON(w, http.StatusCreated, map[string]string{"call_id": callID})
}

// PATCH /api/calls/{id}/end
// Sets the call status to ended and records ended_at.
// Either the caller or callee may call this endpoint.
func (h *Handler) EndCall(w http.ResponseWriter, r *http.Request) {
	callerID := mw.GetUserID(r)
	callID := chi.URLParam(r, "id")
	if err := validate.UUID(callID); err != nil {
		http.Error(w, "invalid call id", http.StatusBadRequest)
		return
	}

	ct, err := h.DB.Exec(context.Background(), `
		UPDATE calls
		SET status = 'ended', ended_at = now()
		WHERE id = $1::uuid
		  AND (caller_id = $2::uuid OR callee_id = $2::uuid)
		  AND status != 'ended'`,
		callID, callerID,
	)
	if err != nil || ct.RowsAffected() == 0 {
		http.Error(w, "call not found or already ended", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
