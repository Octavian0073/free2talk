package user

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	mw "free2talk/backend/internal/middleware"
	"free2talk/backend/internal/models"
	"free2talk/backend/internal/validate"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
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

type updateProfileRequest struct {
	DisplayName  string `json:"display_name"`
	Email        string `json:"email"`
	LanguageCode string `json:"language_code"`
	Password     string `json:"password"` // required — verifies the caller's identity
}

// UpdateProfile handles PUT /api/user/profile
// Allows the authenticated user to change their display name, email, and language.
// The current password must be provided and must match before any change is applied.
func (h *Handler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	userID := mw.GetUserID(r)

	r.Body = http.MaxBytesReader(w, r.Body, validate.MaxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()

	var req updateProfileRequest
	if err := dec.Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	req.DisplayName = strings.TrimSpace(req.DisplayName)
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))

	if req.Password == "" {
		http.Error(w, "password is required to save changes", http.StatusBadRequest)
		return
	}
	if req.DisplayName == "" {
		http.Error(w, "display_name cannot be empty", http.StatusBadRequest)
		return
	}
	if req.Email == "" {
		http.Error(w, "email cannot be empty", http.StatusBadRequest)
		return
	}
	if req.LanguageCode != "" && !models.ValidLanguages[req.LanguageCode] {
		http.Error(w, "unsupported language code; use en, ro, or ja", http.StatusBadRequest)
		return
	}

	// Fetch the current password hash to verify the caller.
	var hash string
	if err := h.DB.QueryRow(context.Background(),
		`SELECT password_hash FROM users WHERE id = $1::uuid`, userID,
	).Scan(&hash); err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password)); err != nil {
		http.Error(w, "incorrect password", http.StatusUnauthorized)
		return
	}

	// Apply all changes in a single UPDATE. Language falls back to existing value if not provided.
	var u models.User
	err := h.DB.QueryRow(context.Background(), `
		UPDATE users
		SET display_name  = $1,
		    email         = $2,
		    language_code = CASE WHEN $3 = '' THEN language_code ELSE $3 END
		WHERE id = $4::uuid
		RETURNING id::text, email, username, display_name, language_code, is_admin, created_at`,
		req.DisplayName, req.Email, req.LanguageCode, userID,
	).Scan(&u.ID, &u.Email, &u.Username, &u.DisplayName, &u.LanguageCode, &u.IsAdmin, &u.CreatedAt)
	if err != nil {
		// Most likely cause: unique constraint on email.
		http.Error(w, "update failed — email may already be in use", http.StatusConflict)
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
