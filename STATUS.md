# free2talk — Build Status

## Current Phase: Phase 5 — Polish & Stability (in progress)
## Last Completed Phase: Phase 4 — Live Translated Captions ✅

## Last Session: 2026-03-22 (session 4)

---

## Phase Checklist

### Phase 1 — Foundation ✅ COMPLETE

### Phase 2 — Chat with Auto-Translation ✅ COMPLETE
- [x] Go: `internal/chat` package scaffold
- [x] Go: WebSocket hub (in-memory client registry, keyed by user ID)
- [x] Go: JWT validation at WS upgrade time — from ?token= query param (F4)
- [x] Go: Origin header check before upgrade (F4)
- [x] Go: `GET /api/users` — display_name + language only, NO email (F5)
- [x] Go: `POST /api/messages` — sender_id from JWT, recipient_id from body + validate.UUID()
- [x] Go: `GET /api/messages/{user_id}` — WHERE (sender=me OR recipient=me) enforced in SQL (F3)
- [x] Go: LibreTranslate HTTP client with 5s timeout + fallback to original on error
- [x] Go: skip translation if sender_lang == recipient_lang
- [x] Go: store original + translated in DB, push translated to recipient WS
- [x] Go: ping/pong keepalive (pongWait=5min, pingInterval=2min — raised to survive Vite proxy)
- [x] React: wire ConversationSidebar to GET /api/users (PublicUser type, no email)
- [x] React: wire ConversationPane to WebSocket (receive) + HTTP POST (send)
- [x] React: WebSocketProvider (connect, reconnect with exponential backoff, receive, **pending send queue**)
- [x] React: message bubbles (own=right/original-text, received=left/translated-text)
- [x] React: loading + empty states in sidebar and pane

### Phase 2.5 — Username + Friends System ✅ COMPLETE
- [x] DB: add `username` column to users (unique, display as `@alice`)
- [x] DB: new `friendships` table (sender_id, receiver_id, status: pending|accepted)
- [x] Go: `GET /api/users/search?q=alice` — search by username with friendship status annotation
- [x] Go: `POST /api/friends/request` — send friend request by username
- [x] Go: `GET /api/friends/requests` — list incoming pending requests
- [x] Go: `POST /api/friends/accept/{id}` — accept a pending request
- [x] Go: `DELETE /api/friends/{id}` — decline or remove a friend
- [x] Go: `GET /api/friends` — accepted friends list (used by sidebar)
- [x] Go: POST /api/messages — enforces accepted friendship (403 otherwise)
- [x] React: sidebar shows friends list with @username + language flag
- [x] React: search bar debounced, shows Add/Pending/Friends/Check-requests per result
- [x] React: incoming friend request panel with Accept/Decline buttons
- [x] React: register page has @username field (validated live: lowercase, 3–20 chars)

### Phase 3 — Video Call ✅ COMPLETE
- [x] Go: `internal/call` package scaffold
- [x] Go: WebRTC signaling via WebSocket (offer, answer, ICE relay) — reuses existing WS hub
- [x] Go: call state (initiate, accept, reject, hang up) tracked in `calls` table
- [x] Go: Hub extended with `Route()` — stamps `from_id` server-side, strips routing field before forwarding
- [x] Go: allowedSignalingTypes whitelist (call_offer, call_answer, call_ice, call_accept, call_reject, call_hangup)
- [x] Go: friendship DB check in readPump before any signaling relay (prevents WS spam to arbitrary users)
- [x] Go: maxMessageSize raised to 32KB (SDP offer/answer ~2-4KB)
- [x] React: WebSocketContext — single WS connection at app root, subscribe/unsubscribe by type
- [x] React: useWebRTC hook (getUserMedia, RTCPeerConnection, offer/answer/ICE, toggleMute, toggleCamera)
- [x] React: CallOverlay component (remote video full-screen, local PiP, mute/camera/end controls)
- [x] React: IncomingCallModal (call_incoming WS event, 45s auto-dismiss, Accept/Decline)
- [x] React: ChatApp wired — handleCallStart, handleAcceptCall, handleDeclineCall

