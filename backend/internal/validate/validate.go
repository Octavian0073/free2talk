// Package validate provides shared input validation helpers.
// All user-supplied data must pass through these before reaching business logic or the DB.
package validate

import (
	"fmt"
	"regexp"
)

// uuidRe matches the standard UUID v4 format (case-insensitive).
var uuidRe = regexp.MustCompile(
	`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
)

// UUID returns an error if s is not a valid UUID string.
// Use this before passing any client-supplied ID to the database.
func UUID(s string) error {
	if !uuidRe.MatchString(s) {
		return fmt.Errorf("invalid id format")
	}
	return nil
}

// MaxBodyBytes is the maximum request body size we accept (16 KB).
// Apply via http.MaxBytesReader on every handler that parses a body.
const MaxBodyBytes = 16 * 1024
