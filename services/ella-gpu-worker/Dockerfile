FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY workflows ./workflows
ENV PYTHONUNBUFFERED=1 COMFYUI_WORKFLOW=/app/workflows/video_api.json
EXPOSE 8000
CMD ["uvicorn", "app.main:APP", "--host", "0.0.0.0", "--port", "8000"]
