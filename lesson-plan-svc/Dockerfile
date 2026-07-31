FROM python:3.11-slim
WORKDIR /app
# tesseract is optional (image/scan OCR). Uncomment to enable:
# RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV PORT=8000
CMD ["sh","-c","uvicorn app:app --host :: --port ${PORT}"]
