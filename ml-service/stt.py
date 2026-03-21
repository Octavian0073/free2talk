"""
Speech-to-text using faster-whisper (small model, CPU, int8).
Accepts WAV audio bytes; returns a transcript string.
"""

import io
import os
import struct
import tempfile
import wave

from faster_whisper import WhisperModel

_model: WhisperModel | None = None


def load() -> None:
    global _model
    cpu_threads = max(1, (os.cpu_count() or 4) // 2)
    _model = WhisperModel("large-v3", device="cuda", compute_type="float16", num_workers=2)
    _warmup()


def _warmup() -> None:
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
        list(_model.transcribe(tmp, beam_size=1))
    finally:
        os.unlink(tmp)


def transcribe(audio_bytes: bytes, language: str) -> str:
    if _model is None:
        raise RuntimeError("STT model not loaded — call stt.load() first")

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(audio_bytes)
        tmp = f.name
    try:
        segments, _ = _model.transcribe(
            tmp,
            language=language,
            beam_size=1,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 300},
            condition_on_previous_text=False,
        )
        return " ".join(s.text.strip() for s in segments).strip()
    finally:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
