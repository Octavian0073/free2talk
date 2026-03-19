"""
One-time model pre-download script (optional).
faster-whisper downloads its Whisper weights automatically on first startup,
but running this script caches them before the first request.

    cd ml-service
    .venv/bin/python download_models.py

Translation is handled by LibreTranslate (no local model needed).
Start it with: docker compose up -d libretranslate
"""

from faster_whisper import WhisperModel

print("Downloading faster-whisper 'small' model weights…")
WhisperModel("small", device="cpu", compute_type="int8")
print("Done. Whisper model cached.")
