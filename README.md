# free2talk

Real-time multilingual video calling with live translated captions. Two users speaking different languages can video call and see each other's speech transcribed and translated as rolling subtitles.

**Supported languages:** English · Romanian · Japanese

---

## How it works

- WebRTC handles peer-to-peer video/audio directly between browsers
- An AudioWorklet captures raw PCM from the mic at 16 kHz and sends 50 ms Int16 chunks over a binary WebSocket
- The Go backend runs RMS energy VAD to detect utterance boundaries, then sends the complete utterance (WAV-wrapped) to the Python ML service
- faster-whisper transcribes the full utterance; NLLB-200 translates it; the caption is delivered to the peer
- Whisper receives complete sentences rather than fragments — captions appear in seconds with no repetition
- Chat messages are also auto-translated on send

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Go | 1.22+ | Backend |
| Node.js | 20+ | Frontend |
| Docker + Compose | any recent | PostgreSQL + LibreTranslate |
| Modal account | — | ML service runs on Modal serverless GPU (no local GPU needed) |

---

## Setup

### 1. Clone and configure environment

```bash
git clone <repo-url> free2talk
cd free2talk
cp .env.example .env
```

Edit `.env` and set a strong `JWT_SECRET` (minimum 32 characters):
```bash
# Generate a random secret
openssl rand -hex 32
```

Set `DEV_MODE=true` for local development (loosens CORS/origin checks).

### 2. Start infrastructure

```bash
docker compose up -d postgres libretranslate
```

LibreTranslate downloads language models on first start (~500MB). Wait until it prints `Running on http://0.0.0.0:5000` before starting the backend.

### 3. Deploy the ML service (Modal)

The ML service runs on [Modal](https://modal.com) (serverless GPU). Deploy it once:

```bash
cd ml-service
pip install modal
modal deploy modal_app.py
```

Copy the deployed URL printed by Modal and set it in `.env`:
```bash
ML_SERVICE_URL=https://octavian0073--free2talk-ml-<hash>.modal.run
```

**HuggingFace token (optional but recommended):** Speeds up the first NLLB-200-3.3B download (~6.6GB).
Create a secret named `huggingface` in Modal's dashboard with key `HF_TOKEN`.

**Warming up:** The first call after a cold start takes 60–120s for the container to spin up and load models. Use the admin warmup button in the app to pre-warm before a call.

### 5. Start the backend

```bash
cd backend
make run
```

Wait for: `free2talk backend running on 0.0.0.0:8000`

### 6. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

### 7. Open the app

- **https://localhost:5173** — HTTPS is required for microphone access (`getUserMedia`)
- Accept the self-signed certificate warning in your browser
- For LAN access from another device: **https://\<your-ip\>:5173** (same cert warning)

---

## Running order (summary)

```
Terminal 1:  docker compose up -d postgres libretranslate
Terminal 2:  modal deploy ml-service/modal_app.py   # one-time deploy; runs on Modal GPU
Terminal 3:  cd backend && make run
Terminal 4:  cd frontend && npm run dev
```

---

## LAN testing (two devices, same network)

1. Find your machine's local IP: `ip addr` or `hostname -I`
2. On the second device, open **https://\<your-ip\>:5173**
3. Accept the self-signed certificate warning
4. Register two accounts with different languages
5. Add each other as friends, then start a call

---

## Local testing (two browser sessions, one machine)

One browser tab can't share a camera with another. Options:

**Option A — Phone + laptop** (recommended): Use the LAN method above.

**Option B — Mock camera in one tab**: Paste this in one tab's DevTools console before calling:

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

**Option C — Virtual audio (PulseAudio/PipeWire)**:
```bash
pactl load-module module-null-sink sink_name=VirtualMic0 sink_properties=device.description=VirtualMic0
pactl load-module module-loopback source=VirtualMic0.monitor
```
Then select VirtualMic0.monitor as the microphone in the browser.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8000` | Go backend port |
| `DATABASE_URL` | — | PostgreSQL connection string |
| `JWT_SECRET` | — | HS256 signing secret, minimum 32 chars |
| `LIBRETRANSLATE_URL` | `http://localhost:5000` | LibreTranslate instance URL |
| `ML_SERVICE_URL` | — | Modal deployment URL (e.g. `https://octavian0073--free2talk-ml-*.modal.run`) |
| `DEV_MODE` | `false` | Set `true` for local dev (loosens CORS/origin checks) |
| `APP_ORIGIN` | — | Production frontend URL e.g. `https://free2talk.live` — added to CORS + WS origin allowlist |
| `TURN_HOST` | — | Hostname/IP of your Coturn server (e.g. `free2talk.live`) |
| `TURN_SECRET` | — | Coturn `use-auth-secret` value — used to generate time-limited HMAC credentials |
| `VAD_SPEECH_RMS_MIN` | `0.015` | RMS energy threshold below which audio is considered silence |
| `VAD_SILENCE_FRAMES` | `12` | Consecutive silent 50ms frames before flushing utterance (~600ms) |
| `VAD_MIN_SPEECH_FRAMES` | `3` | Minimum speech frames to prevent noise triggers (~150ms) |
| `VAD_MAX_SPEECH_FRAMES` | `200` | Hard cap on utterance length before forced flush (~10s) |

---

## Stack

| Layer | Technology |
|---|---|
| Backend | Go 1.22, chi router, gorilla/websocket, pgx |
| ML service | Python 3.11, FastAPI, faster-whisper, Hugging Face Transformers (NLLB-200-3.3B); deployed on Modal T4 GPU |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS |
| Database | PostgreSQL 16 |
| Translation (chat) | LibreTranslate (self-hosted Docker, OPUS-MT) |
| Audio capture | AudioWorklet (browser), raw Int16 PCM at 16 kHz |
| VAD | Go RMS energy VAD (pure math, no ML) |
| STT (captions) | faster-whisper `large-v3`, GPU (Modal) |
| Translation (captions) | NLLB-200-3.3B (`facebook/nllb-200-3.3B`), GPU (Modal) |
| Auth | JWT HS256, 24h expiry |
| Video | WebRTC (browser-native, STUN only) |

---

## Production deployment

The live instance runs at **https://free2talk.live** on an OVHCloud VPS (Ubuntu 22.04):

- Nginx reverse proxies `/api/*`, `/ws`, `/ws/audio`, `/health` to the Go backend on `127.0.0.1:8000`
- TLS via Let's Encrypt (certbot, auto-renewal)
- Coturn TURN server on ports 3478/5349 with HMAC-SHA1 time-limited credentials
- PostgreSQL and LibreTranslate in Docker, bound to localhost only
- Go backend runs as a systemd service with auto-restart
- ML service deployed on Modal T4 GPU — cold start ~60–120s, warm requests ~1s
- Daily DB backups to `~/backups_sql/`

To deploy an update:
```bash
cd ~/free2talk
git pull
cd backend && go build -o free2talk-server ./cmd/server/
sudo systemctl restart free2talk
cd ../frontend && npm run build
sudo cp -r dist/* /var/www/free2talk/
```

---

## Known limitations

- **Cold start latency** — Modal GPU container takes 60–120s to warm up after inactivity. Use the admin warmup button before a call.
- **No refresh tokens** — JWTs expire after 24h. Users must log in again.
- **No DB migrations tool** — schema changes require manual `ALTER TABLE`.
- **WebRTC NAT traversal** — TURN server is configured. Users behind symmetric NAT should be able to connect.
