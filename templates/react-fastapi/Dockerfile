FROM node:22-bookworm-slim AS frontend
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM python:3.11-slim-bookworm
COPY --from=ghcr.io/astral-sh/uv:0.12.16 /uv /bin/uv
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --locked --all-extras --no-dev
COPY backend/ ./
COPY --from=frontend /app/dist /app/dist
RUN useradd --uid 10001 --create-home app && mkdir -p /data && chown app:app /data
USER app
ENV ZELYQ_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK CMD ["/app/backend/.venv/bin/python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health/ready', timeout=3)"]
# Migrate this app's own SQLite database first — see app/prestart.py. Without
# it a fresh deploy has no tables and every data request fails.
CMD ["sh", "-c", "/app/backend/.venv/bin/python -m app.prestart && exec /app/backend/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000"]
