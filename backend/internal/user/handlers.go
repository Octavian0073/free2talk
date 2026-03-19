package user

import (
	"context"
	"encoding/json"
	"net/http"

	mw "free2talk/backend/internal/middleware"
	"free2talk/backend/internal/models"
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

// GetMe serves the authenticated user's own profile.
// The user ID comes exclusively from the JWT context — no client-supplied ID.
func (h *Handler) GetMe(w http.ResponseWriter, r *http.Request) {
	userID := mw.GetUserID(r)

	var u models.User
	err := h.DB.QueryRow(context.Background(),
		`SELECT id::text, email, username, display_name, language_code, is_admin, created_at
		 FROM users WHERE id = $1::uuid`,
		userID,
	).Scan(&u.ID, &u.Email, &u.Username, &u.DisplayName, &u.LanguageCode, &u.IsAdmin, &u.CreatedAt)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}
	writeJSON(w, http.StatusOK, u)
}

type updateLanguageRequest struct {
	LanguageCode string `json:"language_code"`
}

// UpdateLanguage changes the authenticated user's language preference.
// SECURITY: The row updated is identified by the JWT user ID only.
// A client cannot change another user's language by supplying a different ID.
func (h *Handler) UpdateLanguage(w http.ResponseWriter, r *http.Request) {
	userID := mw.GetUserID(r)

	r.Body = http.MaxBytesReader(w, r.Body, validate.MaxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()

	var req updateLanguageRequest
	if err := dec.Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if !models.ValidLanguages[req.LanguageCode] {
		http.Error(w, "unsupported language code; use en, ro, or ja", http.StatusBadRequest)
		return
	}

	var u models.User
	err := h.DB.QueryRow(context.Background(),
		`UPDATE users SET language_code = $1 WHERE id = $2::uuid
		 RETURNING id::text, email, username, display_name, language_code, is_admin, created_at`,
		req.LanguageCode, userID,
	).Scan(&u.ID, &u.Email, &u.Username, &u.DisplayName, &u.LanguageCode, &u.IsAdmin, &u.CreatedAt)
	if err != nil {
		http.Error(w, "update failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, u)
}
