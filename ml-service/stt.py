"""
Speech-to-text using faster-whisper (small model, CPU, int8).
Accepts WebM/Opus audio bytes; returns a transcript string.
"""

import io
import os
import struct
import tempfile
import wave

from faster_whisper import WhisperModel

_model: WhisperModel | None = None


def load() -> None:
    """Load the Whisper model and pre-warm it to reduce first-request latency."""
    global _model
    _model = WhisperModel("small", device="cpu", compute_type="int8")
    _warmup()


def _warmup() -> None:
    """Transcribe 0.1 s of silence so the JIT is ready before real requests arrive."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(16000)
        wf.writeframes(struct.pack("<" + "h" * 1600, *([0] * 1600)))
    buf.seek(0)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(buf.read())
        tmp = f.name
    try:
        list(_model.transcribe(tmp, beam_size=1))  # type: ignore[union-attr]
    finally:
        os.unlink(tmp)


def transcribe(audio_bytes: bytes, language: str) -> str:
    """
    Transcribe audio_bytes (WebM/Opus container) to text.

    Args:
        audio_bytes: Raw bytes of a self-contained WebM/Opus file.
        language:    BCP-47 short code: 'en', 'ro', or 'ja'.

    Returns:
        Transcript string (empty string if no speech detected).
    """
    if _model is None:
        raise RuntimeError("STT model not loaded — call stt.load() first")

    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
        f.write(audio_bytes)
        tmp = f.name
    try:
        segments, _ = _model.transcribe(
            tmp,
            language=language,
            beam_size=1,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 300},
        )
        return " ".join(s.text.strip() for s in segments).strip()
    finally:
        os.unlink(tmp)
