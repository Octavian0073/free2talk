package auth

import (
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// minSecretLen is the minimum acceptable JWT secret length.
// 32 bytes = 256 bits, sufficient for HMAC-SHA256.
const minSecretLen = 32

var errWeakSecret = errors.New("JWT_SECRET is not set or is too short (minimum 32 characters)")

type Claims struct {
	UserID string `json:"user_id"`
	Email  string `json:"email"`
	jwt.RegisteredClaims
}

func jwtSecret() ([]byte, error) {
	s := os.Getenv("JWT_SECRET")
	if len(s) < minSecretLen {
		return nil, errWeakSecret
	}
	return []byte(s), nil
}

func IssueToken(userID, email string) (string, error) {
	secret, err := jwtSecret()
	if err != nil {
		return "", err
	}
	claims := Claims{
		UserID: userID,
		Email:  email,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
		},
	}
	// Always sign with HS256 explicitly — never derive the algorithm from input.
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(secret)
}

func ParseToken(tokenStr string) (*Claims, error) {
	secret, err := jwtSecret()
	if err != nil {
		return nil, err
	}

	token, err := jwt.ParseWithClaims(
		tokenStr,
		&Claims{},
		func(t *jwt.Token) (interface{}, error) {
			// Layer 2 — exact algorithm instance check.
			//
			// We compare against the jwt.SigningMethodHS256 singleton directly.
			// This is stricter than a type assertion to *jwt.SigningMethodHMAC,
			// which would also accept HS384 and HS512.
			//
			// Attack vectors blocked here:
			//   - alg:none       → jwt.SigningMethodNone  != jwt.SigningMethodHS256
			//   - HS384 / HS512  → different instances    != jwt.SigningMethodHS256
			//   - RS256 / ES256  → different types        != jwt.SigningMethodHS256
			if t.Method != jwt.SigningMethodHS256 {
				return nil, fmt.Errorf("unexpected signing algorithm: %v", t.Header["alg"])
			}
			return secret, nil
		},
		// Layer 1 — library-level algorithm allowlist.
		//
		// WithValidMethods runs before the keyfunc. The library rejects any
		// token whose "alg" header is not exactly "HS256" without ever
		// invoking our keyfunc. This is a defence-in-depth measure: both
		// layers must pass independently. Bypassing one does not bypass both.
		//
		// This also explicitly blocks the alg:none attack at the library level,
		// before any application code runs.
		jwt.WithValidMethods([]string{"HS256"}),
	)
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}
	return claims, nil
}