### Phase 4 — Live Translated Captions ✅ COMPLETE
- [x] Python: ml-service scaffold (FastAPI, lifespan startup)
- [x] Python: faster-whisper STT (small model, int8, pre-warm on startup)
- [x] Python: CTranslate2 + NLLB-200 distilled 600M (int8, all 6 lang pairs)
- [x] Python: ffmpeg dependency for WAV audio decoding
- [x] Python: download_models.py — one-time NLLB conversion + tokenizer download
- [x] Go: `GET /ws/audio` — JWT + friendship check before upgrade, binary PCM relay, caption delivery via Hub
- [x] Go: RMS energy VAD (`pcmRMS`), utterance accumulation, `makePCMWAV` WAV header wrapper
- [x] Go: `internal/audio` package wired in main.go; ML_SERVICE_URL env var
- [x] React: `audio-processor.js` AudioWorklet — 50ms chunks (800 samples), Float32→Int16, zero-copy transfer
- [x] React: `useAudioCapture` hook — AudioContext 16kHz + AudioWorkletNode, sends raw Int16 binary WS
- [x] React: CaptionOverlay component — rolling 2-line subtitle (new text appends to bottom line, promotes to top when full, clears after 5s silence)
- [x] **AudioWorklet pipeline verified (2026-03-21):** captions appear in seconds, no end-chunk repetition ✅
- [x] Both Go and TypeScript compile clean

### Phase 5 — Polish & Stability 🔄 IN PROGRESS

#### Bugs fixed this session (2026-03-19)
- [x] `upgrader()` returned value type — `cannot call pointer method Upgrade` compile error
- [x] `devMode` declared after first use in `main.go` — undefined compile error
- [x] Added `https://localhost:5173` and `https://localhost:3000` to `prodOrigins` in both `chat` and `audio` packages
- [x] Added `DEV_MODE=true` to `.env` — without it `make run` never set DevMode, all HTTPS WS connections rejected
- [x] Added `@vitejs/plugin-basic-ssl` + `https: true` to Vite — enables `getUserMedia` on LAN devices (requires secure context)
- [x] Added `host: '0.0.0.0'` to Vite — enables access from phone/other laptop on LAN
- [x] WS URLs changed from direct `ws://ip:8000` to proxy path `wss://host/ws` — fixes mixed content + firewall issues
- [x] Raised `pongWait` to 5min / `pingInterval` to 2min — Vite proxy consumes WS ping frames, backend was closing connection every 60s
- [x] `terminate(notifyPeer bool)` + `terminatedRef` guard — prevents double `api.endCall()` and PATCH 404
- [x] `acceptSentRef` + `offerSentRef` guards — prevents React StrictMode double-fire of signaling
- [x] `pendingCandidates` queue + `drainCandidates()` — ICE candidates arriving before `setRemoteDescription` were silently dropped
- [x] Removed `setCallState('ended')` from `cleanup()` — was causing false "call ended" flash during ringing
- [x] WS pending send queue in `WebSocketContext` — `call_accept` silently dropped if WS reconnecting on callee mount; now queued and drained on `onopen`
- [x] Mobile UI: `h-dvh`, single-panel layout, back button in ConversationPane, larger touch targets
- [x] `CallOverlay` auto-close 1.5s after 'ended' state

#### Completed this session (2026-03-19 session 2)
- [x] Added `changeOrigin: true` + explicit `/ws/audio` proxy rule to `vite.config.ts` — audio WS was being interrupted through Vite proxy
- [x] Fixed ML service startup — must use `uvicorn main:app --uds /tmp/free2talk-ml.sock` (Unix socket). Plain `python main.py` leaves socket missing → all transcription silently fails
- [x] CaptionOverlay redesigned — rolling 2-line subtitle replacing the stacked bubble approach
- [x] Caption pipeline verified end-to-end: EN speech → STT → EN→RO translation → caption on receiver screen ✅
- [x] LAN testing confirmed: phone + laptop on same WiFi, full call + captions working ✅
- [x] Local test method established: `paplay --device=VirtualMic0 /tmp/speech.wav` via espeak-ng WAV for reliable silent audio injection

