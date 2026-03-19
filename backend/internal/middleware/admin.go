package middleware

import (
	"context"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
)

// AdminOnly checks that the authenticated user has is_admin = true.
// Must be used after the Auth middleware (requires user_id in context).
func AdminOnly(db *pgxpool.Pool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID := GetUserID(r)
			if userID == "" {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			var isAdmin bool
			err := db.QueryRow(context.Background(),
				`SELECT is_admin FROM users WHERE id = $1::uuid`, userID,
			).Scan(&isAdmin)
			if err != nil || !isAdmin {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
