"""
free2talk ML service — Modal deployment.

Models:
  - faster-whisper large-v3       (CUDA float16)  — speech-to-text
  - NLLB-200-3.3B                 (CUDA float16)  — translation (200 languages)

The /transcribe endpoint is intentionally identical to the local FastAPI
service so the Go backend requires zero changes — only ML_SERVICE_URL and
ML_SOCKET_PATH change in .env.

One-time setup (run from project root):
  pip install modal
  modal token new
  modal volume create free2talk-models
  modal deploy ml-service/modal_app.py

On first container start, both models are downloaded from HuggingFace to the
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
NLLB_CACHE    = f"{MODELS_DIR}/nllb_cache"
NLLB_MODEL_ID = "facebook/nllb-200-3.3B"

SUPPORTED_LANGS = {"en", "ro", "ja"}

# NLLB uses BCP-47 + script tags internally
NLLB_LANG_CODES = {
    "en": "eng_Latn",
    "ro": "ron_Latn",
    "ja": "jpn_Jpan",
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
        """Load both models once per container. Reused across all requests."""
        import torch
        from faster_whisper import WhisperModel
        from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

        # Whisper large-v3
        self.whisper = WhisperModel(
            "large-v3",
            device="cuda",
            compute_type="float16",
            download_root=WHISPER_CACHE,
            num_workers=1,
        )

        # NLLB-200-3.3B
        self.nllb_tokenizer = AutoTokenizer.from_pretrained(
            NLLB_MODEL_ID,
            cache_dir=NLLB_CACHE,
        )
        self.nllb_model = AutoModelForSeq2SeqLM.from_pretrained(
            NLLB_MODEL_ID,
            dtype=torch.float16,
            device_map="cuda",
            cache_dir=NLLB_CACHE,
        )
        self.nllb_model.eval()

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

        src_nllb = NLLB_LANG_CODES[src_lang]
        tgt_nllb = NLLB_LANG_CODES[tgt_lang]

        inputs = self.nllb_tokenizer(
            text,
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=512,
            src_lang=src_nllb,
        ).to("cuda")

        forced_bos_token_id = self.nllb_tokenizer.convert_tokens_to_ids(tgt_nllb)

        # Cap output length relative to input — prevents short inputs (1-2 words)
        # from causing hallucination loops. Minimum 20 tokens, max 128.
        input_token_count = inputs["input_ids"].shape[1]
        dynamic_max_new_tokens = min(128, max(20, input_token_count * 3))

        with torch.no_grad():
            output_ids = self.nllb_model.generate(
                **inputs,
                forced_bos_token_id=forced_bos_token_id,
                max_new_tokens=dynamic_max_new_tokens,
                max_length=None,          # override model's default generation_config
                num_beams=4,
                no_repeat_ngram_size=4,
                repetition_penalty=1.5,   # raised from 1.3 — short inputs need harder penalty
                early_stopping=True,
            )

        return self.nllb_tokenizer.decode(output_ids[0], skip_special_tokens=True).strip()

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
            return {"status": "ok", "backend": "whisper-large-v3+nllb-200-3.3b"}

        return api
