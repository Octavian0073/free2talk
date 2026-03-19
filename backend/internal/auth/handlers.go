package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"

	"free2talk/backend/internal/models"
	"free2talk/backend/internal/validate"

	"github.com/jackc/pgx/v5/pgxpool"
)

// usernameRe enforces: lowercase letters, digits, underscores only; 3–20 chars.
var usernameRe = regexp.MustCompile(`^[a-z0-9_]{3,20}$`)

type Handler struct {
	DB *pgxpool.Pool
}

// registerRequest contains ONLY the fields a client is allowed to supply.
// is_admin is intentionally absent — it is controlled exclusively by the DB
// default (false) and the admin-only ToggleAdmin endpoint. No client path
// can elevate privileges at registration time.
type registerRequest struct {
	Email        string `json:"email"`
	Password     string `json:"password"`
	Username     string `json:"username"`
	DisplayName  string `json:"display_name"`
	LanguageCode string `json:"language_code"`
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type authResponse struct {
	Token string      `json:"token"`
	User  models.User `json:"user"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// decodeBody enforces a body size cap and disallows unknown JSON fields.
// DisallowUnknownFields prevents parameter pollution — if a client sends an
// unexpected field (e.g. "is_admin":true) we return 400 immediately rather
// than silently ignoring it. Belt-and-suspenders on top of the typed struct.
func decodeBody(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, validate.MaxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return false
	}
	return true
}

func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if !decodeBody(w, r, &req) {
		return
	}

	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.Username = strings.TrimSpace(strings.ToLower(req.Username))
	req.DisplayName = strings.TrimSpace(req.DisplayName)

	if req.Email == "" || req.Password == "" || req.DisplayName == "" || req.Username == "" {
		http.Error(w, "email, password, username, and display_name are required", http.StatusBadRequest)
		return
	}
	if len(req.Password) < 8 {
		http.Error(w, "password must be at least 8 characters", http.StatusBadRequest)
		return
	}
	if !usernameRe.MatchString(req.Username) {
		http.Error(w, "username must be 3–20 characters: lowercase letters, digits, underscores only", http.StatusBadRequest)
		return
	}
	if !models.ValidLanguages[req.LanguageCode] {
		req.LanguageCode = "en"
	}

	hash, err := HashPassword(req.Password)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	// is_admin is NOT in the INSERT — it defaults to false in the DB schema.
	// The only way to grant admin is via the admin-only ToggleAdmin endpoint.
	var u models.User
	err = h.DB.QueryRow(context.Background(),
		`INSERT INTO users (email, password_hash, username, display_name, language_code)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id::text, email, username, display_name, language_code, is_admin, created_at`,
		req.Email, hash, req.Username, req.DisplayName, req.LanguageCode,
	).Scan(&u.ID, &u.Email, &u.Username, &u.DisplayName, &u.LanguageCode, &u.IsAdmin, &u.CreatedAt)
	if err != nil {
		http.Error(w, "email or username already in use", http.StatusConflict)
		return
	}

	token, err := IssueToken(u.ID, u.Email)
	if err != nil {
		http.Error(w, "could not issue token", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusCreated, authResponse{Token: token, User: u})
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if !decodeBody(w, r, &req) {
		return
	}

	req.Email = strings.TrimSpace(strings.ToLower(req.Email))

	// Fetch user and hash in one query. is_admin comes from DB only — never
	// from the request. The JWT we issue contains only user_id and email;
	// admin status is re-verified from DB on every admin API call.
	var u models.User
	var hash string
	err := h.DB.QueryRow(context.Background(),
		`SELECT id::text, email, password_hash, username, display_name, language_code, is_admin, created_at
		 FROM users WHERE email = $1`,
		req.Email,
	).Scan(&u.ID, &u.Email, &hash, &u.Username, &u.DisplayName, &u.LanguageCode, &u.IsAdmin, &u.CreatedAt)
	if err != nil {
		// F6: Run a dummy bcrypt comparison to normalize response time.
		// Without this, a missing email returns in ~1ms while a wrong password
		// takes ~100ms (bcrypt cost 12), allowing email enumeration by timing.
		TimingDummyCheck(req.Password)
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}

	if !CheckPassword(hash, req.Password) {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}

	token, err := IssueToken(u.ID, u.Email)
	if err != nil {
		http.Error(w, "could not issue token", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, authResponse{Token: token, User: u})
}
