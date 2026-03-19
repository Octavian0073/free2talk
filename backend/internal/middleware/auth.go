package middleware

import (
	"context"
	"net/http"
	"strings"

	"free2talk/backend/internal/auth"

	"github.com/jackc/pgx/v5/pgxpool"
)

type contextKey string

const (
	UserIDKey    contextKey = "user_id"
	UserEmailKey contextKey = "user_email"
)

// Auth validates the Bearer JWT and then verifies the user still exists in the
// database. The second check is necessary because JWTs are valid for 24 hours,
// but an admin may delete a user account before the token expires. Without the
// DB check, a deleted user's token would continue to pass authentication.
//
// Fail-safe: if the DB query fails (e.g. DB is down), access is denied rather
// than granted.
func Auth(db *pgxpool.Pool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := r.Header.Get("Authorization")
			if !strings.HasPrefix(header, "Bearer ") {
				http.Error(w, "missing or invalid authorization header", http.StatusUnauthorized)
				return
			}
			tokenStr := strings.TrimPrefix(header, "Bearer ")
			claims, err := auth.ParseToken(tokenStr)
			if err != nil {
				http.Error(w, "invalid or expired token", http.StatusUnauthorized)
				return
			}

			// F2: Verify the user still exists in the database.
			// A valid JWT for a deleted account must not grant access.
			var exists bool
			err = db.QueryRow(context.Background(),
				`SELECT EXISTS(SELECT 1 FROM users WHERE id = $1::uuid)`, claims.UserID,
			).Scan(&exists)
			if err != nil || !exists {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}

			ctx := context.WithValue(r.Context(), UserIDKey, claims.UserID)
			ctx = context.WithValue(ctx, UserEmailKey, claims.Email)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func GetUserID(r *http.Request) string {
	v, _ := r.Context().Value(UserIDKey).(string)
	return v
}
