"""
Text translation using NLLB-200 distilled 600M (CTranslate2 int8).
Loaded from local cache — no network calls at runtime.
"""

import os

import ctranslate2
from transformers import AutoTokenizer

MODEL_DIR = os.path.join(os.path.dirname(__file__), "models", "nllb-200-distilled-600M-int8")

# NLLB language codes for the three supported languages
LANG_CODES = {
    "en": "eng_Latn",
    "ro": "ron_Latn",
    "ja": "jpn_Jpan",
}

_translator: ctranslate2.Translator | None = None
_tokenizer = None


def load() -> None:
    """Load the NLLB CTranslate2 translator and tokenizer from local cache."""
    global _translator, _tokenizer
    _translator = ctranslate2.Translator(MODEL_DIR, device="cpu", inter_threads=2)
    # Tokenizer files are in the same directory
    _tokenizer = AutoTokenizer.from_pretrained(MODEL_DIR, local_files_only=True)


def translate(text: str, src_lang: str, tgt_lang: str) -> str:
    """
    Translate text from src_lang to tgt_lang.

    Args:
        text:     Input text.
        src_lang: Source language code: 'en', 'ro', or 'ja'.
        tgt_lang: Target language code: 'en', 'ro', or 'ja'.

    Returns:
        Translated string, or original text on error.
    """
    if _translator is None or _tokenizer is None:
        raise RuntimeError("NLLB model not loaded — call nllb.load() first")
    if src_lang == tgt_lang:
        return text

    src_code = LANG_CODES[src_lang]
    tgt_code = LANG_CODES[tgt_lang]

    _tokenizer.src_lang = src_code
    tokens = _tokenizer.convert_ids_to_tokens(_tokenizer.encode(text))
    target_prefix = [tgt_code]

    results = _translator.translate_batch(
        [tokens],
        target_prefix=[target_prefix],
        max_decoding_length=256,
        beam_size=2,
    )
    translated_tokens = results[0].hypotheses[0][1:]  # strip target lang token
    return _tokenizer.decode(_tokenizer.convert_tokens_to_ids(translated_tokens), skip_special_tokens=True)
