# SSL Sync Master Backend

FastAPI backend for the SSL certificate sync management console.

## Local Development

```bash
cd web/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8080
```

Default login:

- Username: `admin`
- Password: `admin`

Override before production:

```bash
export SSL_SYNC_SECRET_KEY="$(openssl rand -hex 32)"
export SSL_SYNC_ADMIN_USERNAME="admin"
export SSL_SYNC_ADMIN_PASSWORD="change-this"
```

## Environment

| Variable | Default | Description |
| --- | --- | --- |
| `SSL_SYNC_DATA_DIR` | `web/backend/.data` | SQLite state directory |
| `SSL_SYNC_DB_PATH` | `$SSL_SYNC_DATA_DIR/ssl-sync.db` | SQLite database path |
| `SSL_SYNC_LOG_DIR` | `web/backend/.logs` | Runtime log directory |
| `SSL_SYNC_FRONTEND_DIST` | `web/frontend/dist` | Built frontend directory to serve |
| `SSL_SYNC_SECRET_KEY` | `change-me-before-production` | HMAC key for admin tokens |
| `SSL_SYNC_ADMIN_USERNAME` | `admin` | Admin login username |
| `SSL_SYNC_ADMIN_PASSWORD` | `admin` | Admin login password |
| `SSL_SYNC_CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Dev CORS origins |
| `SSL_SYNC_ENABLE_SCRIPT_EXEC` | `false` | Reserved switch for real script execution |
| `SSL_SYNC_MASTER_SCRIPT` | `/usr/local/bin/cert-master-sync.sh` | Master sync script path |

## Current Execution Mode

The API is fully stateful and persists domains, DNS channels, nodes, assignments, jobs, and events in SQLite.

Certificate issue/renew/sync actions currently run in safe metadata mode by default. This keeps the Web UI and backend state functional while avoiding accidental root-level certificate actions. The next integration step is to adapt `cert-master-sync.sh` to accept a domain argument and wire it behind `SSL_SYNC_ENABLE_SCRIPT_EXEC=1`.
