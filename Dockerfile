FROM python:3.11-slim

WORKDIR /app

# Install supercronic (cron for containers, no root daemon needed)
# Install curl (kept for healthchecks) + supercronic
RUN apt-get update && apt-get install -y --no-install-recommends curl && \
    curl -fsSL https://github.com/aptible/supercronic/releases/download/v0.2.29/supercronic-linux-amd64 \
    -o /usr/local/bin/supercronic && \
    chmod +x /usr/local/bin/supercronic && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY fetch_portfolio.py db.py bot.py ui.py utils.py crontab \
     analyze_watchlist.py watchlist_manager.py ./

ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=${GIT_COMMIT}
ENV PYTHONUNBUFFERED=1

CMD ["python", "fetch_portfolio.py"]