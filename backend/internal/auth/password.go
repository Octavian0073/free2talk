package auth

import "golang.org/x/crypto/bcrypt"

func HashPassword(plain string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(plain), 12)
	return string(b), err
}

func CheckPassword(hash, plain string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)) == nil
}

// dummyHash is a pre-computed bcrypt hash used to normalize login response
// time when the requested email does not exist in the database.
//
// Without this, an attacker can enumerate valid emails by measuring latency:
// unknown email → ~1ms (no bcrypt), known email + wrong password → ~100ms (bcrypt).
// By always running bcrypt, both paths take ~100ms regardless of email existence.
//
// The hash is for the string "dummy" at cost 12. The exact value is irrelevant —
// bcrypt.CompareHashAndPassword will always return an error, which is intentional.
const dummyHash = "$2a$12$KIXBMaM7Zb5gCq.x7oBLxeKp9wQGlAmb3MYjVzOjONr.1wF3.t3yO"

// TimingDummyCheck runs a bcrypt comparison against a dummy hash.
// Call this when a login attempt references a non-existent email to prevent
// timing-based user enumeration.
func TimingDummyCheck(suppliedPassword string) {
	// Result is intentionally ignored — this call exists only for its timing effect.
	_ = CheckPassword(dummyHash, suppliedPassword)
}
