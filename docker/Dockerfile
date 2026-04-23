FROM python:3.11-slim

WORKDIR /project

# Install curl for healthchecks
RUN apt-get update && apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app/ ./app/

# Ensure data directories exist
RUN mkdir -p data/json

# Non-root user for security
RUN useradd -m appuser && chown -R appuser:appuser /project
USER appuser

ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=${GIT_COMMIT}
ENV PYTHONUNBUFFERED=1

CMD ["python", "-m", "app.graph.runner"]
