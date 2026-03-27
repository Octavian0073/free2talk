"""
free2talk ML service — Modal deployment.

Models:
  - faster-whisper large-v3            (CUDA float16)  — speech-to-text
  - Helsinki-NLP opus-mt-tc-big x4     (CUDA float16)  — translation
      ja→en, en→ja, en→ro, ro→en
    Specialized per-pair NMT models — no hallucination, ~300MB each vs 6.6GB NLLB.

The /transcribe endpoint is intentionally identical to the local FastAPI
service so the Go backend requires zero changes — only ML_SERVICE_URL and
ML_SOCKET_PATH change in .env.

One-time setup (run from project root):
  pip install modal
  modal token new
  modal volume create free2talk-models
  modal deploy ml-service/modal_app.py

On first container start, all models are downloaded from HuggingFace to the
persistent volume automatically. Subsequent starts load from the volume.
"""

import io
import os
import struct
import tempfile
import wave

import modal

# ---------------------------------------------------------------------------
# Container image
# ---------------------------------------------------------------------------
image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04",
        add_python="3.11",
    )
    .apt_install("ffmpeg")
    .pip_install([
        "faster-whisper>=1.0.3",
        "transformers>=4.43.0",
        "accelerate>=0.30.0",
        "torch>=2.3.0",
        "sentencepiece>=0.1.99",
        "hf-transfer>=0.1.8",
        "fastapi>=0.111.0",
        "python-multipart>=0.0.9",
        "uvicorn[standard]>=0.30.1",
    ])
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})
)

# ---------------------------------------------------------------------------
# Persistent volume — models download here on first start and are reused
# across container restarts, avoiding repeated large downloads.
# ---------------------------------------------------------------------------
volume = modal.Volume.from_name("free2talk-models", create_if_missing=True)

MODELS_DIR    = "/models"
WHISPER_CACHE = f"{MODELS_DIR}/whisper_cache"
OPUS_CACHE    = f"{MODELS_DIR}/opus_cache"

SUPPORTED_LANGS = {"en", "ro", "ja"}

# Specialized per-pair translation models — keyed by "src-tgt".
OPUS_MODELS = {
    "ja-en": "Helsinki-NLP/opus-mt-tc-big-ja-en",
    "en-ja": "Helsinki-NLP/opus-mt-tc-big-en-ja",
    "en-ro": "Helsinki-NLP/opus-mt-tc-big-en-ro",
    "ro-en": "Helsinki-NLP/opus-mt-tc-big-ro-en",
}

app = modal.App("free2talk-ml", image=image)


@app.cls(
    gpu="T4",                   # T4: 16GB VRAM — Whisper (~3GB) + NLLB-3.3B (~6.6GB) = ~9.6GB
    volumes={MODELS_DIR: volume},
    secrets=[modal.Secret.from_name("huggingface")],
    scaledown_window=300,       # stay warm 5 min after last request
    timeout=120,                # per-request timeout
    startup_timeout=1200,       # 20 min for first-time model download + load
)
@modal.concurrent(max_inputs=4)
class MLService:

    @modal.enter()
    def load_models(self):
        """Load all models once per container. Reused across all requests."""
        import torch
        from faster_whisper import WhisperModel
        from transformers import MarianMTModel, MarianTokenizer

        # Whisper large-v3
        self.whisper = WhisperModel(
            "large-v3",
            device="cuda",
            compute_type="float16",
            download_root=WHISPER_CACHE,
            num_workers=1,
        )

        # opus-mt-tc-big — one model per language pair, all loaded into VRAM.
        # ~300MB each, ~1.2GB total vs 6.6GB for NLLB-3.3B.
        self.translators = {}
        for pair, model_id in OPUS_MODELS.items():
            tokenizer = MarianTokenizer.from_pretrained(model_id, cache_dir=OPUS_CACHE)
            model = MarianMTModel.from_pretrained(
                model_id,
                torch_dtype=torch.float16,
                cache_dir=OPUS_CACHE,
            ).to("cuda").eval()
            self.translators[pair] = (model, tokenizer)

        # Warm up Whisper — pays CUDA JIT cost once at container start
        # so the first real utterance during a call is fast.
        self._warmup_whisper()

    def _warmup_whisper(self):
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
            list(self.whisper.transcribe(tmp, beam_size=1))
        finally:
            try:
                os.unlink(tmp)
            except FileNotFoundError:
                pass

    def _transcribe(self, audio_bytes: bytes, src_lang: str) -> str:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(audio_bytes)
            tmp = f.name
        try:
            segments, _ = self.whisper.transcribe(
                tmp,
                language=src_lang,
                beam_size=5,
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
        return ""

    def _translate(self, text: str, src_lang: str, tgt_lang: str) -> str:
        if src_lang == tgt_lang:
            return text

        import torch

        pair = f"{src_lang}-{tgt_lang}"
        if pair not in self.translators:
            return text

        model, tokenizer = self.translators[pair]

        inputs = tokenizer(
            text,
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=512,
        ).to("cuda")

        with torch.no_grad():
            output_ids = model.generate(
                **inputs,
                num_beams=4,
                early_stopping=True,
            )

        return tokenizer.decode(output_ids[0], skip_special_tokens=True).strip()

    @modal.asgi_app()
    def serve(self):
        """
        FastAPI app with the same /transcribe interface as the local ml-service.
        Go backend needs no code changes — only .env vars change.
        """
        import asyncio
        import logging
        import traceback

        from fastapi import FastAPI, File, HTTPException, Query, UploadFile
        from fastapi.responses import JSONResponse

        logging.basicConfig(level=logging.INFO)
        logger = logging.getLogger("ml-service")
        api = FastAPI()

        @api.post("/transcribe")
        async def transcribe(
            audio: UploadFile = File(...),
            src_lang: str = Query(..., description="en | ro | ja"),
            tgt_lang: str = Query(..., description="en | ro | ja"),
        ) -> JSONResponse:
            if src_lang not in SUPPORTED_LANGS or tgt_lang not in SUPPORTED_LANGS:
                raise HTTPException(
                    status_code=400,
                    detail=f"unsupported language — must be one of {SUPPORTED_LANGS}",
                )

            audio_bytes = await audio.read()
            if len(audio_bytes) < 100:
                return JSONResponse({"transcript": "", "translation": ""})

            try:
                transcript = await asyncio.to_thread(
                    self._transcribe, audio_bytes, src_lang
                )
                if not transcript:
                    return JSONResponse({"transcript": "", "translation": ""})

                translation = await asyncio.to_thread(
                    self._translate, transcript, src_lang, tgt_lang
                )
            except Exception as exc:
                logger.error("pipeline error: %s\n%s", exc, traceback.format_exc())
                raise HTTPException(status_code=500, detail="transcription failed")

            logger.info("[%s→%s] transcript=%r  translation=%r", src_lang, tgt_lang, transcript, translation)
            return JSONResponse({
                "transcript":  transcript,
                "translation": translation,
            })

        @api.get("/health")
        def health():
            return {"status": "ok", "backend": "whisper-large-v3+opus-mt-tc-big"}

        return api
