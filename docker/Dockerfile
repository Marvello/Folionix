# syntax=docker/dockerfile:1.7
FROM python:3.11-slim

WORKDIR /project

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    apt-get update && \
    apt-get install -y --no-install-recommends curl

# Install deps from pyproject alone so source edits don't invalidate this layer
COPY pyproject.toml ./
RUN --mount=type=cache,target=/root/.cache/pip \
    python -c "import tomllib; print('\n'.join(tomllib.load(open('pyproject.toml','rb'))['project']['dependencies']))" > /tmp/requirements.txt && \
    pip install -r /tmp/requirements.txt

COPY src/ ./src/
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-deps .

RUN useradd -m appuser && chown -R appuser:appuser /project
USER appuser

ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=${GIT_COMMIT}
ENV PYTHONUNBUFFERED=1
# `app` is installed into site-packages by `pip install .` (runtime deps only).

CMD ["python", "-m", "app.graph.runner"]
