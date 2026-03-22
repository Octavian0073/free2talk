package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"free2talk/backend/internal/admin"
	"free2talk/backend/internal/audio"
	"free2talk/backend/internal/auth"
	"free2talk/backend/internal/call"
	"free2talk/backend/internal/chat"
	"free2talk/backend/internal/db"
	"free2talk/backend/internal/friends"
	mw "free2talk/backend/internal/middleware"
	"free2talk/backend/internal/translate"
	"free2talk/backend/internal/user"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
)

func main() {
	// Fail fast if JWT_SECRET is absent or too short.
	// An empty or weak secret allows anyone to forge valid JWTs for any user.
	// Minimum 32 characters = 256 bits, adequate for HMAC-SHA256.
	jwtSecret := os.Getenv("JWT_SECRET")
	if len(jwtSecret) < 32 {
		log.Fatal("FATAL: JWT_SECRET must be set and at least 32 characters long. Refusing to start.")
	}

	pool, err := db.Connect()
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer pool.Close()

	authHandler := &auth.Handler{DB: pool, RegistrationKey: os.Getenv("REGISTRATION_KEY")}
	userHandler := &user.Handler{DB: pool}
	adminHandler := &admin.Handler{DB: pool}

	// Phase 2: WebSocket hub, translation client, and chat handler.
	hub := chat.NewHub(pool)
	go hub.Run()

	ltURL := os.Getenv("LIBRETRANSLATE_URL")
	if ltURL == "" {
		ltURL = "http://localhost:5000"
	}
	translator := translate.NewClient(ltURL)

	// DEV_MODE=true loosens CORS and WS origin checks to allow connections from
	// any device on the local network (e.g. phone testing). Never use in production.
	devMode := os.Getenv("DEV_MODE") == "true"

	// APP_ORIGIN is the production frontend URL (e.g. "https://free2talk.example.com").
	// Used for CORS allowed origins and WebSocket origin checks.
	appOrigin := os.Getenv("APP_ORIGIN")

	chatHandler := &chat.Handler{DB: pool, Hub: hub, Translate: translator, DevMode: devMode, AllowedOrigin: appOrigin}
	friendsHandler := &friends.Handler{DB: pool, Hub: hub}
	callHandler := &call.Handler{DB: pool, Hub: hub}

	// ML service connection — Unix socket preferred (no TCP overhead).
	// ML_SOCKET_PATH — if set, Go dials the ML service over a Unix socket (local dev).
	// Leave unset or empty to use plain HTTPS via ML_SERVICE_URL (Modal / production).
	mlSocketPath := os.Getenv("ML_SOCKET_PATH")
	mlURL := os.Getenv("ML_SERVICE_URL")
	if mlURL == "" {
		mlURL = "http://localhost"
	}
	// When using a Unix socket the URL host is ignored by the custom dialer,
	// so "http://localhost" is just a placeholder that satisfies http.Request.
	mlClient := audio.NewMLClient(mlSocketPath)
	vadCfg := audio.NewVADConfigFromEnv()
	audioHandler := &audio.Handler{DB: pool, Hub: hub, MLURL: mlURL, MLClient: mlClient, DevMode: devMode, VAD: vadCfg, AllowedOrigin: appOrigin}

	var corsOrigins []string
	if devMode {
		corsOrigins = []string{"*"}
		log.Println("WARNING: DEV_MODE enabled — CORS and origin checks are open to all origins")
	} else {
		corsOrigins = []string{
			"http://localhost:5173",
			"http://localhost:3000",
			"https://localhost:5173",
			"https://localhost:3000",
		}
		if appOrigin != "" {
			corsOrigins = append(corsOrigins, appOrigin)
		}
	}

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   corsOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		AllowCredentials: !devMode, // wildcard origin + credentials is not allowed by spec
	}))

	// Health check (unauthenticated, used by infra probes)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	})

	// TURN credentials — returns short-lived HMAC-SHA1 credentials for Coturn.
	// Requires TURN_HOST and TURN_SECRET env vars. If either is absent, falls
	// back to Google STUN only so calls still work on same-network / simple NAT.
	// Credentials expire after 1 hour (standard Coturn time-limited auth).
	turnHost := os.Getenv("TURN_HOST")
	turnSecret := os.Getenv("TURN_SECRET")
	r.With(mw.Auth(pool)).Get("/api/turn-credentials", func(w http.ResponseWriter, r *http.Request) {
		type iceServer struct {
			URLs       interface{} `json:"urls"`
			Username   string      `json:"username,omitempty"`
			Credential string      `json:"credential,omitempty"`
		}
		type response struct {
			ICEServers []iceServer `json:"iceServers"`
		}

		servers := []iceServer{
			{URLs: "stun:stun.l.google.com:19302"},
		}

		if turnHost != "" && turnSecret != "" {
			expiry := time.Now().Add(time.Hour).Unix()
			username := strconv.FormatInt(expiry, 10) + ":free2talk"
			mac := hmac.New(sha1.New, []byte(turnSecret))
			mac.Write([]byte(username))
			credential := base64.StdEncoding.EncodeToString(mac.Sum(nil))

			servers = append(servers, iceServer{
				URLs: []string{
					"turn:" + turnHost + ":3478",
					"turns:" + turnHost + ":5349",
				},
				Username:   username,
				Credential: credential,
			})
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response{ICEServers: servers})
	})

	// ML warmup — streams SSE events while waiting for the Modal container.
	// Sends a "warming" event every second with elapsed time, then a "ready"
	// event (or "error") when Modal /health responds. The frontend reads this
	// stream so the user sees live elapsed seconds instead of a dead spinner.
	r.With(mw.Auth(pool), mw.AdminOnly(pool)).Get("/api/ml/warmup", func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming not supported", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")

		// Ping Modal in the background.
		done := make(chan error, 1)
		go func() {
			req, err := http.NewRequest(http.MethodGet, mlURL+"/health", nil)
			if err != nil {
				done <- err
				return
			}
			resp, err := mlClient.Do(req)
			if err != nil {
				done <- err
				return
			}
			resp.Body.Close()
			done <- nil
		}()

		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		start := time.Now()

		for {
			select {
			case err := <-done:
				elapsed := int(time.Since(start).Seconds())
				if err != nil {
					fmt.Fprintf(w, "event: error\ndata: {\"elapsed\":%d}\n\n", elapsed)
				} else {
					fmt.Fprintf(w, "event: ready\ndata: {\"elapsed\":%d}\n\n", elapsed)
				}
				flusher.Flush()
				return
			case <-ticker.C:
				fmt.Fprintf(w, "event: warming\ndata: {\"elapsed\":%d}\n\n", int(time.Since(start).Seconds()))
				flusher.Flush()
			case <-r.Context().Done():
				return
			}
		}
	})

	// Auth endpoints — rate limited to 10 requests per IP per minute.
	authLimiter := mw.RateLimit(10, time.Minute)
	r.Group(func(r chi.Router) {
		r.Use(authLimiter)
		r.Post("/api/auth/register", authHandler.Register)
		r.Post("/api/auth/login", authHandler.Login)
	})

	// Authenticated user routes.
	// mw.Auth(pool) validates the JWT and verifies the user still exists in DB.
	r.Group(func(r chi.Router) {
		r.Use(mw.Auth(pool))
		r.Get("/api/user/me", userHandler.GetMe)
		r.Put("/api/user/language", userHandler.UpdateLanguage)
		r.Put("/api/user/profile", userHandler.UpdateProfile)
	})

	// Phase 2: chat routes.
	// /ws does its own JWT + DB auth from the query param (browser WebSocket
	// API cannot send custom headers, so mw.Auth cannot be applied here).
	r.Get("/ws", chatHandler.ServeWS)
	r.Get("/ws/audio", audioHandler.ServeAudioWS)

	r.Group(func(r chi.Router) {
		r.Use(mw.Auth(pool))
		r.Get("/api/users", chatHandler.ListUsers)
		r.Get("/api/users/search", friendsHandler.SearchUsers)
		r.Post("/api/messages", chatHandler.SendMessage)
		r.Get("/api/messages/{user_id}", chatHandler.GetHistory)
		// Friends
		r.Get("/api/friends", friendsHandler.ListFriends)
		r.Get("/api/friends/requests", friendsHandler.ListRequests)
		r.Post("/api/friends/request", friendsHandler.SendRequest)
		r.Post("/api/friends/accept/{id}", friendsHandler.AcceptRequest)
		r.Delete("/api/friends/user/{user_id}", friendsHandler.RemoveByUser)
		r.Delete("/api/friends/{id}", friendsHandler.DeclineOrRemove)
		// Phase 3: calls
		r.Post("/api/calls", callHandler.InitiateCall)
		r.Patch("/api/calls/{id}/end", callHandler.EndCall)
	})

	// Admin-only routes — require valid JWT AND is_admin=true live from DB.
	r.Group(func(r chi.Router) {
		r.Use(mw.Auth(pool))
		r.Use(mw.AdminOnly(pool))
		r.Get("/api/admin/stats", adminHandler.Stats)
		r.Get("/api/admin/users", adminHandler.ListUsers)
		r.Put("/api/admin/users/{id}/toggle-admin", adminHandler.ToggleAdmin)
		r.Delete("/api/admin/users/{id}", adminHandler.DeleteUser)
		r.Get("/api/admin/messages", adminHandler.ListMessages)
		r.Get("/api/admin/audit", adminHandler.ListAudit)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8000"
	}

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      r,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Start server in a goroutine so the main goroutine can listen for signals.
	go func() {
		fmt.Printf("free2talk backend running on 0.0.0.0:%s\n", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	// Block until SIGINT or SIGTERM is received.
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("shutdown signal received — draining connections...")

	// Give in-flight requests up to 30 seconds to complete before forcing exit.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("forced shutdown after timeout: %v", err)
	}

	log.Println("server stopped cleanly")
}
