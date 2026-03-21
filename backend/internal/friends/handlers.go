// Package friends manages the friend-request lifecycle and the friends list.
package friends

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	mw "free2talk/backend/internal/middleware"
	"free2talk/backend/internal/validate"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	DB *pgxpool.Pool
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// FriendUser is the public projection of a user returned in friend contexts.
// Email is intentionally absent.
type FriendUser struct {
	ID           string `json:"id"`
	Username     string `json:"username"`
	DisplayName  string `json:"display_name"`
	LanguageCode string `json:"language_code"`
}

// SearchResult extends FriendUser with the current friendship state so the
// frontend can render the correct action button without a second request.
// FriendStatus values: "none" | "pending_sent" | "pending_received" | "accepted"
type SearchResult struct {
	FriendUser
	FriendStatus string `json:"friend_status"`
}

// SearchUsers handles GET /api/users/search?q=<username>
// Returns up to 20 users matching the query (partial, case-insensitive username
// prefix), annotated with the caller's current friendship status with each.
func (h *Handler) SearchUsers(w http.ResponseWriter, r *http.Request) {
	callerID := mw.GetUserID(r)
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeJSON(w, http.StatusOK, []SearchResult{})
		return
	}

	rows, err := h.DB.Query(context.Background(), `
		SELECT
			u.id::text,
			u.username,
			u.display_name,
			u.language_code,
			CASE
				WHEN f.id IS NULL THEN 'none'
				WHEN f.status = 'accepted' THEN 'accepted'
				WHEN f.sender_id = $1::uuid THEN 'pending_sent'
				ELSE 'pending_received'
			END AS friend_status
		FROM users u
		LEFT JOIN friendships f
			ON (f.sender_id = $1::uuid AND f.receiver_id = u.id)
			OR (f.receiver_id = $1::uuid AND f.sender_id = u.id)
		WHERE u.id != $1::uuid
		  AND u.username ILIKE $2
		ORDER BY u.username ASC
		LIMIT 20`,
		callerID, q+"%",
	)
	if err != nil {
		http.Error(w, "search failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	results := make([]SearchResult, 0)
	for rows.Next() {
		var sr SearchResult
		if err := rows.Scan(&sr.ID, &sr.Username, &sr.DisplayName, &sr.LanguageCode, &sr.FriendStatus); err != nil {
			continue
		}
		results = append(results, sr)
	}
	writeJSON(w, http.StatusOK, results)
}

type sendRequestBody struct {
	Username string `json:"username"`
}

// SendRequest handles POST /api/friends/request
// Body: { "username": "alice" }
// Creates a pending friendship row. Returns 409 if a relationship already exists.
func (h *Handler) SendRequest(w http.ResponseWriter, r *http.Request) {
	callerID := mw.GetUserID(r)

	r.Body = http.MaxBytesReader(w, r.Body, validate.MaxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()

	var body sendRequestBody
	if err := dec.Decode(&body); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	body.Username = strings.TrimSpace(strings.ToLower(body.Username))
	if body.Username == "" {
		http.Error(w, "username is required", http.StatusBadRequest)
		return
	}

	// Resolve username → ID.
	var targetID string
	err := h.DB.QueryRow(context.Background(),
		`SELECT id::text FROM users WHERE username = $1`, body.Username,
	).Scan(&targetID)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}

	if targetID == callerID {
		http.Error(w, "cannot send a friend request to yourself", http.StatusBadRequest)
		return
	}

	// Insert — unique constraint on (sender_id, receiver_id) catches duplicates.
	// We also check the reverse direction to prevent two-way pending rows.
	_, err = h.DB.Exec(context.Background(), `
		INSERT INTO friendships (sender_id, receiver_id)
		SELECT $1::uuid, $2::uuid
		WHERE NOT EXISTS (
			SELECT 1 FROM friendships
			WHERE (sender_id = $1::uuid AND receiver_id = $2::uuid)
			   OR (sender_id = $2::uuid AND receiver_id = $1::uuid)
		)`,
		callerID, targetID,
	)
	if err != nil {
		http.Error(w, "could not send request", http.StatusInternalServerError)
		return
	}

	// Check if the WHERE NOT EXISTS skipped the insert (relationship already exists).
	var exists bool
	h.DB.QueryRow(context.Background(), `
		SELECT EXISTS(
			SELECT 1 FROM friendships
			WHERE (sender_id = $1::uuid AND receiver_id = $2::uuid)
			   OR (sender_id = $2::uuid AND receiver_id = $1::uuid)
		)`, callerID, targetID,
	).Scan(&exists)
	// If the row was inserted it exists; if it already existed we get 409.
	// We distinguish by checking if a pending row from caller exists.
	var pendingExists bool
	h.DB.QueryRow(context.Background(), `
		SELECT EXISTS(
			SELECT 1 FROM friendships
			WHERE sender_id = $1::uuid AND receiver_id = $2::uuid
		)`, callerID, targetID,
	).Scan(&pendingExists)

	if !pendingExists {
		http.Error(w, "friend request already exists or you are already friends", http.StatusConflict)
		return
	}

	w.WriteHeader(http.StatusCreated)
}

// IncomingRequest is a pending request shown to the receiver.
type IncomingRequest struct {
	FriendshipID string `json:"friendship_id"`
	From         FriendUser `json:"from"`
}

// ListRequests handles GET /api/friends/requests
// Returns all pending incoming friend requests for the authenticated user.
func (h *Handler) ListRequests(w http.ResponseWriter, r *http.Request) {
	callerID := mw.GetUserID(r)

	rows, err := h.DB.Query(context.Background(), `
		SELECT f.id::text, u.id::text, u.username, u.display_name, u.language_code
		FROM friendships f
		JOIN users u ON u.id = f.sender_id
		WHERE f.receiver_id = $1::uuid AND f.status = 'pending'
		ORDER BY f.created_at DESC`,
		callerID,
	)
	if err != nil {
		http.Error(w, "query failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	requests := make([]IncomingRequest, 0)
	for rows.Next() {
		var req IncomingRequest
		if err := rows.Scan(
			&req.FriendshipID,
			&req.From.ID, &req.From.Username, &req.From.DisplayName, &req.From.LanguageCode,
		); err != nil {
			continue
		}
		requests = append(requests, req)
	}
	writeJSON(w, http.StatusOK, requests)
}

// AcceptRequest handles POST /api/friends/accept/{id}
// {id} is the friendship UUID. Only the receiver may accept.
func (h *Handler) AcceptRequest(w http.ResponseWriter, r *http.Request) {
	callerID := mw.GetUserID(r)
	friendshipID := chi.URLParam(r, "id")
	if err := validate.UUID(friendshipID); err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	ct, err := h.DB.Exec(context.Background(), `
		UPDATE friendships SET status = 'accepted'
		WHERE id = $1::uuid AND receiver_id = $2::uuid AND status = 'pending'`,
		friendshipID, callerID,
	)
	if err != nil || ct.RowsAffected() == 0 {
		http.Error(w, "request not found or already handled", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// DeclineOrRemove handles DELETE /api/friends/{id}
// {id} is the friendship UUID. Either party may call this — to decline a
// pending request or to remove an accepted friendship.
func (h *Handler) DeclineOrRemove(w http.ResponseWriter, r *http.Request) {
	callerID := mw.GetUserID(r)
	friendshipID := chi.URLParam(r, "id")
	if err := validate.UUID(friendshipID); err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	ct, err := h.DB.Exec(context.Background(), `
		DELETE FROM friendships
		WHERE id = $1::uuid
		  AND (sender_id = $2::uuid OR receiver_id = $2::uuid)`,
		friendshipID, callerID,
	)
	if err != nil || ct.RowsAffected() == 0 {
		http.Error(w, "friendship not found", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// RemoveByUser handles DELETE /api/friends/user/{user_id}
// Removes an accepted (or pending) friendship between the caller and the given user.
// The frontend uses this when unfriending from the conversation view, where only the
// peer's user ID is available — not the internal friendship row ID.
func (h *Handler) RemoveByUser(w http.ResponseWriter, r *http.Request) {
	callerID := mw.GetUserID(r)
	peerID := chi.URLParam(r, "user_id")
	if err := validate.UUID(peerID); err != nil {
		http.Error(w, "invalid user_id", http.StatusBadRequest)
		return
	}
	if peerID == callerID {
		http.Error(w, "cannot unfriend yourself", http.StatusBadRequest)
		return
	}

	ct, err := h.DB.Exec(context.Background(), `
		DELETE FROM friendships
		WHERE (sender_id = $1::uuid AND receiver_id = $2::uuid)
		   OR (sender_id = $2::uuid AND receiver_id = $1::uuid)`,
		callerID, peerID,
	)
	if err != nil || ct.RowsAffected() == 0 {
		http.Error(w, "friendship not found", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ListFriends handles GET /api/friends
// Returns accepted friends for the sidebar.
func (h *Handler) ListFriends(w http.ResponseWriter, r *http.Request) {
	callerID := mw.GetUserID(r)

	rows, err := h.DB.Query(context.Background(), `
		SELECT u.id::text, u.username, u.display_name, u.language_code
		FROM friendships f
		JOIN users u ON u.id = CASE
			WHEN f.sender_id = $1::uuid THEN f.receiver_id
			ELSE f.sender_id
		END
		WHERE (f.sender_id = $1::uuid OR f.receiver_id = $1::uuid)
		  AND f.status = 'accepted'
		ORDER BY u.display_name ASC`,
		callerID,
	)
	if err != nil {
		http.Error(w, "query failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	friends := make([]FriendUser, 0)
	for rows.Next() {
		var u FriendUser
		if err := rows.Scan(&u.ID, &u.Username, &u.DisplayName, &u.LanguageCode); err != nil {
			continue
		}
		friends = append(friends, u)
	}
	writeJSON(w, http.StatusOK, friends)
}
