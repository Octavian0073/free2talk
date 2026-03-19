// Package audio handles the /ws/audio WebSocket endpoint.
package audio

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"mime/multipart"
	"net"
	"net/http"
	"time"

	"free2talk/backend/internal/auth"
	"free2talk/backend/internal/chat"
	"free2talk/backend/internal/translate"
	"free2talk/backend/internal/validate"

	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgxpool"
)

var prodOrigins = map[string]bool{
	"http://localhost:5173":  true,
	"http://localhost:3000":  true,
	"https://localhost:5173": true,
	"https://localhost:3000": true,
}

// Handler holds dependencies for the audio WebSocket endpoint.
type Handler struct {
	DB        *pgxpool.Pool
	Hub       *chat.Hub
	MLURL     string
	Translate *translate.Client
	MLClient  *http.Client
	DevMode   bool
}

func (h *Handler) upgrader() *websocket.Upgrader {
	return &websocket.Upgrader{
		ReadBufferSize:  4096,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			if h.DevMode {
				return true
			}
			return prodOrigins[r.Header.Get("Origin")]
		},
	}
}

// NewMLClient returns an HTTP client configured for the ml-service.
// If socketPath is non-empty it dials a Unix socket (same-machine, no TCP overhead).
// Otherwise it falls back to normal TCP with keep-alive pooling.
func NewMLClient(socketPath string) *http.Client {
	transport := &http.Transport{
		MaxIdleConns:        8,
		MaxIdleConnsPerHost: 8,
		IdleConnTimeout:     90 * time.Second,
	}
	if socketPath != "" {
		transport.DialContext = func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", socketPath)
		}
	}
	return &http.Client{
		Timeout:   10 * time.Second,
		Transport: transport,
	}
}

// mlResponse is the JSON shape returned by POST /transcribe on the ml-service.
type mlResponse struct {
	Transcript string `json:"transcript"`
}

// ServeAudioWS upgrades the connection and streams audio chunks to the ml-service.
// GET /ws/audio?token=<jwt>&to_id=<peer_uuid>
//
// Security:
//   - JWT validated from ?token= before upgrade.
//   - Friendship enforced in DB before upgrade.
//   - from_id is always the authenticated user; client cannot forge it.
func (h *Handler) ServeAudioWS(w http.ResponseWriter, r *http.Request) {
	// 1. Validate JWT.
	tokenStr := r.URL.Query().Get("token")
	if tokenStr == "" {
		http.Error(w, "missing token", http.StatusUnauthorized)
		return
	}
	claims, err := auth.ParseToken(tokenStr)
	if err != nil {
		http.Error(w, "invalid or expired token", http.StatusUnauthorized)
		return
	}

	// 2. Validate to_id.
	toID := r.URL.Query().Get("to_id")
	if err := validate.UUID(toID); err != nil {
		http.Error(w, "invalid to_id", http.StatusBadRequest)
		return
	}
	if toID == claims.UserID {
		http.Error(w, "to_id cannot be self", http.StatusBadRequest)
		return
	}

	// 3. Verify the authenticated user still exists.
	var exists bool
	if err := h.DB.QueryRow(context.Background(),
		`SELECT EXISTS(SELECT 1 FROM users WHERE id = $1::uuid)`, claims.UserID,
	).Scan(&exists); err != nil || !exists {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	// 4. Friendship gate.
	var areFriends bool
	if err := h.DB.QueryRow(context.Background(), `
		SELECT EXISTS(
			SELECT 1 FROM friendships
			WHERE ((sender_id = $1::uuid AND receiver_id = $2::uuid)
			    OR (sender_id = $2::uuid AND receiver_id = $1::uuid))
			  AND status = 'accepted'
		)`, claims.UserID, toID,
	).Scan(&areFriends); err != nil || !areFriends {
		http.Error(w, "not friends", http.StatusForbidden)
		return
	}

	// 5. Look up both parties' language codes once per connection.
	rows, err := h.DB.Query(context.Background(),
		`SELECT id::text, language_code FROM users WHERE id = $1::uuid OR id = $2::uuid`,
		claims.UserID, toID,
	)
	if err != nil {
		http.Error(w, "database error", http.StatusInternalServerError)
		return
	}
	langs := make(map[string]string, 2)
	for rows.Next() {
		var id, lang string
		if err := rows.Scan(&id, &lang); err != nil {
			rows.Close()
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		langs[id] = lang
	}
	rows.Close()

	fromLang := langs[claims.UserID]
	toLang := langs[toID]
	if fromLang == "" || toLang == "" {
		http.Error(w, "could not resolve language codes", http.StatusInternalServerError)
		return
	}

	// 6. Upgrade to WebSocket.
	conn, err := h.upgrader().Upgrade(w, r, nil)
	if err != nil {
		log.Printf("audio ws upgrade error for user %s: %v", claims.UserID, err)
		return
	}
	defer conn.Close()

	log.Printf("audio: connection established from=%s to=%s fromLang=%s toLang=%s", claims.UserID, toID, fromLang, toLang)
	conn.SetReadLimit(512 * 1024)

	chunkCount := 0
	for {
		msgType, data, err := conn.ReadMessage()
		if err != nil {
			log.Printf("audio: connection closed from=%s after %d chunks: %v", claims.UserID, chunkCount, err)
			break
		}
		if msgType != websocket.BinaryMessage || len(data) < 100 {
			continue
		}
		chunkCount++
		log.Printf("audio: chunk #%d received from=%s size=%d", chunkCount, claims.UserID, len(data))

		go func(chunk []byte) {
			// STT via Python ml-service (Unix socket or TCP).
			transcript, err := h.transcribe(chunk, fromLang)
			if err != nil {
				log.Printf("audio: STT error: %v", err)
				return
			}
			if transcript == "" {
				return // silence or VAD filtered
			}

			// Translation via Go's LibreTranslate client (same as chat).
			translation := transcript
			if fromLang != toLang {
				if t, err := h.Translate.Translate(transcript, fromLang, toLang); err == nil {
					translation = t
				} else {
					log.Printf("audio: translation error (using transcript): %v", err)
				}
			}

			payload, _ := json.Marshal(map[string]any{
				"type":        "caption",
				"from_id":     claims.UserID,
				"transcript":  transcript,
				"translation": translation,
				"from_lang":   fromLang,
				"to_lang":     toLang,
			})
			h.Hub.Deliver(toID, payload)
		}(data)
	}
}

// transcribe posts an audio chunk to the ml-service and returns the transcript.
func (h *Handler) transcribe(chunk []byte, lang string) (string, error) {
	var body bytes.Buffer
	mpw := multipart.NewWriter(&body)

	fw, err := mpw.CreateFormFile("audio", "chunk.webm")
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(fw, bytes.NewReader(chunk)); err != nil {
		return "", err
	}
	mpw.Close()

	req, err := http.NewRequest(http.MethodPost, h.MLURL+"/transcribe?lang="+lang, &body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", mpw.FormDataContentType())

	resp, err := h.MLClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var result mlResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	return result.Transcript, nil
}
