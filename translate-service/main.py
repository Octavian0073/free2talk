"""
free2talk translate-service
---------------------------
Thin FastAPI wrapper around NLLB-200-distilled-600M (CTranslate2 int8, CPU).
Exposes POST /translate with the same JSON contract as LibreTranslate so the
Go backend's translate.Client needs zero changes.

Request:  { "q": "...", "source": "en", "target": "ja", "format": "text" }
Response: { "translatedText": "..." }
"""
import logging
import os
from contextlib import asynccontextmanager

import ctranslate2
import sentencepiece as spm
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# NLLB language codes for the languages free2talk supports.
# Add more as needed — full list: https://github.com/facebookresearch/flores/blob/main/flores200/README.md
LANG_MAP: dict[str, str] = {
    "en": "eng_Latn",
    "ja": "jpn_Jpan",
    "ro": "ron_Latn",
    "fr": "fra_Latn",
    "de": "deu_Latn",
    "es": "spa_Latn",
    "zh": "zho_Hans",
    "ko": "kor_Hang",
    "pt": "por_Latn",
    "it": "ita_Latn",
    "ru": "rus_Cyrl",
    "ar": "arb_Arab",
}

MODEL_DIR = os.getenv("MODEL_DIR", "nllb-600m-ct2")

# Module-level globals — loaded once at startup.
_translator: ctranslate2.Translator | None = None
_sp: spm.SentencePieceProcessor | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _translator, _sp
    log.info("Loading NLLB model from %s ...", MODEL_DIR)
    _translator = ctranslate2.Translator(
        MODEL_DIR,
        device="cpu",
        inter_threads=int(os.getenv("INTER_THREADS", "2")),
        intra_threads=int(os.getenv("INTRA_THREADS", "2")),
    )
    _sp = spm.SentencePieceProcessor()
    _sp.Load(os.path.join(MODEL_DIR, "sentencepiece.bpe.model"))
    log.info("Model ready.")
    yield
    log.info("Shutting down translate-service.")


app = FastAPI(title="free2talk translate-service", lifespan=lifespan)


class TranslateRequest(BaseModel):
    q: str
    source: str
    target: str
    format: str = "text"


class TranslateResponse(BaseModel):
    translatedText: str


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_DIR}


@app.post("/translate", response_model=TranslateResponse)
def translate(req: TranslateRequest) -> TranslateResponse:
    # Pass-through if same language.
    if req.source == req.target:
        return TranslateResponse(translatedText=req.q)

    src_lang = LANG_MAP.get(req.source)
    tgt_lang = LANG_MAP.get(req.target)

    if not src_lang or not tgt_lang:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported language pair: {req.source!r} → {req.target!r}",
        )

    if not _translator or not _sp:
        raise HTTPException(status_code=503, detail="Model not loaded")

    # Tokenise with the source language prefix.
    tokens = [src_lang] + _sp.Encode(req.q, out_type=str)

    results = _translator.translate_batch(
        [tokens],
        target_prefix=[[tgt_lang]],
        max_decoding_length=512,
        no_repeat_ngram_size=4,
        repetition_penalty=1.3,
    )

    # Drop the forced target-language token at position 0.
    output_tokens = results[0].hypotheses[0][1:]
    translated = _sp.Decode(output_tokens)

    return TranslateResponse(translatedText=translated)
