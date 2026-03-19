package admin

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	mw "free2talk/backend/internal/middleware"
	"free2talk/backend/internal/validate"

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

// StatsResponse is the admin overview payload.
type StatsResponse struct {
	TotalUsers    int `json:"total_users"`
	TotalMessages int `json:"total_messages"`
	TotalCalls    int `json:"total_calls"`
	ActiveCalls   int `json:"active_calls"`
}

// GET /api/admin/stats
func (h *Handler) Stats(w http.ResponseWriter, r *http.Request) {
	var s StatsResponse
	row := h.DB.QueryRow(context.Background(), `
		SELECT
			(SELECT COUNT(*) FROM users)                         AS total_users,
			(SELECT COUNT(*) FROM messages)                      AS total_messages,
			(SELECT COUNT(*) FROM calls)                         AS total_calls,
			(SELECT COUNT(*) FROM calls WHERE ended_at IS NULL)  AS active_calls
	`)
	if err := row.Scan(&s.TotalUsers, &s.TotalMessages, &s.TotalCalls, &s.ActiveCalls); err != nil {
		http.Error(w, "query failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, s)
}

// UserRecord is a safe user projection for admin (no password hash exposed).
type UserRecord struct {
	ID           string    `json:"id"`
	Email        string    `json:"email"`
	Username     string    `json:"username"`
	DisplayName  string    `json:"display_name"`
	LanguageCode string    `json:"language_code"`
	IsAdmin      bool      `json:"is_admin"`
	CreatedAt    time.Time `json:"created_at"`
}

// GET /api/admin/users
func (h *Handler) ListUsers(w http.ResponseWriter, r *http.Request) {
	rows, err := h.DB.Query(context.Background(),
		`SELECT id::text, email, username, display_name, language_code, is_admin, created_at
		 FROM users ORDER BY created_at DESC LIMIT 200`,
	)
	if err != nil {
		http.Error(w, "query failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	users := make([]UserRecord, 0)
	for rows.Next() {
		var u UserRecord
		if err := rows.Scan(&u.ID, &u.Email, &u.Username, &u.DisplayName, &u.LanguageCode, &u.IsAdmin, &u.CreatedAt); err != nil {
			continue
		}
		users = append(users, u)
	}
	writeJSON(w, http.StatusOK, users)
}

// PUT /api/admin/users/{id}/toggle-admin
// SECURITY: The acting admin's own ID is read from the JWT (not the request).
// We validate the target ID format before any DB operation.
// An admin cannot revoke their own admin status (enforced here AND on the frontend).
func (h *Handler) ToggleAdmin(w http.ResponseWriter, r *http.Request) {
	targetID := r.PathValue("id")
	if err := validate.UUID(targetID); err != nil {
		http.Error(w, "invalid user id", http.StatusBadRequest)
		return
	}

	// Prevent self-demotion — an admin cannot remove their own admin flag.
	actingAdminID := mw.GetUserID(r)
	if targetID == actingAdminID {
		http.Error(w, "cannot change your own admin status", http.StatusForbidden)
		return
	}

	var u UserRecord
	err := h.DB.QueryRow(context.Background(),
		`UPDATE users SET is_admin = NOT is_admin WHERE id = $1::uuid
		 RETURNING id::text, email, username, display_name, language_code, is_admin, created_at`,
		targetID,
	).Scan(&u.ID, &u.Email, &u.Username, &u.DisplayName, &u.LanguageCode, &u.IsAdmin, &u.CreatedAt)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}

	action := "grant_admin"
	if !u.IsAdmin {
		action = "revoke_admin"
	}
	writeAudit(h.DB, actingAdminID, action, targetID, u.Email, r)

	writeJSON(w, http.StatusOK, u)
}

// DELETE /api/admin/users/{id}
// SECURITY: Validates UUID format. Prevents self-deletion.
func (h *Handler) DeleteUser(w http.ResponseWriter, r *http.Request) {
	targetID := r.PathValue("id")
	if err := validate.UUID(targetID); err != nil {
		http.Error(w, "invalid user id", http.StatusBadRequest)
		return
	}

	actingAdminID := mw.GetUserID(r)
	if targetID == actingAdminID {
		http.Error(w, "cannot delete your own account via admin panel", http.StatusForbidden)
		return
	}

	// Capture the target's email for the audit record before deleting.
	var targetEmail string
	_ = h.DB.QueryRow(context.Background(),
		`SELECT email FROM users WHERE id = $1::uuid`, targetID,
	).Scan(&targetEmail)

	ct, err := h.DB.Exec(context.Background(),
		`DELETE FROM users WHERE id = $1::uuid`, targetID,
	)
	if err != nil || ct.RowsAffected() == 0 {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}

	writeAudit(h.DB, actingAdminID, "delete_user", targetID, targetEmail, r)
	w.WriteHeader(http.StatusNoContent)
}

// MessageRecord for admin inspection.
type MessageRecord struct {
	ID             string    `json:"id"`
	SenderID       string    `json:"sender_id"`
	SenderName     string    `json:"sender_name"`
	RecipientID    string    `json:"recipient_id"`
	RecipientName  string    `json:"recipient_name"`
	OriginalText   string    `json:"original_text"`
	TranslatedText string    `json:"translated_text"`
	SourceLang     string    `json:"source_lang"`
	TargetLang     string    `json:"target_lang"`
	CreatedAt      time.Time `json:"created_at"`
}

// AuditEntry is a single row from admin_audit_log.
type AuditEntry struct {
	ID        string `json:"id"`
	AdminID   string `json:"admin_id"`
	AdminName string `json:"admin_name"`
	Action    string `json:"action"`
	TargetID  string `json:"target_id"`
	Detail    string `json:"detail"`
	IPAddress string `json:"ip_address"`
	CreatedAt string `json:"created_at"`
}

// GET /api/admin/audit
func (h *Handler) ListAudit(w http.ResponseWriter, r *http.Request) {
	rows, err := h.DB.Query(context.Background(), `
		SELECT
			a.id::text,
			a.admin_id::text,
			u.display_name,
			a.action,
			COALESCE(a.target_id::text, ''),
			COALESCE(a.detail, ''),
			a.ip_address,
			a.created_at::text
		FROM admin_audit_log a
		JOIN users u ON u.id = a.admin_id
		ORDER BY a.created_at DESC LIMIT 500
	`)
	if err != nil {
		http.Error(w, "query failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	entries := make([]AuditEntry, 0)
	for rows.Next() {
		var e AuditEntry
		if err := rows.Scan(&e.ID, &e.AdminID, &e.AdminName, &e.Action,
			&e.TargetID, &e.Detail, &e.IPAddress, &e.CreatedAt); err != nil {
			continue
		}
		entries = append(entries, e)
	}
	writeJSON(w, http.StatusOK, entries)
}

// GET /api/admin/messages
// Reading all user messages is a sensitive action — log it.
func (h *Handler) ListMessages(w http.ResponseWriter, r *http.Request) {
	adminID := mw.GetUserID(r)
	writeAudit(h.DB, adminID, "view_messages", "", "", r)
	rows, err := h.DB.Query(context.Background(), `
		SELECT
			m.id::text, m.sender_id::text, s.display_name,
			m.recipient_id::text, rec.display_name,
			m.original_text, m.translated_text,
			m.source_lang, m.target_lang, m.created_at
		FROM messages m
		JOIN users s   ON s.id = m.sender_id
		JOIN users rec ON rec.id = m.recipient_id
		ORDER BY m.created_at DESC LIMIT 200
	`)
	if err != nil {
		http.Error(w, "query failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	msgs := make([]MessageRecord, 0)
	for rows.Next() {
		var msg MessageRecord
		if err := rows.Scan(
			&msg.ID, &msg.SenderID, &msg.SenderName,
			&msg.RecipientID, &msg.RecipientName,
			&msg.OriginalText, &msg.TranslatedText,
			&msg.SourceLang, &msg.TargetLang, &msg.CreatedAt,
		); err != nil {
			continue
		}
		msgs = append(msgs, msg)
	}
	writeJSON(w, http.StatusOK, msgs)
}
