package middleware

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// slidingWindow tracks request timestamps per IP within a time window.
type slidingWindow struct {
	mu       sync.Mutex
	requests map[string][]time.Time
	limit    int
	window   time.Duration
}

func newSlidingWindow(limit int, window time.Duration) *slidingWindow {
	sw := &slidingWindow{
		requests: make(map[string][]time.Time),
		limit:    limit,
		window:   window,
	}
	// Periodic cleanup so the map doesn't grow unbounded.
	go func() {
		ticker := time.NewTicker(window)
		defer ticker.Stop()
		for range ticker.C {
			sw.mu.Lock()
			cutoff := time.Now().Add(-window)
			for ip, times := range sw.requests {
				valid := times[:0]
				for _, t := range times {
					if t.After(cutoff) {
						valid = append(valid, t)
					}
				}
				if len(valid) == 0 {
					delete(sw.requests, ip)
				} else {
					sw.requests[ip] = valid
				}
			}
			sw.mu.Unlock()
		}
	}()
	return sw
}

func (sw *slidingWindow) allow(ip string) bool {
	sw.mu.Lock()
	defer sw.mu.Unlock()

	now := time.Now()
	cutoff := now.Add(-sw.window)

	// Trim old entries for this IP.
	times := sw.requests[ip]
	valid := times[:0]
	for _, t := range times {
		if t.After(cutoff) {
			valid = append(valid, t)
		}
	}

	if len(valid) >= sw.limit {
		sw.requests[ip] = valid
		return false
	}
	sw.requests[ip] = append(valid, now)
	return true
}

// RateLimit returns a middleware that allows at most `limit` requests per IP
// within `window`. Intended for auth endpoints.
//
// NOTE: remoteIP uses r.RemoteAddr only. If you run behind a reverse proxy
// (nginx, Caddy), configure the proxy to set X-Real-IP and update remoteIP()
// to read that header — but ONLY after validating the proxy is trusted, to
// prevent IP spoofing via X-Forwarded-For.
func RateLimit(limit int, window time.Duration) func(http.Handler) http.Handler {
	sw := newSlidingWindow(limit, window)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := remoteIP(r)
			if !sw.allow(ip) {
				w.Header().Set("Retry-After", window.String())
				http.Error(w, "too many requests", http.StatusTooManyRequests)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// remoteIP extracts the client IP from RemoteAddr, stripping the port.
func remoteIP(r *http.Request) string {
	host := r.RemoteAddr
	// RemoteAddr is "ip:port" for TCP connections.
	if h, _, err := net.SplitHostPort(host); err == nil {
		return h
	}
	return strings.TrimSpace(host)
}
