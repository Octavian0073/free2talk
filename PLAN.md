# free2talk — Build Plan

## Overview
A real-time multilingual communication platform enabling voice/video calls and chat between users speaking different languages. Speech is transcribed, translated, and displayed as live captions. Chat messages are auto-translated on send.

## Supported Languages (MVP)
- English (en)
- Romanian (ro)
- Japanese (ja)

---

## Architecture Summary

```
Browser (React + TypeScript)
├── WebRTC peer connection       → video/audio directly peer-to-peer
├── MediaRecorder → WebSocket   → audio chunks to backend for STT/translate
├── WebSocket listener          → receives translated captions
└── WebSocket listener          → receives chat messages (translated)

Go Backend (main server)
├── REST API     → auth, user profile, message history
├── WebSocket hub → chat messages, call signaling, caption events
├── WebRTC signaling → relay offer/answer/ICE between peers
└── Audio relay  → receives chunks, POSTs to ML service, broadcasts captions

Python ML Microservice (internal)
├── faster-whisper (STT)        → EN/RO/JA speech → text
└── CTranslate2 + NLLB-200     → translation in all 6 directions

LibreTranslate (Docker)
└── Async chat message translation (higher quality, acceptable latency)

PostgreSQL
└── users, messages (original + translated), sessions, calls
```

---

## Technology Stack

| Layer | Choice | Reason |
|---|---|---|
| Backend | Go | Goroutine concurrency, pion/webrtc, low latency |
| ML Service | Python 3.11 | faster-whisper + CTranslate2 ecosystem |
| Translation (chat) | LibreTranslate (self-hosted Docker) | Free, OPUS-MT, EN/RO/JA support |
| Translation (captions) | NLLB-200 distilled 600M via CTranslate2 | Single model, all 6 direction pairs, fast |
| STT | faster-whisper `small` or `medium` | Local, fast, EN/RO/JA |
| Frontend | React 18 + TypeScript + Vite | Standard, WebRTC-friendly |
| Styling | Tailwind CSS | Fast MVP UI |
| Database | PostgreSQL 16 | Users, messages, history |
| Auth | JWT (Go `golang-jwt`) | Stateless, simple |
| Realtime | WebSocket (gorilla/websocket) | Chat + signaling + captions |
| Video | WebRTC (browser-native + pion for signaling) | Peer-to-peer video/audio |

---

## Directory Structure (Target)

```
free2talk/
├── PLAN.md                  ← this file
├── STATUS.md                ← current build status (updated each session)
├── prompt.txt               ← session resume instructions
├── docker-compose.yml       ← orchestrates postgres + libretranslate
│
├── backend/                 ← Go server
│   ├── cmd/server/main.go
│   ├── internal/
│   │   ├── auth/            ← JWT, password hashing
│   │   ├── user/            ← user model, repo, handlers
│   │   ├── chat/            ← message model, WebSocket hub, translation dispatch
│   │   ├── call/            ← WebRTC signaling, audio relay
│   │   └── db/              ← postgres connection, migrations
│   ├── go.mod
│   └── go.sum
│
├── ml-service/              ← Python STT + translation microservice
│   ├── main.py              ← FastAPI app
│   ├── stt.py               ← faster-whisper wrapper
│   ├── translate.py         ← CTranslate2 + NLLB-200 wrapper
│   ├── models/              ← downloaded model weights (gitignored)
│   └── requirements.txt
│
└── frontend/                ← React + TypeScript
    ├── src/
    │   ├── pages/
    │   │   ├── Login.tsx
    │   │   ├── Register.tsx
    │   │   ├── Chat.tsx
    │   │   └── Call.tsx
    │   ├── components/
    │   │   ├── VideoCall.tsx
    │   │   ├── CaptionOverlay.tsx
    │   │   ├── ChatWindow.tsx
    │   │   └── MessageBubble.tsx
    │   ├── hooks/
    │   │   ├── useWebSocket.ts
    │   │   ├── useWebRTC.ts
    │   │   └── useAudioCapture.ts
    │   ├── api/              ← REST client
    │   └── main.tsx
    ├── package.json
    └── vite.config.ts
```

---

## Build Phases

### Phase 1 — Foundation (Backend + Auth + DB) ✅
**Goal:** Users can register, log in, and set their preferred language.

Tasks:
- [x] Initialize Go module, project structure
- [x] PostgreSQL schema: `users`, `messages`, `calls`
- [x] Docker Compose: postgres + libretranslate
- [x] Go: auth handlers (register, login, JWT issue/verify)
- [x] Go: user profile handler (get/update language preference)
- [x] React: project scaffold (Vite + Tailwind)
- [x] React: Register page, Login page
- [x] React: Language selector on profile/onboarding

---

