FROM python:3.11-slim

WORKDIR /app

# Install supercronic (cron for containers, no root daemon needed)
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://github.com/aptible/supercronic/releases/download/v0.2.29/supercronic-linux-amd64 \
    -o /usr/local/bin/supercronic && \
    chmod +x /usr/local/bin/supercronic && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY fetch_portfolio.py db.py bot.py ui.py utils.py crontab ./

ENV PYTHONUNBUFFERED=1

CMD ["python", "fetch_portfolio.py"]