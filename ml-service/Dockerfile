# ============================================================
# XSJPRD55 ML Service — Python FastAPI Docker Image
# Random Forest + XGBoost + RL Decision Agent
# ============================================================

FROM python:3.11-slim

WORKDIR /app

# Install system deps
RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for layer caching
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app/ ./app/

# Create models directory
RUN mkdir -p /app/models

# Expose ML service port
EXPOSE 8010

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8010/health').read()"

# Start with uvicorn
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8010"]
