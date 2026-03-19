// Package models contains shared data structures with no internal dependencies.
// It exists specifically to avoid import cycles between packages that both
// define behaviour (auth, user, admin) and packages that provide middleware.
package models

import "time"

type User struct {
	ID           string    `json:"id"`
	Email        string    `json:"email"`
	Username     string    `json:"username"`
	DisplayName  string    `json:"display_name"`
	LanguageCode string    `json:"language_code"`
	IsAdmin      bool      `json:"is_admin"`
	CreatedAt    time.Time `json:"created_at"`
}

var ValidLanguages = map[string]bool{
	"en": true,
	"ro": true,
	"ja": true,
}
