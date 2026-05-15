from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request

from ..db import Database
from ..deps import get_db, get_event_hub
from ..events import EventHub
from ..schemas import NodeHeartbeat, NodeReport
from ..security import require_node
from ..serializers import public_assignment
from ..timeutil import iso_now

router = APIRouter(prefix="/api/node/v1", tags=["node"], dependencies=[Depends(require_node)])


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
    settings = db.query_one("SELECT value FROM app_settings WHERE key = 'settings'")
    return {
        "nodeId": node["id"],
        "assignments": [public_assignment(row) for row in rows],
        "settingsUpdatedAt": settings.get("updated_at") if settings else None,
    }


@router.get("/commands")
async def commands(node: dict[str, Any] = Depends(require_node)) -> dict[str, Any]:
    return {"nodeId": node["id"], "commands": []}


@router.post("/reports")
async def report(
    payload: NodeReport,
    node: dict[str, Any] = Depends(require_node),
    db: Database = Depends(get_db),
    event_hub: EventHub = Depends(get_event_hub),
) -> dict[str, bool]:
    now = iso_now()
    failed = 0
    for item in payload.items:
        if item.status == "error":
            failed += 1
        db.execute(
            """
            UPDATE node_assignments
            SET deployed_sha256 = ?, status = ?, expires_at = ?, last_error = ?, last_deploy_at = ?, updated_at = ?
            WHERE node_id = ? AND domain_id = ?
            """,
            (
                item.deployedSha256,
                item.status,
                item.expiresAt,
                item.lastError,
                now,
                now,
                node["id"],
                item.domainId,
            ),
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
async def ack_command(command_id: str, node: dict[str, Any] = Depends(require_node)) -> dict[str, Any]:
    return {"success": True, "nodeId": node["id"], "commandId": command_id}
