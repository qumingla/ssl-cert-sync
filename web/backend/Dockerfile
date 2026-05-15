FROM node:22-alpine AS frontend
WORKDIR /src/web/frontend
COPY web/frontend/package*.json ./
RUN npm ci
COPY web/frontend ./
RUN npm run build

FROM python:3.12-slim AS backend
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SSL_SYNC_DATA_DIR=/var/lib/ssl-cert-sync \
    SSL_SYNC_LOG_DIR=/var/log/ssl-cert-sync \
    SSL_SYNC_FRONTEND_DIST=/app/frontend-dist

WORKDIR /app
COPY web/backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY web/backend/app /app/app
COPY --from=frontend /src/web/frontend/dist /app/frontend-dist

EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
