from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import PlainTextResponse

from ..db import Database, loads_object, merged_settings
from ..deps import get_db, get_event_hub
from ..events import EventHub
from ..jobs import append_log, finish_job
from ..schemas import NodeCommandAck, NodeHeartbeat, NodeReport
from ..security import require_node
from ..serializers import public_assignment
from ..timeutil import iso_now

router = APIRouter(prefix="/api/node/v1", tags=["node"])
bootstrap_router = APIRouter(tags=["node"])


@bootstrap_router.get("/api/agent.sh", include_in_schema=False)
async def download_agent_script(request: Request, db: Database = Depends(get_db)) -> PlainTextResponse:
    master_url = _resolve_public_base_url(request, db)
    asset_dir = _node_asset_dir()
    agent_script = (asset_dir / "cert-node-agent.sh").read_text(encoding="utf-8")
    pull_script = (asset_dir / "cert-node-pull.sh").read_text(encoding="utf-8")
    service_unit = (asset_dir / "cert-puller.service").read_text(encoding="utf-8")
    timer_unit = (asset_dir / "cert-puller.timer").read_text(encoding="utf-8")
    content = _render_agent_installer(master_url, agent_script, pull_script, service_unit, timer_unit)
    return PlainTextResponse(content, media_type="text/x-shellscript; charset=utf-8")


@router.post("/heartbeat")
async def heartbeat(
    payload: NodeHeartbeat,
    request: Request,
    node: dict[str, Any] = Depends(require_node),
    db: Database = Depends(get_db),
    event_hub: EventHub = Depends(get_event_hub),
) -> dict[str, Any]:
    client_host = request.client.host if request.client else ""
    ip = payload.ip or client_host or node.get("ip") or ""
    cert_dir = payload.certDir or node.get("cert_dir") or "/etc/nginx/ssl"
    now = iso_now()
    db.execute(
        """
        UPDATE nodes
        SET ip = ?, cert_dir = ?, is_online = 1, last_heartbeat_at = ?, updated_at = ?
        WHERE id = ?
        """,
        (ip, cert_dir, now, now, node["id"]),
    )
    event_hub.publish(
        "node_heartbeat",
        "info",
        f"Heartbeat received from {node['name']}",
        {"nodeId": node["id"], "ip": ip, "version": payload.version},
    )
    return {"success": True, "serverTime": now}


@router.get("/assignments")
async def assignments(node: dict[str, Any] = Depends(require_node), db: Database = Depends(get_db)) -> dict[str, Any]:
    rows = db.query_all(
        """
        SELECT a.*, d.domain
        FROM node_assignments a
        JOIN domains d ON d.id = a.domain_id
        WHERE a.node_id = ?
        ORDER BY d.domain
        """,
        (node["id"],),
    )
    settings_row = db.query_one("SELECT value, updated_at FROM app_settings WHERE key = 'settings'")
    settings = merged_settings(settings_row["value"] if settings_row else "{}")
    webdav = settings.get("webdav", {})
    return {
        "nodeId": node["id"],
        "assignments": [public_assignment(row) for row in rows],
        "settingsUpdatedAt": settings_row.get("updated_at") if settings_row else None,
        "webdav": {
            "url": str(webdav.get("url") or ""),
            "auth": str(webdav.get("auth") or ""),
        },
    }


@router.get("/commands")
async def commands(node: dict[str, Any] = Depends(require_node), db: Database = Depends(get_db)) -> dict[str, Any]:
    rows = db.query_all(
        """
        SELECT * FROM node_commands
        WHERE node_id = ? AND status = 'pending'
        ORDER BY created_at ASC
        """,
        (node["id"],),
    )
    return {
        "nodeId": node["id"],
        "commands": [
            {
                "id": row["id"],
                "type": row["type"],
                "payload": loads_object(row.get("payload_json")),
                "createdAt": row["created_at"],
            }
            for row in rows
        ],
    }


