"""
free2talk ML microservice — STT only.
Translation is handled by the Go backend via LibreTranslate.

Endpoints:
  POST /transcribe  — receive a WebM/Opus audio chunk, return transcript
  GET  /health      — liveness probe
"""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse

import stt

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ml-service")

SUPPORTED = {"en", "ro", "ja"}
MIN_AUDIO_BYTES = 100


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Loading STT model (faster-whisper small, int8)…")
    stt.load()
    logger.info("ML service ready.")
    yield


app = FastAPI(lifespan=lifespan)


@app.post("/transcribe")
async def transcribe_endpoint(
    audio: UploadFile = File(...),
    lang: str = Query(..., description="Speaker language: en | ro | ja"),
) -> JSONResponse:
    """
    Transcribe a WebM/Opus audio chunk and return the transcript.
    Translation is handled by the Go backend.
    """
    if lang not in SUPPORTED:
        raise HTTPException(status_code=400, detail=f"unsupported language — must be one of {SUPPORTED}")

    audio_bytes = await audio.read()
    if len(audio_bytes) < MIN_AUDIO_BYTES:
        return JSONResponse({"transcript": "", "lang": lang})

    try:
        transcript = await asyncio.to_thread(stt.transcribe, audio_bytes, lang)
    except Exception as exc:
        logger.error("STT error: %s", exc)
        raise HTTPException(status_code=500, detail="transcription failed")

    return JSONResponse({"transcript": transcript, "lang": lang})


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
