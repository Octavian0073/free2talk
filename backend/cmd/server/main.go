package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
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

	authHandler := &auth.Handler{DB: pool}
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

	chatHandler := &chat.Handler{DB: pool, Hub: hub, Translate: translator, DevMode: devMode}
	friendsHandler := &friends.Handler{DB: pool}
	callHandler := &call.Handler{DB: pool, Hub: hub}

	// ML service connection — Unix socket preferred (no TCP overhead).
	// Set ML_SOCKET_PATH="" to fall back to TCP via ML_SERVICE_URL.
	mlSocketPath := os.Getenv("ML_SOCKET_PATH")
	if mlSocketPath == "" {
		mlSocketPath = "/tmp/free2talk-ml.sock"
	}
	mlURL := os.Getenv("ML_SERVICE_URL")
	if mlURL == "" {
		mlURL = "http://localhost"
	}
	// When using a Unix socket the URL host is ignored by the custom dialer,
	// so "http://localhost" is just a placeholder that satisfies http.Request.
	mlClient := audio.NewMLClient(mlSocketPath)
	audioHandler := &audio.Handler{DB: pool, Hub: hub, MLURL: mlURL, MLClient: mlClient, DevMode: devMode}

	var corsOrigins []string
	if devMode {
		corsOrigins = []string{"*"}
		log.Println("WARNING: DEV_MODE enabled — CORS and origin checks are open to all origins")
	} else {
		corsOrigins = []string{"http://localhost:5173", "http://localhost:3000"}
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