#### Completed this session (2026-03-21 session 3) — AudioWorklet PCM Pipeline
- [x] Replaced MediaRecorder with AudioWorklet (`public/audio-processor.js`) — isolated audio thread, 50ms raw PCM chunks at 16kHz
- [x] `useAudioCapture.ts` rewritten — AudioContext (16kHz) + AudioWorkletNode, sends binary Int16 PCM over WS (no WebM, no init-chunk hack)
- [x] `handler.go` rewritten — RMS energy VAD in Go (`pcmRMS`), utterance accumulation, `makePCMWAV` WAV header; no ffmpeg in browser path
- [x] `ml-service/main.py` + `stt.py` restored to whisper+NLLB only (no Seamless)
- [x] End-chunk repetition eliminated — Whisper now receives complete utterances
- [x] Caption latency massively improved — text appears in ~1s after utterance ends

#### Completed this session (2026-03-22 session 4) — Modal GPU, NLLB-3.3B, Japanese UI
- [x] Migrated ML service from local uvicorn to **Modal serverless GPU** (T4)
  - `modal_app.py` replaces `main.py` + `stt.py` — single-file deployment
  - `startup_timeout=1200`, `scaledown_window=300`, `@modal.concurrent(max_inputs=4)`
  - HuggingFace token support via Modal secret (`huggingface`) + `hf-transfer` for fast downloads
- [x] Replaced Qwen 1.5B translation with **NLLB-200-3.3B** (`facebook/nllb-200-3.3B`)
  - `forced_bos_token_id` via `convert_tokens_to_ids` (fixed `TokenizersBackend` attribute error)
  - `no_repeat_ngram_size=4`, `repetition_penalty=1.3` — eliminates repetition loops
  - NLLB language codes: `eng_Latn`, `ron_Latn`, `jpn_Jpan`