@router.post("/reports")
async def report(
    payload: NodeReport,
    node: dict[str, Any] = Depends(require_node),
    db: Database = Depends(get_db),
    event_hub: EventHub = Depends(get_event_hub),
) -> dict[str, bool]:
    now = iso_now()
    failed = 0
    first_error: str | None = None
    for item in payload.items:
        if item.status == "error":
            failed += 1
            if first_error is None and item.lastError:
                first_error = item.lastError
        db.execute(
            """
            UPDATE node_assignments
            SET deployed_sha256 = ?,
                status = ?,
                expires_at = ?,
                last_error = ?,
                last_deploy_at = CASE
                    WHEN COALESCE(deployed_sha256, '') <> COALESCE(?, '')
                      OR COALESCE(status, '') <> COALESCE(?, '')
                      OR COALESCE(last_error, '') <> COALESCE(?, '')
                    THEN ?
                    ELSE last_deploy_at
                END,
                updated_at = ?
            WHERE node_id = ? AND domain_id = ?
            """,
            (
                item.deployedSha256,
                item.status,
                item.expiresAt,
                item.lastError,
                item.deployedSha256,
                item.status,
                item.lastError,
                now,
                now,
                node["id"],
                item.domainId,
            ),
        )

    db.execute(
        "UPDATE nodes SET last_error = ?, updated_at = ? WHERE id = ?",
        (first_error if failed else None, now, node["id"]),
    )

    if failed:
        event_hub.publish(
            "deploy_failed",
            "error",
            f"{failed} certificate deployment(s) failed on {node['name']}",
            {"nodeId": node["id"], "failed": failed},
        )
    else:
        event_hub.publish(
            "deploy_success",
            "success",
            f"Deployment report received from {node['name']}",
            {"nodeId": node["id"], "count": len(payload.items)},
        )
    return {"success": True}


@router.post("/commands/{command_id}/ack")
async def ack_command(
    command_id: str,
    payload: NodeCommandAck,
    node: dict[str, Any] = Depends(require_node),
    db: Database = Depends(get_db),
    event_hub: EventHub = Depends(get_event_hub),
) -> dict[str, Any]:
    row = db.query_one("SELECT * FROM node_commands WHERE id = ? AND node_id = ?", (command_id, node["id"]))
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "Command not found"})

    if row.get("status") != "pending":
        return {"success": True, "nodeId": node["id"], "commandId": command_id}

    now = iso_now()
    command_status = "failed" if payload.status == "failed" else "completed"
    db.execute(
        """
        UPDATE node_commands
        SET status = ?, acked_at = ?, completed_at = ?, last_error = ?, updated_at = ?
        WHERE id = ?
        """,
        (command_status, now, now, payload.error, now, command_id),
    )

    if row.get("job_id"):
        job = db.query_one("SELECT status FROM jobs WHERE id = ?", (row["job_id"],))
        if job and job.get("status") == "running":
            append_log(db, row["job_id"], f"[INFO] Node {node['name']} acknowledged command {command_id} ({row['type']}).")
            if payload.error:
                append_log(db, row["job_id"], f"[ERROR] {payload.error}")
            finish_job(
                db,
                event_hub,
                row["job_id"],
                status="failed" if payload.status == "failed" else "success",
                error=payload.error,
            )

    return {"success": True, "nodeId": node["id"], "commandId": command_id}


def _node_asset_dir() -> Path:
    bundled = Path("/opt/ssl-sync-node")
    if bundled.exists():
        return bundled

    parents = Path(__file__).resolve().parents
    if len(parents) >= 5:
        return parents[4]
    return Path.cwd()


def _resolve_public_base_url(request: Request, db: Database) -> str:
    settings_row = db.query_one("SELECT value FROM app_settings WHERE key = 'settings'")
    settings = merged_settings(settings_row["value"] if settings_row else "{}")
    configured = str(settings.get("node", {}).get("publicBaseUrl") or "").strip().rstrip("/")
    if configured:
        return configured
    return str(request.base_url).rstrip("/")


