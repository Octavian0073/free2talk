// Package audio handles the /ws/audio WebSocket endpoint.
package audio

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"log"
	"math"
	"mime/multipart"
	"net"
	"net/http"
	"os"
	"strconv"
	"time"

	"free2talk/backend/internal/auth"
	"free2talk/backend/internal/chat"
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

// VADConfig holds tunable voice-activity-detection thresholds.
// All fields have sensible defaults; see DefaultVADConfig and NewVADConfigFromEnv.
type VADConfig struct {
	SpeechRMSMin    float64 // RMS energy threshold — below = silence (default 0.015)
	SilenceToFlush  int     // consecutive silent 50ms chunks before finalising utterance (default 12 → ~600ms)
	MinSpeechFrames int     // minimum speech frames to avoid noise triggers (default 3 → ~150ms)
	MaxSpeechFrames int     // hard cap to prevent buffer growth (default 200 → ~10s)
}

// DefaultVADConfig returns conservative defaults that work well in quiet environments.
func DefaultVADConfig() VADConfig {
	return VADConfig{
		SpeechRMSMin:    0.015,
		SilenceToFlush:  12,
		MinSpeechFrames: 3,
		MaxSpeechFrames: 200,
	}
}

// NewVADConfigFromEnv reads VAD_SPEECH_RMS_MIN, VAD_SILENCE_FRAMES,
// VAD_MIN_SPEECH_FRAMES, VAD_MAX_SPEECH_FRAMES from the environment,
// falling back to DefaultVADConfig for any value that is absent or unparseable.
func NewVADConfigFromEnv() VADConfig {
	cfg := DefaultVADConfig()
	if v := getenvFloat("VAD_SPEECH_RMS_MIN"); v > 0 {
		cfg.SpeechRMSMin = v
	}
	if v := getenvInt("VAD_SILENCE_FRAMES"); v > 0 {
		cfg.SilenceToFlush = v
	}
	if v := getenvInt("VAD_MIN_SPEECH_FRAMES"); v > 0 {
		cfg.MinSpeechFrames = v
	}
	if v := getenvInt("VAD_MAX_SPEECH_FRAMES"); v > 0 {
		cfg.MaxSpeechFrames = v
	}
	return cfg
}

func getenvFloat(key string) float64 {
	v, err := strconv.ParseFloat(os.Getenv(key), 64)
	if err != nil {
		return 0
	}
	return v
}

func getenvInt(key string) int {
	v, err := strconv.Atoi(os.Getenv(key))
	if err != nil {
		return 0
	}
	return v
}

// Handler holds dependencies for the audio WebSocket endpoint.
type Handler struct {
	DB       *pgxpool.Pool
	Hub      *chat.Hub
	MLURL    string
	MLClient *http.Client
	DevMode  bool
	VAD      VADConfig
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
		Timeout:   120 * time.Second, // 120s covers Modal cold start on first request
		Transport: transport,
	}
}

type mlResponse struct {
	Transcript  string `json:"transcript"`
	Translation string `json:"translation"`
}

const (
	pcmSampleRate = 16000 // must match AudioContext sampleRate in the browser
)

// pcmRMS computes the root-mean-square energy of a raw Int16 LE PCM buffer.
// Returns a value in [0, 1] where 1 = full scale.
func pcmRMS(pcm []byte) float64 {
	n := len(pcm) / 2
	if n == 0 {
		return 0
	}
	var sum float64
	for i := 0; i+1 < len(pcm); i += 2 {
		s := float64(int16(binary.LittleEndian.Uint16(pcm[i:i+2]))) / 32768.0
		sum += s * s
	}
	return math.Sqrt(sum / float64(n))
}

// makePCMWAV wraps raw Int16 LE mono PCM bytes in a minimal RIFF/WAV header
// so that faster-whisper (via ffmpeg) can decode it without any format hints.
func makePCMWAV(pcm []byte, sampleRate int) []byte {
	dataLen := len(pcm)
	buf := make([]byte, 44+dataLen)

	copy(buf[0:4], "RIFF")
	binary.LittleEndian.PutUint32(buf[4:8], uint32(36+dataLen))
	copy(buf[8:12], "WAVE")
	copy(buf[12:16], "fmt ")
	binary.LittleEndian.PutUint32(buf[16:20], 16)             // fmt chunk size
	binary.LittleEndian.PutUint16(buf[20:22], 1)              // PCM
	binary.LittleEndian.PutUint16(buf[22:24], 1)              // mono
	binary.LittleEndian.PutUint32(buf[24:28], uint32(sampleRate))
	binary.LittleEndian.PutUint32(buf[28:32], uint32(sampleRate*2)) // byte rate
	binary.LittleEndian.PutUint16(buf[32:34], 2)              // block align
	binary.LittleEndian.PutUint16(buf[34:36], 16)             // bits per sample
	copy(buf[36:40], "data")
	binary.LittleEndian.PutUint32(buf[40:44], uint32(dataLen))
	copy(buf[44:], pcm)

	return buf
}

