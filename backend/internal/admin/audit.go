package admin

import (
	"context"
	"net"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
)

// writeAudit records an admin action to admin_audit_log.
// It is fire-and-forget in the sense that a log failure never blocks the
// primary action — but it is logged to stderr so ops can detect issues.
//
// Fields:
//   - adminID   — the authenticated admin performing the action (from JWT)
//   - action    — short snake_case verb, e.g. "delete_user", "toggle_admin"
//   - targetID  — the UUID of the affected user ("" if not applicable)
//   - detail    — optional human-readable context
//   - r         — the original HTTP request, used to capture the client IP
func writeAudit(db *pgxpool.Pool, adminID, action, targetID, detail string, r *http.Request) {
	ip := requestIP(r)

	// We do NOT want a log write failure to roll back the admin action, so this
	// runs with a fresh context independent of the request context.
	_, err := db.Exec(context.Background(),
		`INSERT INTO admin_audit_log (admin_id, action, target_id, detail, ip_address)
		 VALUES ($1::uuid, $2, $3::uuid, $4, $5)`,
		adminID, action, nilIfEmpty(targetID), nilIfEmpty(detail), ip,
	)
	if err != nil {
		// Log to stderr — don't block or surface to the client.
		// In production this should go to a structured logger / alerting system.
		println("AUDIT LOG ERROR:", err.Error())
	}
}

func nilIfEmpty(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

func requestIP(r *http.Request) string {
	host := r.RemoteAddr
	if h, _, err := net.SplitHostPort(host); err == nil {
		return h
	}
	return host
}