def _render_agent_installer(
    master_url: str,
    agent_script: str,
    pull_script: str,
    service_unit: str,
    timer_unit: str,
) -> str:
    master_url_literal = _shell_quote(master_url)
    return f"""#!/usr/bin/env bash
set -euo pipefail

TOKEN=""
MASTER_URL={master_url_literal}
CERT_DIR="/etc/ssl/certs/acme"
CONFIG_FILE="/etc/default/cert-node"

usage() {{
    echo "Usage: bash -s -- --token <node-token> [--master-url <url>] [--cert-dir <path>]" >&2
}}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --token)
            TOKEN="${{2:-}}"
            shift 2
            ;;
        --master-url)
            MASTER_URL="${{2:-}}"
            shift 2
            ;;
        --cert-dir)
            CERT_DIR="${{2:-}}"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            usage
            exit 1
            ;;
    esac
done

if [[ ${{EUID}} -ne 0 ]]; then
    echo "Please run this installer as root." >&2
    exit 1
fi

if [[ -z "${{TOKEN}}" ]]; then
    echo "Missing required --token argument." >&2
    usage
    exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl openssl python3

mkdir -p /usr/local/bin /etc/default /etc/systemd/system /var/log
install -d -m 700 "${{CERT_DIR}}"

cat > /usr/local/bin/cert-node-agent.sh <<'EOF_SSL_SYNC_NODE_AGENT'
{agent_script.rstrip()}
EOF_SSL_SYNC_NODE_AGENT
chmod 750 /usr/local/bin/cert-node-agent.sh

cat > /usr/local/bin/cert-node-pull.sh <<'EOF_SSL_SYNC_NODE_PULL'
{pull_script.rstrip()}
EOF_SSL_SYNC_NODE_PULL
chmod 750 /usr/local/bin/cert-node-pull.sh

cat > /etc/systemd/system/cert-puller.service <<'EOF_SSL_SYNC_NODE_SERVICE'
{service_unit.rstrip()}
EOF_SSL_SYNC_NODE_SERVICE

cat > /etc/systemd/system/cert-puller.timer <<'EOF_SSL_SYNC_NODE_TIMER'
{timer_unit.rstrip()}
EOF_SSL_SYNC_NODE_TIMER

if [[ -f "${{CONFIG_FILE}}" ]]; then
    cp "${{CONFIG_FILE}}" "${{CONFIG_FILE}}.bak.$(date '+%Y%m%d_%H%M%S')"
fi

cat > "${{CONFIG_FILE}}" <<EOF_SSL_SYNC_NODE_CONFIG
MASTER_URL='${{MASTER_URL}}'
NODE_TOKEN='${{TOKEN}}'
CERT_BASE_DIR='${{CERT_DIR}}'
TMP_BASE='/tmp/ssl_update'
TG_BOT_TOKEN=''
TG_CHAT_ID=''
SERVICE_TEST_CMD='nginx -t'
SERVICE_RELOAD_CMD='systemctl reload nginx'
LOG_FILE='/var/log/cert-node-pull.log'
NODE_NAME='$(hostname -s)'
DOMAINS=()
WEBDAV_URL=''
WEBDAV_AUTH=''
EOF_SSL_SYNC_NODE_CONFIG
chmod 600 "${{CONFIG_FILE}}"

install -m 640 /dev/null /var/log/cert-node-pull.log
systemctl daemon-reload
systemctl enable --now cert-puller.timer

echo "[INFO] Node agent installed successfully."
echo "[INFO] Config file: ${{CONFIG_FILE}}"
echo "[INFO] Trigger a manual sync with: systemctl start cert-puller.service"
echo "[INFO] Follow logs with: journalctl -u cert-puller -f"
"""


def _shell_quote(value: str) -> str:
    return "'" + value.replace("'", "'\"'\"'") + "'"
