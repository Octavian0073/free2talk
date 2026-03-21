"""
free2talk ML microservice — faster-whisper (STT) + NLLB-200 (translation).

Endpoints:
  POST /transcribe  — receive a WAV utterance, return transcript + translation
  GET  /health      — liveness probe
"""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse

import nllb
import stt

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ml-service")

SUPPORTED = {"en", "ro", "ja"}
MIN_AUDIO_BYTES = 100


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Loading faster-whisper (small, int8)…")
    stt.load()
    logger.info("Loading NLLB-200 distilled 600M…")
    nllb.load()
    logger.info("ML service ready")
    yield


app = FastAPI(lifespan=lifespan)


@app.post("/transcribe")
async def transcribe_endpoint(
    audio: UploadFile = File(...),
    src_lang: str = Query(..., description="Speaker language: en | ro | ja"),
    tgt_lang: str = Query(..., description="Target language: en | ro | ja"),
) -> JSONResponse:
    if src_lang not in SUPPORTED or tgt_lang not in SUPPORTED:
        raise HTTPException(status_code=400, detail=f"unsupported language — must be one of {SUPPORTED}")

    audio_bytes = await audio.read()
    if len(audio_bytes) < MIN_AUDIO_BYTES:
        return JSONResponse({"transcript": "", "translation": ""})

    try:
        transcript = await asyncio.to_thread(stt.transcribe, audio_bytes, src_lang)
        if not transcript:
            return JSONResponse({"transcript": "", "translation": ""})
        translation = await asyncio.to_thread(nllb.translate, transcript, src_lang, tgt_lang)
    except Exception as exc:
        logger.error("ML pipeline error: %s", exc)
        raise HTTPException(status_code=500, detail="transcription failed")

    return JSONResponse({"transcript": transcript, "translation": translation})


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "backend": "whisper+nllb"}
