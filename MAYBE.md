# free2talk — Future Improvements (Maybe)

## Translation Model Upgrade

Current: NLLB-200 distilled 600M via CTranslate2 (~150ms/sentence on CPU)

### Option A — Upgrade NLLB to 1.3B (easiest, drop-in)
Same CTranslate2 ecosystem, no code changes, just a bigger model file. Japanese quality improves
meaningfully, Romanian stays excellent. ~400ms on CPU instead of 150ms.
```python
_model = ct2.Translator("facebook/nllb-200-distilled-1.3B", ...)
```

### Option B — Hybrid routing (best quality, moderate work)
Load both NLLB (for EN↔RO) and Qwen (for EN↔JA). Route by language pair in `main.py`. Only practical
with GPU for the Qwen path — otherwise EN↔JA is too slow.

### Option C — Qwen 2.5-1.5B (GPU only)
Single model, best Japanese quality, acceptable Romanian quality. GPU required. Replace `nllb.py`
with a `qwen.py` that wraps `llama-cpp-python` (GGUF Q4_K_M, ~1GB).

### Quality comparison

| Pair  | NLLB-200 600M | NLLB-200 1.3B | Qwen 2.5-1.5B |
|-------|--------------|--------------|---------------|
| EN→RO | ★★★★ | ★★★★ | ★★★ |
| RO→EN | ★★★★ | ★★★★ | ★★★ |
| EN→JA | ★★★  | ★★★½ | ★★★★ |
| JA→EN | ★★★  | ★★★½ | ★★★★ |

### Bottom line

- **No GPU** → Option A. Same code, better Japanese, Romanian stays solid. Zero latency risk.
- **Have a GPU (6GB+ VRAM)** → Option C (Qwen 2.5-1.5B GGUF) is worth it for Japanese.
  Option B (hybrid) gives best of both but doubles model load time at startup.
- **Qwen on CPU** → don't bother, it'll be slower than someone typing the translation manually.