// ServeAudioWS upgrades the connection and streams audio to the ml-service.
// GET /ws/audio?token=<jwt>&to_id=<peer_uuid>
//
// The browser sends raw Int16 LE mono PCM at 16 kHz in ~50 ms chunks.
// Go performs RMS energy VAD to detect utterance boundaries, then sends the
// complete utterance (wrapped in a WAV header) to the ML service as one request.
// Whisper receives a full sentence rather than fragments — better accuracy,
// no end-chunk repetition.
func (h *Handler) ServeAudioWS(w http.ResponseWriter, r *http.Request) {
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

	toID := r.URL.Query().Get("to_id")
	if err := validate.UUID(toID); err != nil {
		http.Error(w, "invalid to_id", http.StatusBadRequest)
		return
	}
	if toID == claims.UserID {
		http.Error(w, "to_id cannot be self", http.StatusBadRequest)
		return
	}

	var exists bool
	if err := h.DB.QueryRow(context.Background(),
		`SELECT EXISTS(SELECT 1 FROM users WHERE id = $1::uuid)`, claims.UserID,
	).Scan(&exists); err != nil || !exists {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

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

	conn, err := h.upgrader().Upgrade(w, r, nil)
	if err != nil {
		log.Printf("audio ws upgrade error for user %s: %v", claims.UserID, err)
		return
	}
	defer conn.Close()

	log.Printf("audio: connection established from=%s to=%s fromLang=%s toLang=%s",
		claims.UserID, toID, fromLang, toLang)
	conn.SetReadLimit(512 * 1024)

	chunkCh := make(chan []byte, 32)
	done    := make(chan struct{})

	go func() {
		defer close(done)

		var (
			speechBuf   []byte // accumulated PCM bytes during an utterance
			speechCount int    // number of speech frames accumulated
			silenceCnt  int    // consecutive silent frames after speech
		)

		deliver := func(transcript, translation string) {
			payload, _ := json.Marshal(map[string]any{
				"type":        "caption_final",
				"from_id":     claims.UserID,
				"transcript":  transcript,
				"translation": translation,
				"from_lang":   fromLang,
				"to_lang":     toLang,
			})
			h.Hub.Deliver(toID, payload)
		}

		flush := func() {
			if speechCount < h.VAD.MinSpeechFrames {
				// Too short — discard noise burst.
				speechBuf = nil
				speechCount = 0
				silenceCnt = 0
				return
			}
			buf := speechBuf
			speechBuf = nil
			speechCount = 0
			silenceCnt = 0
			// Transcribe in a separate goroutine so the VAD loop is never blocked.
			go func() {
				wav := makePCMWAV(buf, pcmSampleRate)
				transcript, translation, err := h.transcribeUtterance(wav, fromLang, toLang)
				if err != nil {
					log.Printf("audio: transcribe error: %v", err)
					return
				}
				if transcript != "" {
					deliver(transcript, translation)
				}
			}()
		}

		for chunk := range chunkCh {
			energy := pcmRMS(chunk)

			if energy >= h.VAD.SpeechRMSMin {
				// Active speech — accumulate.
				speechBuf = append(speechBuf, chunk...)
				speechCount++
				silenceCnt = 0
				if speechCount >= h.VAD.MaxSpeechFrames {
					flush()
				}
			} else if speechCount > 0 {
				// Trailing silence after speech — keep buffering briefly.
				speechBuf = append(speechBuf, chunk...)
				silenceCnt++
				if silenceCnt >= h.VAD.SilenceToFlush {
					flush()
				}
			}
		}

		// Connection closed — flush whatever is buffered.
		flush()
	}()

	chunkCount := 0
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			log.Printf("audio: connection closed from=%s after %d chunks: %v",
				claims.UserID, chunkCount, err)
			break
		}
		// Minimum meaningful PCM chunk: 100 bytes (~25 samples).
		if len(data) < 100 {
			continue
		}
		chunkCount++

		select {
		case chunkCh <- data:
		default:
			log.Printf("audio: worker busy, dropping chunk #%d from=%s", chunkCount, claims.UserID)
		}
	}

	close(chunkCh)
	<-done
}

// transcribeUtterance posts a complete WAV utterance to the ml-service.
func (h *Handler) transcribeUtterance(wav []byte, srcLang, tgtLang string) (transcript, translation string, err error) {
	var body bytes.Buffer
	mpw := multipart.NewWriter(&body)

	fw, err := mpw.CreateFormFile("audio", "utterance.wav")
	if err != nil {
		return "", "", err
	}
	if _, err := io.Copy(fw, bytes.NewReader(wav)); err != nil {
		return "", "", err
	}
	mpw.Close()

	reqURL := h.MLURL + "/transcribe?src_lang=" + srcLang + "&tgt_lang=" + tgtLang
	req, err := http.NewRequest(http.MethodPost, reqURL, &body)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Content-Type", mpw.FormDataContentType())

	resp, err := h.MLClient.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	var result mlResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", "", err
	}
	return result.Transcript, result.Translation, nil
}