### Phase 2 — Chat with Auto-Translation ✅
**Goal:** Two users can exchange messages; each sees the other's message in their own language.

Tasks:
- [x] Go: WebSocket hub (connect, broadcast to rooms)
- [x] Go: Chat message handler — receive message, call LibreTranslate, store original + translated, deliver to recipient
- [x] PostgreSQL: store messages with `original_text`, `translated_text`, `source_lang`, `target_lang`
- [x] React: Chat page UI (contact list, message thread)
- [x] React: Message bubbles (sender sees own language, receiver sees translation)
- [x] Handle emoji/formatting passthrough (don't translate non-text tokens)

---

### Phase 3 — Basic Video Call ✅
**Goal:** Two users can start a video call and see/hear each other.

Tasks:
- [x] Go: WebRTC signaling via WebSocket (relay offer, answer, ICE candidates)
- [x] React: `useWebRTC` hook — getUserMedia, RTCPeerConnection, offer/answer flow
- [x] React: Call page — local + remote video, mute/end controls
- [x] STUN: use `stun:stun.l.google.com:19302` (free, no config)
- [x] Call state: initiate call, accept/reject, hang up

---

### Phase 4 — Live Translated Captions (Core Feature) ✅
**Goal:** During a call, each user's speech is transcribed and translated in near real-time, displayed as captions to the other user.

Tasks:
- [x] Python ML service: FastAPI app scaffold
- [x] Python: faster-whisper integration (load `small` model, transcribe audio chunk)
- [x] Python: CTranslate2 + NLLB-200 distilled integration (translate text, detect direction from lang codes)
- [x] Go: `/ws/audio` endpoint — receive binary audio chunks from browser, POST to ML service, receive transcript+translation, broadcast caption event to call room
- [x] React: `useAudioCapture` hook — MediaRecorder, send 1.5s chunks over WebSocket
- [x] React: `CaptionOverlay` component — displays translated captions over video, auto-fades old entries
- [x] Bidirectional captions verified on LAN (phone + laptop, both directions)

---

### Phase 5 — Polish & Stability (Pre-release)
- [ ] Error handling: disconnects, translation failures, STT failures (graceful degradation)
- [ ] Responsive UI for mobile
- [ ] Loading states, empty states
- [ ] Environment config (`.env` for all secrets/ports)
- [ ] Basic rate limiting on API
- [ ] README with local setup instructions

---

## Database Schema (Initial)

```sql
-- users
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    language_code TEXT NOT NULL DEFAULT 'en', -- 'en' | 'ro' | 'ja'
    created_at TIMESTAMPTZ DEFAULT now()
);

-- messages
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID REFERENCES users(id),
    recipient_id UUID REFERENCES users(id),
    original_text TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    source_lang TEXT NOT NULL,
    target_lang TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- calls (log only for MVP)
CREATE TABLE calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    caller_id UUID REFERENCES users(id),
    callee_id UUID REFERENCES users(id),
    started_at TIMESTAMPTZ DEFAULT now(),
    ended_at TIMESTAMPTZ
);
```

---

## Caption Latency Budget

| Step | Target |
|---|---|
| Audio chunk window | 1.5s |
| faster-whisper `small` inference | ~250ms |
| NLLB-200 translation | ~150ms |
| WebSocket round-trip | ~50ms |
| **Total caption delay** | **~2s** |

---

## Key External Dependencies

| Dependency | Version | Notes |
|---|---|---|
| `pion/webrtc` | v3 | Go WebRTC |
| `gorilla/websocket` | latest | Go WebSocket |
| `golang-jwt/jwt` | v5 | Go JWT |
| `lib/pq` or `pgx` | v5 | Go PostgreSQL driver |
| `faster-whisper` | latest | Python STT |
| `ctranslate2` | latest | Python translation runtime |
| `fastapi` + `uvicorn` | latest | Python HTTP service |
| LibreTranslate | Docker `libretranslate/libretranslate` | Chat translation |
| React 18 | latest | Frontend |
| Vite | latest | Frontend build |
| Tailwind CSS | v3 | Styling |

---

## Notes & Decisions

- **English as translation pivot for 3-way calls (future):** A→B can go A_lang→en→B_lang if direct pair not available. NLLB-200 handles direct pairs, so pivot is not needed for MVP.
- **No TURN server for MVP:** Peer-to-peer will fail on strict NATs. Add Coturn later if needed.
- **Audio format:** Browser sends WebM/Opus. faster-whisper handles this natively.
- **Session security:** JWTs expire in 24h. No refresh tokens for MVP.
- **LibreTranslate for chat, NLLB for captions:** LibreTranslate gives slightly better quality at the cost of HTTP overhead — fine for async chat. NLLB in-process is faster — required for real-time captions.
