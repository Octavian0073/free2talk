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
| Node.js | 18+ | Frontend |
| Python | 3.11+ | ML service |
| Docker + Compose | any recent | PostgreSQL + LibreTranslate |
| ffmpeg | any | Required by faster-whisper for WAV/audio decoding |

Install ffmpeg on Arch/Ubuntu:
```bash
# Arch
sudo pacman -S ffmpeg

# Ubuntu/Debian
sudo apt install ffmpeg
```

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

## Known limitations

- **No TURN server** — WebRTC uses STUN only. Connections between users behind symmetric NAT (some corporate networks, mobile carriers) may fail. Add Coturn for production.
- **STUN servers** — Google's public STUN (`stun.l.google.com:19302`) is used. Replace with your own in production.
- **Self-signed TLS** — Vite's `@vitejs/plugin-basic-ssl` is used for local dev. Production needs a real certificate (Let's Encrypt via certbot).
- **No refresh tokens** — JWTs expire after 24h. Users must log in again.
- **No DB migrations tool** — schema changes require manual `ALTER TABLE`.
