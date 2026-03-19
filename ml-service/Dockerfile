FROM python:3.11-slim

# ffmpeg is required by faster-whisper to decode WebM/Opus audio
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY *.py ./

# Model weights are volume-mounted at runtime (see docker-compose.yml).
# Run download_models.py on the host first to populate ./models/.
VOLUME ["/app/models"]

EXPOSE 8001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
