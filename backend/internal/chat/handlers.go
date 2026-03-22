package chat

import (
	"context"
	"encoding/json"
	"log"
	"net/http"

	"free2talk/backend/internal/auth"
	"free2talk/backend/internal/models"
	mw "free2talk/backend/internal/middleware"
	"free2talk/backend/internal/translate"
	"free2talk/backend/internal/validate"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgxpool"
)

var prodOrigins = map[string]bool{
	"http://localhost:5173":  true,
	"http://localhost:3000":  true,
	"https://localhost:5173": true,
	"https://localhost:3000": true,
}

// Handler holds the shared dependencies for all chat endpoints.
type Handler struct {
	DB            *pgxpool.Pool
	Hub           *Hub
	Translate     *translate.Client
	DevMode       bool
	AllowedOrigin string // production domain e.g. "https://free2talk.example.com"
}

func (h *Handler) upgrader() *websocket.Upgrader {
	return &websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			if h.DevMode {
				return true // all origins allowed in dev
			}
			origin := r.Header.Get("Origin")
			if h.AllowedOrigin != "" && origin == h.AllowedOrigin {
				return true
			}
			return prodOrigins[origin]
		},
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// ServeWS upgrades an HTTP request to a WebSocket connection.
//
// SECURITY (F4): ALL validation happens before websocket.Upgrader.Upgrade is
// called. Once Upgrade succeeds the HTTP response has already been committed,
// so errors can no longer be reported via HTTP status codes. Reject early.
//
// Token transport: browsers cannot attach custom headers to WebSocket
// connections, so the JWT is passed as the ?token= query parameter. This is
// the standard workaround; the token is validated immediately and never stored
// or logged beyond what the JWT library already does.
func (h *Handler) ServeWS(w http.ResponseWriter, r *http.Request) {
	// 1. Read token from query param — browsers cannot set Authorization header on WS.
	tokenStr := r.URL.Query().Get("token")
	if tokenStr == "" {
		http.Error(w, "missing token", http.StatusUnauthorized)
		return
	}

	// 2. Validate JWT signature and algorithm (same parser as HTTP middleware).
	claims, err := auth.ParseToken(tokenStr)
	if err != nil {
		http.Error(w, "invalid or expired token", http.StatusUnauthorized)
		return
	}

	// 3. Verify the user still exists in the database.
	// Prevents a deleted user's token from opening a WebSocket session.
	var exists bool
	if err := h.DB.QueryRow(context.Background(),
		`SELECT EXISTS(SELECT 1 FROM users WHERE id = $1::uuid)`, claims.UserID,
	).Scan(&exists); err != nil || !exists {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	// 4. Upgrade to WebSocket (CheckOrigin is enforced inside Upgrade via the
	// upgrader's CheckOrigin func defined above).
	conn, err := h.upgrader().Upgrade(w, r, nil)
	if err != nil {
		// Upgrade already wrote an HTTP error response if it failed.
		log.Printf("ws upgrade error for user %s: %v", claims.UserID, err)
		return
	}

	client := &Client{
		userID: claims.UserID,
		conn:   conn,
		send:   make(chan []byte, sendBufferSize),
	}

	h.Hub.register <- client

	go client.writePump(h.Hub)
	go client.readPump(h.Hub)
}

// PublicUser is the shape returned by GET /api/users.
// Email is deliberately absent — see security requirement F5.
type PublicUser struct {
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
	LanguageCode string `json:"language_code"`
}

// ListUsers returns all users except the caller, exposing only the fields
// needed for the contact list (F5: no email addresses).
func (h *Handler) ListUsers(w http.ResponseWriter, r *http.Request) {
	callerID := mw.GetUserID(r)

	rows, err := h.DB.Query(context.Background(),
		`SELECT id::text, display_name, language_code
		 FROM users
		 WHERE id != $1::uuid
		 ORDER BY display_name ASC`,
		callerID,
	)
	if err != nil {
		http.Error(w, "failed to list users", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	users := make([]PublicUser, 0)
	for rows.Next() {
		var u PublicUser
		if err := rows.Scan(&u.ID, &u.DisplayName, &u.LanguageCode); err != nil {
			http.Error(w, "scan error", http.StatusInternalServerError)
			return
		}
		users = append(users, u)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "query error", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, users)
}

type sendMessageRequest struct {
	RecipientID string `json:"recipient_id"`
	Text        string `json:"text"`
}

// SendMessage stores a message and pushes it to the recipient's WebSocket if
// they are online. Translation is performed when sender and recipient have
// different language codes; on any translation error the original text is
// stored as-is (graceful degradation — no message is lost).
//
// SECURITY: sender_id is always taken from the JWT context (mw.GetUserID).
// The client cannot supply or forge a different sender identity.
func (h *Handler) SendMessage(w http.ResponseWriter, r *http.Request) {
	senderID := mw.GetUserID(r)

	r.Body = http.MaxBytesReader(w, r.Body, validate.MaxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()

	var req sendMessageRequest
	if err := dec.Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if err := validate.UUID(req.RecipientID); err != nil {
		http.Error(w, "invalid recipient_id", http.StatusBadRequest)
		return
	}

	if req.Text == "" {
		http.Error(w, "text is required", http.StatusBadRequest)
		return
	}

	// Enforce friendship: sender and recipient must be accepted friends.
	var areFriends bool
	err := h.DB.QueryRow(context.Background(), `
		SELECT EXISTS(
			SELECT 1 FROM friendships
			WHERE ((sender_id = $1::uuid AND receiver_id = $2::uuid)
			    OR (sender_id = $2::uuid AND receiver_id = $1::uuid))
			  AND status = 'accepted'
		)`, senderID, req.RecipientID,
	).Scan(&areFriends)
	if err != nil {
		http.Error(w, "database error", http.StatusInternalServerError)
		return
	}
	if !areFriends {
		http.Error(w, "you must be friends to send messages", http.StatusForbidden)
		return
	}

	// Look up both parties' languages in a single query.
	type langRow struct {
		id   string
		lang string
	}
	rows, err := h.DB.Query(context.Background(),
		`SELECT id::text, language_code FROM users WHERE id = $1::uuid OR id = $2::uuid`,
		senderID, req.RecipientID,
	)
	if err != nil {
		http.Error(w, "database error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	langs := make(map[string]string)
	for rows.Next() {
		var id, lang string
		if err := rows.Scan(&id, &lang); err != nil {
			http.Error(w, "scan error", http.StatusInternalServerError)
			return
		}
		langs[id] = lang
	}
	rows.Close()

	senderLang, senderOK := langs[senderID]
	recipientLang, recipientOK := langs[req.RecipientID]
	if !senderOK {
		http.Error(w, "sender not found", http.StatusInternalServerError)
		return
	}
	if !recipientOK {
		http.Error(w, "recipient not found", http.StatusNotFound)
		return
	}

	// Translate if languages differ; fall back to original on any error.
	translatedText := req.Text
	translationFailed := false
	if senderLang != recipientLang {
		t, err := h.Translate.Translate(req.Text, senderLang, recipientLang)
		if err != nil {
			log.Printf("translation error (falling back to original): %v", err)
			translationFailed = true
			// translatedText stays as req.Text — message is never lost
		} else {
			translatedText = t
		}
	}

	// Persist to DB and get the full row back (id, created_at generated by DB).
	var msg models.Message
	err = h.DB.QueryRow(context.Background(),
		`INSERT INTO messages
		   (sender_id, recipient_id, original_text, translated_text, source_lang, target_lang)
		 VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
		 RETURNING id::text, sender_id::text, recipient_id::text,
		           original_text, translated_text, source_lang, target_lang, created_at`,
		senderID, req.RecipientID, req.Text, translatedText, senderLang, recipientLang,
	).Scan(
		&msg.ID, &msg.SenderID, &msg.RecipientID,
		&msg.OriginalText, &msg.TranslatedText,
		&msg.SourceLang, &msg.TargetLang, &msg.CreatedAt,
	)
	if err != nil {
		http.Error(w, "failed to save message", http.StatusInternalServerError)
		return
	}

	// Push to recipient's WebSocket if they are online.
	// Wrap in a typed envelope so the frontend dispatcher can route by type.
	if payload, err := json.Marshal(map[string]any{
		"type":               "message",
		"id":                 msg.ID,
		"sender_id":          msg.SenderID,
		"recipient_id":       msg.RecipientID,
		"original_text":      msg.OriginalText,
		"translated_text":    msg.TranslatedText,
		"source_lang":        msg.SourceLang,
		"target_lang":        msg.TargetLang,
		"created_at":         msg.CreatedAt,
		"translation_failed": translationFailed,
	}); err == nil {
		h.Hub.Deliver(req.RecipientID, payload)
	}

	writeJSON(w, http.StatusCreated, msg)
}

// GetHistory returns up to 100 messages exchanged between the authenticated
// user and the user identified by {user_id} in the path.
//
// SECURITY (F3): The WHERE clause hard-enforces bidirectional ownership.
// A user can never retrieve messages from a conversation they are not part of.
// $1 is always the JWT caller; there is no way for a client to substitute a
// different value.
func (h *Handler) GetHistory(w http.ResponseWriter, r *http.Request) {
	callerID := mw.GetUserID(r)
	otherID := chi.URLParam(r, "user_id")

	if err := validate.UUID(otherID); err != nil {
		http.Error(w, "invalid user_id", http.StatusBadRequest)
		return
	}

	rows, err := h.DB.Query(context.Background(),
		`SELECT id::text, sender_id::text, recipient_id::text,
		        original_text, translated_text, source_lang, target_lang, created_at
		 FROM messages
		 WHERE (sender_id = $1::uuid AND recipient_id = $2::uuid)
		    OR (sender_id = $2::uuid AND recipient_id = $1::uuid)
		 ORDER BY created_at ASC
		 LIMIT 100`,
		callerID, otherID,
	)
	if err != nil {
		http.Error(w, "database error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	messages := make([]models.Message, 0)
	for rows.Next() {
		var m models.Message
		if err := rows.Scan(
			&m.ID, &m.SenderID, &m.RecipientID,
			&m.OriginalText, &m.TranslatedText,
			&m.SourceLang, &m.TargetLang, &m.CreatedAt,
		); err != nil {
			http.Error(w, "scan error", http.StatusInternalServerError)
			return
		}
		messages = append(messages, m)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "query error", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, messages)
}