- [x] Admin-only ML warmup endpoint (`GET /api/ml/warmup`)
  - SSE streaming — sends `warming` events every second with elapsed time, `ready` event on success
  - EventSource token query-param fallback in `middleware/auth.go` (EventSource can't send headers)
  - Frontend: `api.warmupML(onTick)` returns `Promise<void>`, live `Warming… Xs` counter on button
  - Warmup button hidden from non-admin users
- [x] Suppressed native browser video controls (play/pause overlay on mobile)
  - Global CSS in `index.css`: `::-webkit-media-controls` with `display: none !important`
- [x] **Japanese UI language toggle** — full app i18n (EN/JA)
  - New: `src/i18n/index.ts` — `as const` translations object, 50+ keys, function-valued interpolations
  - New: `src/context/UILangContext.tsx` — `UILangProvider` with localStorage persistence (`ui_lang`)
  - Updated: Landing, Login, Register, Profile, ChatApp, ConversationSidebar, ConversationPane, CallOverlay, IncomingCallModal
  - Toggle button (`日本語`/`EN`) on every page

#### Completed this session (2026-03-22 session 4, continued) — Production readiness
- [x] **TURN credentials endpoint** (`GET /api/turn-credentials`, auth required)
  - HMAC-SHA1 time-limited credentials (1h TTL) — compatible with Coturn `use-auth-secret`
  - Returns both `turn:HOST:3478` and `turns:HOST:5349` URLs
  - Graceful fallback to Google STUN if `TURN_HOST`/`TURN_SECRET` not set
- [x] **Dynamic ICE server fetching** in `useWebRTC.ts`
  - Fetches credentials from backend on call mount, falls back to STUN on error
  - Replaces hardcoded Google STUN-only config
- [x] **Production origin support** (`APP_ORIGIN` env var)
  - Added to CORS allowed origins list in main.go
  - Added to WS `CheckOrigin` in both `chat/handlers.go` and `audio/handler.go`
- [x] **i18n fix** — `ConversationPane` header "you see X" now uses `T.youSee(lang)` key
- [x] **VAD env vars documented** in README (were already implemented, just undocumented)

#### Remaining Phase 5 tasks
- [ ] Tune VAD thresholds (`speechRMSMin`, `silenceToFlush`) for different mic environments
- [ ] Graceful degradation: translation failure → deliver original text with label
- [ ] Graceful degradation: STT/caption failure → silent, no crash
- [ ] Production build test (`npm run build`, verify no source exposure)

#### VPS deployment checklist (next phase)
- [ ] DNS A record pointing to VPS IP
- [ ] Nginx — reverse proxy: static frontend + `/api/*` + `/ws/*` to backend port 8000
- [ ] TLS — Let's Encrypt via certbot, auto-renewal
- [ ] Coturn — install, configure `use-auth-secret`, open ports 3478/5349/49152-65535 UDP
- [ ] systemd unit for Go backend (auto-restart on crash/reboot)
- [ ] `npm run build` → copy `dist/` to Nginx web root
- [ ] Production `.env`: `APP_ORIGIN=https://free2talk.live`, `TURN_HOST=free2talk.live`, `TURN_SECRET`, `JWT_SECRET`, `DATABASE_URL`, `ML_SERVICE_URL`, no `DEV_MODE`
- [ ] Set `is_admin=true` for first admin user via psql

---

## Running the Project

### Start infrastructure
```bash
cd ~/cody/free2talk
docker compose up -d postgres libretranslate
```

### Start backend
```bash
cd ~/cody/free2talk
make run   # reads .env — DO NOT use go run directly (JWT_SECRET required)
```
Backend prints: `WARNING: DEV_MODE enabled` + `free2talk backend running on 0.0.0.0:8000`

### Start ML service
```bash
cd ~/cody/free2talk/ml-service
source .venv/bin/activate
uvicorn main:app --uds /tmp/free2talk-ml.sock
```
**IMPORTANT:** Must use `--uds /tmp/free2talk-ml.sock`. The Go backend connects via Unix socket at that path by default (`ML_SOCKET_PATH` defaults to `/tmp/free2talk-ml.sock`). Running with `python main.py` or plain TCP uvicorn means the socket file never exists → every transcription request fails with `dial unix: no such file or directory` → no captions, ever.

### Start frontend
```bash
cd ~/cody/free2talk/frontend
npm run dev
```

### URLs
- Frontend: **https://localhost:5173** (HTTPS required for getUserMedia)
- Backend API: http://localhost:8000
- Health check: http://localhost:8000/health
- LAN access: https://<host-ip>:5173 (accept self-signed cert warning)

---

## Local Test Setup (Two Browser Sessions, Same Machine)

### Prerequisite: Virtual audio devices
```bash
# Create virtual sinks (run once per boot)
pactl load-module module-null-sink sink_name=VirtualMic0 sink_properties=device.description=VirtualMic0
pactl load-module module-null-sink sink_name=VirtualMic1 sink_properties=device.description=VirtualMic1
pactl load-module module-loopback source=VirtualMic0.monitor
pactl load-module module-loopback source=VirtualMic1.monitor

# Route physical mic into VirtualMic0 (WITH HEADPHONES to avoid feedback)
pactl load-module module-loopback source=@DEFAULT_SOURCE@ sink=VirtualMic0 latency_msec=1
```

### Sessions
- **Session A (Chrome normal)** → https://localhost:5173 → register as Alice (lang: en) → mic: VirtualMic0.monitor
- **Session B (Chrome Incognito)** → https://localhost:5173 → register as Bob (lang: fr) → inject mock getUserMedia in console (canvas + silent audio) OR use VirtualMic1.monitor

### Mock getUserMedia (paste in Session B console before call)
```js
navigator.mediaDevices.getUserMedia = async () => {
  const ctx = new AudioContext()
  const dst = ctx.createMediaStreamDestination()
  const canvas = document.createElement('canvas')
  canvas.width = 640; canvas.height = 480
  const c = canvas.getContext('2d')
  setInterval(() => {
    c.fillStyle = `hsl(${Date.now()/50 % 360},70%,50%)`
    c.fillRect(0, 0, 640, 480)
    c.fillStyle = 'white'; c.font = '48px sans-serif'; c.fillText('BOB', 260, 260)
  }, 100)
  return new MediaStream([...canvas.captureStream(15).getVideoTracks(), ...dst.stream.getAudioTracks()])
}
```

### Test order
1. Auth (register + login both users)
2. Friends (send request, accept)
3. Chat (send messages, verify WS delivery + translation)
4. Video call (call, accept, verify video both sides, hangup → PATCH returns 200)
5. Captions (speak into VirtualMic0 → caption appears on Bob's screen)

---

## Security Properties

| Threat | Mitigation |
|---|---|
| Client setting is_admin on register | Not in registerRequest struct; not in INSERT; DB default = false |
| Forged admin JWT | AdminOnly re-queries DB every request; is_admin not in JWT claims |
| JWT algorithm attack (alg:none, HS384, RS256) | WithValidMethods(["HS256"]) + exact instance check in keyfunc |
| Empty/weak JWT secret | Startup refuses to boot if JWT_SECRET < 32 chars; jwt.go secondary guard |
| Deleted user JWT still valid | Auth middleware checks user EXISTS in DB after every JWT validation |
| Login timing / email enumeration | TimingDummyCheck() normalises bcrypt ~100ms on unknown-email path |
| No admin audit trail | admin_audit_log table; writeAudit() on toggle_admin, delete_user, view_messages |
| Brute force login/register | Rate limiter: 10 req/min/IP |
| Oversized request bodies | MaxBytesReader(16KB) on all JSON endpoints |
| Parameter pollution | DisallowUnknownFields() on all JSON decoders |
| IDOR via client-supplied user ID | All self-ops use mw.GetUserID(r) from JWT only |
| Malformed UUIDs in path params | validate.UUID() before every DB op on path params |
| Admin self-demotion / self-deletion | Blocked server-side in ToggleAdmin and DeleteUser |
| Wide-open CORS | Explicit origin allowlist; no wildcard |
| SQL injection | Parameterised $N placeholders throughout |
| Admin code loaded by non-admin users | AdminDashboard lazy-loaded; only fetched after is_admin confirmed |
| Server crash on abrupt kill | Graceful shutdown: 30s drain on SIGINT/SIGTERM |
| WS auth bypass (post-upgrade check) | JWT + DB existence check happen BEFORE websocket.Upgrade() (F4) |
| Cross-site WebSocket hijacking | CheckOrigin validates against explicit origin allowlist (F4) |
| Message IDOR (reading others' history) | SQL WHERE hard-enforces sender=me OR recipient=me (F3) |
| Email exposure in user list | SELECT omits email column entirely — not filtered after fetch (F5) |
| Client-forged sender identity | sender_id always from JWT context, never from request body |
| WS signaling to arbitrary users | Friendship DB check in readPump before any Route() call |
| Client-forged from_id in signaling | Route() overwrites from_id with authenticated client.userID |
| Oversized SDP payloads | maxMessageSize = 32KB; unknown WS message types silently dropped |

## Architecture Decisions (locked)
- Backend: Go, port 8000
- WebSocket: gorilla/websocket
- WS token transport: ?token= query param (browser WS API cannot set custom headers)
- WebRTC signaling: browser-native RTCPeerConnection + Go Hub relay
- ML service: Python, FastAPI, faster-whisper + HF Transformers NLLB-200-3.3B; deployed on Modal T4 GPU
- Chat translation: LibreTranslate (self-hosted Docker, localhost:5000)
- Caption translation: NLLB-200-3.3B (`facebook/nllb-200-3.3B`) on Modal GPU
- Frontend: React 18 + TypeScript + Vite + Tailwind, port 5173
- Database: PostgreSQL 16
- Auth: JWT HS256, 24h expiry, is_admin NOT in token
- Audio capture for captions: AudioWorklet (browser), raw Int16 PCM at 16 kHz, 50ms chunks over binary WS
- VAD: Go RMS energy VAD (pure math, no ML) — utterance-complete before sending to Whisper
- Audio format to ML service: WAV (RIFF header + raw Int16 PCM, constructed in Go)
- Dev HTTPS: @vitejs/plugin-basic-ssl (self-signed, required for getUserMedia on LAN)
- TURN credentials: backend generates HMAC-SHA1 time-limited creds (Coturn `use-auth-secret`); frontend fetches on call mount
- Production origins: `APP_ORIGIN` env var added to CORS allowlist + WS CheckOrigin in chat and audio handlers

## Known Tech Debt
- No DB migration tool — schema changes require manual ALTER TABLE on existing DBs
- No integration tests — all validation is manual
- LibreTranslate first-start is slow (model download); needs pre-warming note in README
- TURN server not configured — WebRTC will fail for users behind symmetric NAT (documented limitation for MVP)
- WS token in query string (?token=) is visible in server access logs — acceptable for MVP, revisit with cookie-based auth in Phase 5
