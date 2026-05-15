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
| `SSL_SYNC_MASTER_SCRIPT` | `/usr/local/bin/cert-master-sync.sh` | Master sync script path |
| `SSL_SYNC_RUNTIME_CONFIG_DIR` | `/etc/ssl-cert-sync` | Runtime-generated per-domain shell config directory |
| `SSL_SYNC_RUNTIME_TMP_DIR` | `/tmp/ssl-sync-runtime` | Temporary workspace for DNS tests and staging files |

## Current Execution Mode

The API is fully stateful and persists domains, DNS channels, nodes, assignments, jobs, and events in SQLite.

Web console actions now execute real operations:

- DNS channel test runs a real `acme.sh --staging` DNS challenge against a bound domain
- WebDAV test performs live `PUT` / `GET` / `DELETE` verification
- Telegram test sends a real bot message
- Domain issue / renew call `cert-master-sync.sh` for the selected domain
- Domain sync exports the current local certificate and uploads it to WebDAV

The only remaining metadata-only action is node-side `Run Now`, because the node agent pull/command queue is not wired into the Web backend yet.
