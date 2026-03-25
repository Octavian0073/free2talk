#!/usr/bin/env python3
"""
One-time setup: downloads facebook/nllb-200-distilled-600M from HuggingFace
and converts it to CTranslate2 int8 format.

Run once on the VPS before starting the service:
    python download_model.py
"""
import subprocess
import sys
import os

OUTPUT_DIR = "nllb-600m-ct2"

if os.path.isdir(OUTPUT_DIR) and os.listdir(OUTPUT_DIR):
    print(f"Model already exists at {OUTPUT_DIR}/  — delete it to re-convert.")
    sys.exit(0)

print("Downloading + converting facebook/nllb-200-distilled-600M to CTranslate2 int8...")
print("This will download ~1.2 GB and may take a few minutes.\n")

converter = os.path.join(os.path.dirname(sys.executable), "ct2-transformers-converter")
subprocess.run(
    [
        converter,
        "--model", "facebook/nllb-200-distilled-600M",
        "--output_dir", OUTPUT_DIR,
        "--quantization", "int8",
        "--force",
    ],
    check=True,
)

print(f"\nConversion done. Saving tokenizer locally...")
from transformers import NllbTokenizer
tokenizer = NllbTokenizer.from_pretrained("facebook/nllb-200-distilled-600M")
tokenizer.save_pretrained(OUTPUT_DIR)
print(f"Done. Model + tokenizer saved to {OUTPUT_DIR}/")
