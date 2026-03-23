# free2talk — Technical Architecture

A deep-dive into how the system works: data flow, component communication, protocol choices, and security model.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (React + TypeScript)             │
│                                                                 │
│  ┌──────────────┐   WebRTC (P2P)   ┌──────────────┐           │
│  │   User A     │◄────────────────►│   User B     │           │
│  │  (EN)        │                  │  (RO / JA)   │           │
│  └──────┬───────┘                  └──────┬───────┘           │
│         │ AudioWorklet PCM (16kHz)         │ captions (WS)     │
│         │ binary WS /ws/audio              │                   │
└─────────┼──────────────────────────────────┼───────────────────┘
          │                                  │
          ▼                                  ▲
┌─────────────────────────────────────────────────────────────────┐
│                     Go Backend (port 8000)                      │
│                                                                 │
│  REST API (/api/*)        WebSocket Hub (/ws)                  │
│  ├── auth                 ├── chat messages                     │
│  ├── users / friends      ├── call signaling                   │
│  ├── messages             └── caption delivery                  │
│  ├── calls                                                      │
│  └── TURN credentials     Audio Handler (/ws/audio)            │
│                           ├── RMS energy VAD                    │
│                           ├── utterance accumulator             │
│                           └── WAV wrapper → ML service          │
└──────────────┬──────────────────────────────────────────────────┘
               │ HTTP POST WAV
               ▼
┌──────────────────────────────────┐
│   Python ML Service (Modal GPU)  │
│                                  │
│  faster-whisper large-v3 (STT)   │
│  NLLB-200-3.3B (translation)     │
│  FastAPI + uvicorn               │
└──────────────────────────────────┘
```

---

## Component Breakdown

### 1. Browser (React 18 + TypeScript + Vite)

#### Authentication
- `Register` / `Login` pages POST to `/api/auth/register` and `/api/auth/login`
- JWT stored in `localStorage` — sent as `Authorization: Bearer <token>` on all REST calls
- WebSocket connections pass the JWT as `?token=<jwt>` query param (browser WS API cannot set custom headers)

#### WebSocket connection (`WebSocketContext`)
- Single persistent WebSocket per authenticated session at `wss://free2talk.live/ws?token=<jwt>`
- Reconnects with exponential backoff on disconnect
- Pending send queue — messages queued if WS is reconnecting, drained on `onopen`
- Subscribe/unsubscribe pattern: components register handlers by message type (e.g. `call_incoming`, `caption`, `chat_message`)

#### Chat (`ConversationPane`)
- Message history loaded via `GET /api/messages/{user_id}` on conversation open
- Messages sent via `POST /api/messages` (HTTP, not WS) — backend translates and stores, then pushes to recipient's WS
- Own messages show original text (right bubble); received messages show translated text (left bubble)

#### WebRTC call flow (`useWebRTC`)
1. Caller clicks call → `POST /api/calls` creates a call record → sends `call_offer` via WS Hub
2. Hub validates friendship in DB, stamps `from_id`, forwards to callee
3. Callee sees `IncomingCallModal` → accepts → sends `call_accept` via WS
4. Caller receives `call_accept` → creates `RTCPeerConnection`, fetches ICE servers from `GET /api/turn-credentials`
5. Caller creates SDP offer → sends `call_offer` (WebRTC signaling, reuses WS Hub)
6. Callee receives offer → creates answer → sends `call_answer`
7. Both sides exchange `call_ice` (ICE candidates) until P2P connection established
8. Video/audio flows directly peer-to-peer via WebRTC (never touches the server)
9. Either side sends `call_hangup` → Hub forwards → both sides call `PATCH /api/calls/{id}/end`

#### Audio capture for captions (`useAudioCapture`)
- `AudioContext` created at 16 kHz (not default 44.1 kHz) — matches Whisper's expected input
- `AudioWorkletNode` loads `public/audio-processor.js` into an isolated audio thread
- Worklet converts Float32 samples → Int16 (multiply by 32767, clamp) and posts 50ms ArrayBuffers (800 samples) to the main thread via zero-copy `transferable`
- Main thread sends each chunk as binary WebSocket message to `/ws/audio`

#### Caption display (`CaptionOverlay`)
- Rolling 2-line subtitle: new caption appends to bottom line, promotes to top when a new one arrives
- Captions clear after 5s of silence
- Rendered as absolute overlay over the remote video element

#### UI language (`UILangContext`)
- Supports EN / JA interface language toggle
- Translations stored in `src/i18n/index.ts` as `as const` objects — fully type-safe, 50+ keys
- Persisted in `localStorage` as `ui_lang`

---

### 2. Go Backend (`cmd/server/main.go`)

#### Router
Chi router with middleware stack:
- `httplog` — structured request logging
- `MaxBytesReader(16KB)` — all JSON endpoints
- `RateLimiter(10 req/min/IP)` — auth endpoints only
- `AuthMiddleware` — validates JWT HS256, checks user exists in DB, injects `userID` into context
- `AdminOnly` — re-queries `is_admin` from DB on every request (not from JWT claims)

#### Auth (`internal/auth`)
- `POST /api/auth/register` — validates username regex `^[a-z0-9_]{3,20}$`, bcrypt cost 12, inserts user
- `POST /api/auth/login` — constant-time bcrypt compare + `TimingDummyCheck()` on unknown-email path to prevent timing enumeration
- JWT claims: `user_id`, `email`, `exp` (24h), `nbf`, `iat`. `is_admin` is NOT in the token.
- JWT algorithm pinned to `HS256` via `WithValidMethods(["HS256"])` — rejects `alg:none` and RS256 attacks

#### WebSocket Hub (`internal/chat/hub.go`)
- In-memory registry: `map[string]*Client` keyed by `userID`
- Single-connection policy: new connection for same user replaces old one
- `Route(msg)` — stamps `from_id` from the authenticated client (client cannot forge sender), strips `to` field before forwarding to recipient
- Allowed signaling types whitelist: `call_offer`, `call_answer`, `call_ice`, `call_accept`, `call_reject`, `call_hangup`
- Friendship DB check before any `Route()` call — prevents WS spam to arbitrary users
- Ping/pong keepalive: `pongWait=5min`, `pingInterval=2min` (raised to survive Nginx/Vite proxy ping frame consumption)
- `maxMessageSize = 32KB` (SDP offer/answer are 2–4KB)

#### Chat messages (`internal/chat/handlers.go`)
- `POST /api/messages`: sender from JWT, recipient validated UUID, friendship enforced (403 if not friends), translates via LibreTranslate, stores `original_text` + `translated_text`, pushes translated message to recipient's WS connection
- `GET /api/messages/{user_id}`: SQL `WHERE (sender_id=$me AND recipient_id=$them) OR (sender_id=$them AND recipient_id=$me)` — IDOR-proof, ownership enforced in SQL

#### Audio relay (`internal/audio/handler.go`)
- `GET /ws/audio`: JWT validated + friendship checked BEFORE `websocket.Upgrade()`
- Receives binary Int16 PCM chunks (50ms, 800 samples at 16 kHz)
- RMS energy VAD:
  ```
  rms = sqrt(sum(sample² for sample in chunk) / len(chunk))
  ```
  - `speechRMSMin` (default 0.015) — threshold between speech and silence
  - `silenceToFlush` (default 12 frames = 600ms) — consecutive silent frames before flushing utterance
  - `minSpeechFrames` (default 3 = 150ms) — minimum to prevent noise triggers
  - `maxSpeechFrames` (default 200 = 10s) — hard cap, forces flush
- On flush: constructs WAV header (RIFF, PCM, 16-bit, mono, 16000 Hz) in-memory, POSTs to ML service
- On response: receives `{"transcript": "...", "translation": "..."}`, sends `caption` WS event to the peer via Hub

#### TURN credentials (`/api/turn-credentials`)
- HMAC-SHA1 time-limited credentials compatible with Coturn `use-auth-secret`
- Username format: `<expiry_unix_timestamp>:<userID>`
- Password: `base64(HMAC-SHA1(TURN_SECRET, username))`
- 1-hour TTL — credentials expire and cannot be reused after the call
- Returns both `turn:HOST:3478` and `turns:HOST:5349` URIs
- Falls back to Google STUN if `TURN_HOST` / `TURN_SECRET` not set

---

### 3. Python ML Service (Modal T4 GPU)

Deployed as a Modal serverless function — cold starts spin up a T4 GPU container, load models, and stay warm for 5 minutes after last request.

#### Models
- **faster-whisper large-v3** — OpenAI Whisper reimplemented in CTranslate2 format, ~3x faster than original Whisper, runs on GPU
- **NLLB-200-3.3B** (`facebook/nllb-200-3.3B`) — Meta's No Language Left Behind model, 200 language pairs, loaded via HuggingFace Transformers

#### Request flow
1. Go backend POSTs a WAV file (multipart form) with `src_lang` and `tgt_lang` params
2. faster-whisper transcribes the WAV → returns transcript text + detected language
3. NLLB-200 translates transcript from `src_lang` → `tgt_lang` using NLLB language codes (`eng_Latn`, `ron_Latn`, `jpn_Jpan`)
4. Returns `{"transcript": "...", "translation": "..."}`

#### Translation parameters
- `forced_bos_token_id` set via `convert_tokens_to_ids` for target language
- `no_repeat_ngram_size=4`, `repetition_penalty=1.3` — eliminates repetition loops common in NLLB
- `max_new_tokens=256` — caps output length

#### Concurrency
- `@modal.concurrent(max_inputs=4)` — up to 4 simultaneous transcription requests per container
- `scaledown_window=300` — container stays warm 5 minutes after last request

---

### 4. PostgreSQL Schema

```sql
users
├── id            UUID PK
├── email         TEXT UNIQUE NOT NULL
├── password_hash TEXT NOT NULL          -- bcrypt cost 12
├── display_name  TEXT NOT NULL
├── username      TEXT UNIQUE NOT NULL   -- @handle, ^[a-z0-9_]{3,20}$
├── language_code TEXT DEFAULT 'en'      -- 'en' | 'ro' | 'ja'
├── is_admin      BOOLEAN DEFAULT false  -- NOT in JWT; re-queried per request
└── created_at    TIMESTAMPTZ

messages
├── id              UUID PK
├── sender_id       UUID → users(id)
├── recipient_id    UUID → users(id)
├── original_text   TEXT                 -- what sender typed
├── translated_text TEXT                 -- translated to recipient's language
├── source_lang     TEXT
├── target_lang     TEXT
└── created_at      TIMESTAMPTZ

friendships
├── id          UUID PK
├── sender_id   UUID → users(id)
├── receiver_id UUID → users(id)
├── status      TEXT DEFAULT 'pending'   -- 'pending' | 'accepted'
├── created_at  TIMESTAMPTZ
├── UNIQUE(sender_id, receiver_id)
└── CHECK(sender_id <> receiver_id)

calls
├── id         UUID PK
├── caller_id  UUID → users(id)
├── callee_id  UUID → users(id)
├── status     TEXT DEFAULT 'pending'
├── started_at TIMESTAMPTZ
└── ended_at   TIMESTAMPTZ

admin_audit_log
├── id         UUID PK
├── admin_id   UUID → users(id)
├── action     TEXT    -- 'delete_user' | 'toggle_admin' | 'view_messages'
├── target_id  UUID
├── detail     TEXT
├── ip_address TEXT
└── created_at TIMESTAMPTZ
```

---

### 5. Nginx (Reverse Proxy)

```
HTTPS :443
├── location = /health       → proxy_pass :8000
├── location /api/           → proxy_pass :8000
├── location /ws/audio       → proxy_pass :8000 (WS upgrade, 1h timeout)
├── location /ws             → proxy_pass :8000 (WS upgrade, 1h timeout)
└── location /               → serve /var/www/free2talk (SPA fallback → index.html)

HTTP :80 → 301 redirect → HTTPS
```

`/ws/audio` must appear before `/ws` — Nginx uses longest prefix matching; without this ordering `/ws/audio` would match `/ws` first.

---

### 6. Coturn (TURN Server)

- Listens on `0.0.0.0:3478` (STUN/TURN) and `0.0.0.0:5349` (TURNS/TLS)
- `use-auth-secret` mode — no static username/password; credentials are HMAC-SHA1 signed and time-limited
- Relay port range: 49152–65535 UDP (open in UFW)
- TLS certificate: Let's Encrypt certs at `/etc/letsencrypt/live/free2talk.live/`
- Private IP ranges denied as relay targets (prevents SSRF via TURN)

---

## Data Flow: End-to-End Caption Pipeline

```
1. User A speaks into microphone
   └── Browser AudioContext (16 kHz) captures audio

2. AudioWorklet (audio-processor.js, isolated thread)
   └── Converts Float32 → Int16, posts 50ms ArrayBuffers (800 samples)

3. useAudioCapture (main thread)
   └── Sends binary Int16 chunk over WebSocket to wss://free2talk.live/ws/audio

4. Go audio/handler.go
   ├── Receives 50ms PCM chunk
   ├── Computes RMS energy
   ├── If RMS > 0.015: append to utterance buffer, reset silence counter
   ├── If RMS < 0.015: increment silence counter
   └── If silence counter >= 12 (600ms): FLUSH utterance

5. Go makePCMWAV()
   └── Wraps raw Int16 PCM in RIFF WAV header (44 bytes)
       RIFF chunk → fmt subchunk (PCM, mono, 16kHz, 16-bit) → data subchunk

6. Go HTTP POST to Modal ML service
   └── multipart/form-data: wav_file + src_lang + tgt_lang

7. Modal Python (T4 GPU)
   ├── faster-whisper.transcribe(wav) → transcript (e.g. "Hello how are you")
   └── NLLB-200.generate(transcript, tgt_lang) → translation (e.g. "Salut, ce mai faci")

8. Go receives {"transcript": "...", "translation": "..."}
   └── Builds caption WS message: {type: "caption", text: translation, speaker: userID}

9. Go Hub.Route() → sends caption to User B's WS connection

10. Browser (User B) WebSocketContext
    └── Dispatches to CaptionOverlay subscriber

11. CaptionOverlay
    └── Appends translated text to rolling 2-line subtitle display
```

**Total latency budget:**
| Step | Time |
|---|---|
| VAD silence flush (12 × 50ms) | ~600ms after last syllable |
| WAV construction | <1ms |
| Network to Modal | ~50ms |
| faster-whisper large-v3 | ~300ms |
| NLLB-200 translation | ~200ms |
| Network back + WS delivery | ~50ms |
| **Total** | **~1.2s after utterance ends** |

---

## Data Flow: WebRTC Call Setup

```
Caller                    Go Hub                    Callee
  │                          │                          │
  ├─ POST /api/calls ────────►│                          │
  │◄─ {call_id} ─────────────┤                          │
  │                          │                          │
  ├─ WS: call_offer ─────────►│                          │
  │  {to: calleeID,          │─ WS: call_incoming ──────►│
  │   call_id}               │  {from_id: callerID}     │
  │                          │                          │
  │                          │◄─ WS: call_accept ────────┤
  │◄─ WS: call_accept ───────┤                          │
  │                          │                          │
  ├─ RTCPeerConnection()     │                          │
  ├─ GET /api/turn-creds     │         RTCPeerConnection()
  │                          │         GET /api/turn-creds
  ├─ WS: call_offer (SDP) ───►│─ WS: call_offer (SDP) ───►│
  │                          │                          │
  │                          │◄─ WS: call_answer (SDP) ──┤
  │◄─ WS: call_answer ───────┤                          │
  │                          │                          │
  ├─ WS: call_ice ───────────►│─ WS: call_ice ───────────►│
  │◄─ WS: call_ice ───────────┤◄─ WS: call_ice ───────────┤
  │                          │                          │
  │◄═══════════════ WebRTC P2P video/audio ════════════►│
  │                          │                          │
  ├─ WS: call_hangup ─────────►│─ WS: call_hangup ─────────►│
  ├─ PATCH /api/calls/{id}/end►│         PATCH /api/calls/{id}/end
```

Note: The Hub stamps `from_id` server-side from the authenticated client's JWT — callers cannot forge the sender identity.

---

## Security Model

| Threat | Mitigation |
|---|---|
| JWT algorithm confusion (alg:none, RS256) | `WithValidMethods(["HS256"])` + exact key instance check |
| Weak JWT secret | Startup refuses to boot if `JWT_SECRET` < 32 chars |
| Deleted user JWT still valid | Auth middleware re-queries user existence in DB on every request |
| Login timing / email enumeration | `TimingDummyCheck()` normalises bcrypt ~100ms on unknown-email path |
| Brute force login/register | Rate limiter: 10 req/min/IP |
| SQL injection | Parameterised `$N` placeholders throughout — no string interpolation |
| IDOR (reading others' messages) | SQL `WHERE` enforces `sender=me OR recipient=me` — not filtered after fetch |
| Client forging sender identity | `sender_id` always from JWT context, never from request body |
| Client forging `from_id` in signaling | Hub `Route()` overwrites `from_id` with authenticated `client.userID` |
| WS signaling to arbitrary users | Friendship DB check in `readPump` before any `Route()` call |
| WS auth bypass (post-upgrade attack) | JWT + DB check happen BEFORE `websocket.Upgrade()` |
| Cross-site WebSocket hijacking | `CheckOrigin` validates against explicit allowlist (`APP_ORIGIN`) |
| Admin self-escalation on register | `is_admin` not in `registerRequest` struct; DB default = false |
| Forged admin JWT | `AdminOnly` re-queries `is_admin` from DB on every admin request |
| Admin self-demotion / self-deletion | Blocked server-side |
| Oversized request bodies | `MaxBytesReader(16KB)` on all JSON endpoints |
| Oversized SDP payloads | `maxMessageSize = 32KB`; unknown WS types silently dropped |
| Parameter pollution | `DisallowUnknownFields()` on all JSON decoders |
| CORS | Explicit origin allowlist; no wildcard `*` |
| Exposed internal services | Postgres + LibreTranslate bound to `127.0.0.1`; UFW denies 5432/5000/8000 |
| TURN credential reuse | HMAC-SHA1 credentials with 1-hour TTL |
| TURN as SSRF vector | Private IP ranges denied as relay targets in Coturn config |
| SSH brute force | fail2ban: 5 attempts → 1h ban |
| Password storage | bcrypt cost 12 |

---

## Friends System State Machine

```
User A                    User B
   │                         │
   ├─ POST /api/friends/request (username=@bob)
   │                         │
   │  friendship row: status='pending', sender=A, receiver=B
   │                         │
   │              GET /api/friends/requests
   │                         ├─ sees pending request from A
   │                         │
   │              POST /api/friends/accept/{id}
   │                         │
   │  friendship row: status='accepted'
   │                         │
   ├─ GET /api/friends ───── both see each other ────────┤
   │                         │
   │  Can now: send messages, start calls, route signaling
```

`DELETE /api/friends/{id}` works for both decline (pending) and unfriend (accepted).

---

## Directory Structure

```
free2talk/
├── backend/
│   ├── cmd/server/main.go          ← router, middleware, startup
│   └── internal/
│       ├── auth/handlers.go        ← register, login, JWT issue
│       ├── user/handlers.go        ← profile, language preference
│       ├── chat/
│       │   ├── hub.go              ← WS client registry, Route(), ping/pong
│       │   └── handlers.go         ← ServeWS, SendMessage, GetHistory, ListUsers
│       ├── friends/handlers.go     ← search, request, accept, decline, list
│       ├── call/handlers.go        ← InitiateCall, EndCall
│       ├── audio/handler.go        ← ServeAudioWS, RMS VAD, WAV wrap, ML POST
│       ├── admin/handlers.go       ← stats, user management, audit log
│       ├── db/schema.sql           ← full PostgreSQL schema
│       ├── middleware/             ← auth, admin, rate limiter
│       ├── translate/client.go     ← LibreTranslate HTTP client
│       └── validate/uuid.go        ← UUID validation helper
│
├── frontend/
│   ├── public/audio-processor.js   ← AudioWorklet (runs in audio thread)
│   └── src/
│       ├── context/
│       │   ├── WebSocketContext.tsx ← single WS, subscribe/unsubscribe
│       │   └── UILangContext.tsx    ← EN/JA UI language toggle
│       ├── hooks/
│       │   ├── useWebRTC.ts        ← RTCPeerConnection lifecycle
│       │   └── useAudioCapture.ts  ← AudioContext + AudioWorklet + binary WS
│       ├── components/
│       │   ├── CallOverlay.tsx     ← full-screen video call UI
│       │   ├── CaptionOverlay.tsx  ← rolling subtitle display
│       │   ├── IncomingCallModal.tsx
│       │   ├── ConversationPane.tsx
│       │   └── ConversationSidebar.tsx
│       ├── i18n/index.ts           ← EN/JA translation strings
│       └── api/client.ts           ← typed REST client
│
├── docker-compose.yml              ← postgres + libretranslate
├── PLAN.md                         ← architecture decisions, phase breakdown
├── STATUS.md                       ← build status, deployment checklist
└── ARCHITECTURE.md                 ← this file
```
