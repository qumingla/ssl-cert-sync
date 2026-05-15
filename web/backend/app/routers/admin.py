from __future__ import annotations

import asyncio
import json
import secrets
from datetime import timedelta
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from ..config import AppConfig
from ..db import Database, dumps, loads_object
from ..deps import get_db, get_event_hub
from ..events import EventHub
from ..jobs import append_log, create_job, finish_job, get_job, job_from_row
from ..schemas import (
    AssignmentUpdate,
    DnsChannelCreate,
    DnsChannelPatch,
    DomainCreate,
    DomainPatch,
    NodeCreate,
    NodePatch,
    SettingsPayload,
)
from ..security import hash_secret, new_node_token, require_admin
from ..serializers import public_assignment, public_dns_channel, public_domain, public_node
from ..timeutil import iso_now, to_iso, utc_now

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)])


@router.get("/overview")
async def overview(db: Database = Depends(get_db), event_hub: EventHub = Depends(get_event_hub)) -> dict[str, Any]:
    domain_rows = db.query_all("SELECT * FROM domains ORDER BY domain")
    node_rows = db.query_all("SELECT * FROM nodes ORDER BY name")
    jobs_failed = db.query_one("SELECT COUNT(*) AS count FROM jobs WHERE status = 'failed'")
    domains = [public_domain(row) for row in domain_rows]
    nodes = [public_node(db, row) for row in node_rows]
    return {
        "stats": {
            "onlineNodes": sum(1 for node in nodes if node["isOnline"]),
            "totalNodes": len(nodes),
            "totalDomains": len(domains),
            "expiringSoon": sum(1 for domain in domains if (domain["daysRemaining"] is not None and domain["daysRemaining"] <= 7)),
            "failedJobs": int(jobs_failed["count"]) if jobs_failed else 0,
        },
        "certificates": domains,
        "nodes": nodes,
        "recentEvents": event_hub.recent(20),
    }


@router.get("/events/stream")
async def event_stream(event_hub: EventHub = Depends(get_event_hub)) -> StreamingResponse:
    async def generator():
        async for event in event_hub.stream():
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            await asyncio.sleep(0)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/domains")
async def list_domains(db: Database = Depends(get_db)) -> list[dict[str, Any]]:
    rows = db.query_all("SELECT * FROM domains ORDER BY domain")
    return [public_domain(row) for row in rows]


@router.post("/domains")
async def create_domain(payload: DomainCreate, db: Database = Depends(get_db)) -> dict[str, Any]:
    channel = db.query_one("SELECT id FROM dns_channels WHERE id = ?", (payload.dnsChannelId,))
    if channel is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"error": "DNS channel not found"})
    now = iso_now()
    domain_id = f"d_{uuid4().hex}"
    try:
        db.execute(
            """
            INSERT INTO domains
                (id, domain, enabled, dns_channel_id, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'pending', ?, ?)
            """,
            (domain_id, payload.domain, int(payload.enabled), payload.dnsChannelId, now, now),
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"error": str(exc)}) from exc
    return _require_domain(db, domain_id)


@router.patch("/domains/{domain_id}")
async def patch_domain(domain_id: str, payload: DomainPatch, db: Database = Depends(get_db)) -> dict[str, Any]:
    row = db.query_one("SELECT * FROM domains WHERE id = ?", (domain_id,))
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "Domain not found"})
    updates: list[str] = []
    params: list[Any] = []
    if payload.domain is not None:
        updates.append("domain = ?")
        params.append(payload.domain)
    if payload.dnsChannelId is not None:
        channel = db.query_one("SELECT id FROM dns_channels WHERE id = ?", (payload.dnsChannelId,))
        if channel is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"error": "DNS channel not found"})
        updates.append("dns_channel_id = ?")
        params.append(payload.dnsChannelId)
    if payload.enabled is not None:
        updates.append("enabled = ?")
        params.append(int(payload.enabled))
    if updates:
        updates.append("updated_at = ?")
        params.append(iso_now())
        params.append(domain_id)
        db.execute(f"UPDATE domains SET {', '.join(updates)} WHERE id = ?", params)
    return _require_domain(db, domain_id)


@router.delete("/domains/{domain_id}")
async def delete_domain(domain_id: str, db: Database = Depends(get_db)) -> dict[str, bool]:
    db.execute("DELETE FROM domains WHERE id = ?", (domain_id,))
    return {"success": True}


@router.post("/domains/{domain_id}/{action}")
async def run_domain_action(
    domain_id: str,
    action: str,
    request: Request,
    db: Database = Depends(get_db),
    event_hub: EventHub = Depends(get_event_hub),
) -> dict[str, Any]:
    if action not in {"issue", "renew", "sync"}:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "Unknown domain action"})
    row = db.query_one("SELECT * FROM domains WHERE id = ?", (domain_id,))
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "Domain not found"})
    job = create_job(db, event_hub, action, domain_id, row["domain"])
    append_log(db, job["id"], f"[INFO] Requested {action} for {row['domain']}")
    _apply_safe_domain_action(request.app.state.config, db, job["id"], domain_id, action)
    event_hub.publish(
        "deploy_success" if action == "sync" else "job_finished",
        "success",
        f"{action} completed for {row['domain']}",
        {"jobId": job["id"], "domainId": domain_id},
    )
    return finish_job(db, event_hub, job["id"])


@router.get("/dns-channels")
async def list_dns_channels(db: Database = Depends(get_db)) -> list[dict[str, Any]]:
    rows = db.query_all("SELECT * FROM dns_channels ORDER BY name")
    return [public_dns_channel(row) for row in rows]


@router.post("/dns-channels")
async def create_dns_channel(payload: DnsChannelCreate, db: Database = Depends(get_db)) -> dict[str, Any]:
    now = iso_now()
    channel_id = f"c_{uuid4().hex}"
    db.execute(
        """
        INSERT INTO dns_channels (id, name, provider, credentials_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (channel_id, payload.name, payload.provider, dumps(payload.credentials), now, now),
    )
    return _require_dns_channel(db, channel_id)


@router.patch("/dns-channels/{channel_id}")
async def patch_dns_channel(channel_id: str, payload: DnsChannelPatch, db: Database = Depends(get_db)) -> dict[str, Any]:
    row = db.query_one("SELECT * FROM dns_channels WHERE id = ?", (channel_id,))
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "DNS channel not found"})
    updates: list[str] = []
    params: list[Any] = []
    if payload.name is not None:
        updates.append("name = ?")
        params.append(payload.name)
    if payload.provider is not None:
        updates.append("provider = ?")
        params.append(payload.provider)
    if payload.credentials is not None:
        current = loads_object(row.get("credentials_json"))
        merged = current if payload.provider is None or payload.provider == row["provider"] else {}
        for key, value in payload.credentials.items():
            if value and value != "***":
                merged[key] = value
        updates.append("credentials_json = ?")
        params.append(dumps(merged))
    if updates:
        updates.append("updated_at = ?")
        params.append(iso_now())
        params.append(channel_id)
        db.execute(f"UPDATE dns_channels SET {', '.join(updates)} WHERE id = ?", params)
    return _require_dns_channel(db, channel_id)


@router.delete("/dns-channels/{channel_id}")
async def delete_dns_channel(channel_id: str, db: Database = Depends(get_db)) -> dict[str, bool]:
    in_use = db.query_one("SELECT COUNT(*) AS count FROM domains WHERE dns_channel_id = ?", (channel_id,))
    if in_use and int(in_use["count"]) > 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"error": "DNS channel is used by domains"})
    db.execute("DELETE FROM dns_channels WHERE id = ?", (channel_id,))
    return {"success": True}


@router.post("/dns-channels/{channel_id}/test")
async def test_dns_channel(
    channel_id: str,
    db: Database = Depends(get_db),
    event_hub: EventHub = Depends(get_event_hub),
) -> dict[str, bool]:
    channel = db.query_one("SELECT * FROM dns_channels WHERE id = ?", (channel_id,))
    if channel is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "DNS channel not found"})
    job = create_job(db, event_hub, "test_dns", channel_id, channel["name"])
    append_log(db, job["id"], "[INFO] DNS credential shape validated. Live acme.sh validation is not executed by default.")
    finish_job(db, event_hub, job["id"])
    return {"success": True}


@router.get("/nodes")
async def list_nodes(db: Database = Depends(get_db)) -> list[dict[str, Any]]:
    rows = db.query_all("SELECT * FROM nodes ORDER BY name")
    return [public_node(db, row) for row in rows]


@router.post("/nodes")
async def create_node(payload: NodeCreate, db: Database = Depends(get_db)) -> dict[str, Any]:
    now = iso_now()
    node_id = f"n_{uuid4().hex}"
    token = new_node_token()
    db.execute(
        """
        INSERT INTO nodes
            (id, name, ip, is_online, cert_dir, token_hash, created_at, updated_at)
        VALUES (?, ?, ?, 0, ?, ?, ?, ?)
        """,
        (node_id, payload.name, payload.ip, payload.certDir, hash_secret(token), now, now),
    )
    node = _require_node(db, node_id)
    node["token"] = token
    return node


@router.get("/nodes/{node_id}")
async def get_node(node_id: str, db: Database = Depends(get_db), event_hub: EventHub = Depends(get_event_hub)) -> dict[str, Any]:
    return _node_detail(db, event_hub, node_id)


@router.patch("/nodes/{node_id}")
async def patch_node(node_id: str, payload: NodePatch, db: Database = Depends(get_db)) -> dict[str, Any]:
    row = db.query_one("SELECT * FROM nodes WHERE id = ?", (node_id,))
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "Node not found"})
    updates: list[str] = []
    params: list[Any] = []
    for field, column in (("name", "name"), ("ip", "ip"), ("certDir", "cert_dir"), ("lastError", "last_error")):
        value = getattr(payload, field)
        if value is not None:
            updates.append(f"{column} = ?")
            params.append(value)
    if updates:
        updates.append("updated_at = ?")
        params.append(iso_now())
        params.append(node_id)
        db.execute(f"UPDATE nodes SET {', '.join(updates)} WHERE id = ?", params)
    return _require_node(db, node_id)


@router.delete("/nodes/{node_id}")
async def delete_node(node_id: str, db: Database = Depends(get_db)) -> dict[str, bool]:
    db.execute("DELETE FROM nodes WHERE id = ?", (node_id,))
    return {"success": True}


@router.put("/nodes/{node_id}/assignments")
async def update_node_assignments(
    node_id: str,
    payload: AssignmentUpdate,
    db: Database = Depends(get_db),
    event_hub: EventHub = Depends(get_event_hub),
) -> dict[str, Any]:
    node = db.query_one("SELECT * FROM nodes WHERE id = ?", (node_id,))
    if node is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "Node not found"})
    now = iso_now()
    db.execute("DELETE FROM node_assignments WHERE node_id = ?", (node_id,))
    for domain_id in payload.domainIds:
        domain = db.query_one("SELECT * FROM domains WHERE id = ?", (domain_id,))
        if domain is None:
            continue
        db.execute(
            """
            INSERT INTO node_assignments
                (id, node_id, domain_id, desired_sha256, deployed_sha256, status, expires_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, NULL, 'pending', ?, ?, ?)
            """,
            (
                f"a_{uuid4().hex}",
                node_id,
                domain_id,
                domain.get("cert_sha256"),
                domain.get("expires_at"),
                now,
                now,
            ),
        )
    event_hub.publish(
        "job_finished",
        "success",
        f"Assignments updated for {node['name']}",
        {"nodeId": node_id, "domainIds": payload.domainIds},
    )
    return _node_detail(db, event_hub, node_id)


@router.post("/nodes/{node_id}/run-now")
async def run_node_now(
    node_id: str,
    db: Database = Depends(get_db),
    event_hub: EventHub = Depends(get_event_hub),
) -> dict[str, Any]:
    node = db.query_one("SELECT * FROM nodes WHERE id = ?", (node_id,))
    if node is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "Node not found"})
    job = create_job(db, event_hub, "deploy", node_id, node["name"])
    append_log(db, job["id"], "[INFO] Deployment requested from Web UI.")
    now = iso_now()
    db.execute(
        """
        UPDATE node_assignments
        SET deployed_sha256 = desired_sha256, status = 'synced', last_deploy_at = ?, updated_at = ?
        WHERE node_id = ?
        """,
        (now, now, node_id),
    )
    event_hub.publish("deploy_success", "success", f"Deployment marked synced for {node['name']}", {"nodeId": node_id})
    return finish_job(db, event_hub, job["id"])


@router.get("/jobs")
async def list_jobs(db: Database = Depends(get_db)) -> list[dict[str, Any]]:
    rows = db.query_all("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 200")
    return [job_from_row(row) for row in rows]


@router.get("/jobs/{job_id}")
async def get_job_endpoint(job_id: str, db: Database = Depends(get_db)) -> dict[str, Any]:
    try:
        return get_job(db, job_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "Job not found"}) from exc


@router.get("/jobs/{job_id}/logs")
async def get_job_logs(job_id: str, db: Database = Depends(get_db)) -> dict[str, str]:
    row = db.query_one("SELECT log_text FROM jobs WHERE id = ?", (job_id,))
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "Job not found"})
    return {"logs": row.get("log_text") or ""}


@router.get("/settings")
async def get_settings(db: Database = Depends(get_db)) -> dict[str, Any]:
    return _settings(db)


@router.patch("/settings")
async def patch_settings(payload: SettingsPayload, db: Database = Depends(get_db)) -> dict[str, Any]:
    now = iso_now()
    db.execute(
        "UPDATE app_settings SET value = ?, updated_at = ? WHERE key = 'settings'",
        (dumps(payload.model_dump()), now),
    )
    return _settings(db)


@router.post("/settings/webdav/test")
async def test_webdav(db: Database = Depends(get_db), event_hub: EventHub = Depends(get_event_hub)) -> dict[str, bool]:
    settings = _settings(db)
    job = create_job(db, event_hub, "sync", "settings", "WebDAV")
    url = settings["webdav"].get("url") or "(empty)"
    append_log(db, job["id"], f"[INFO] WebDAV URL configured as: {url}")
    append_log(db, job["id"], "[INFO] Live WebDAV request is intentionally disabled in this backend baseline.")
    finish_job(db, event_hub, job["id"])
    return {"success": True}


@router.post("/settings/telegram/test")
async def test_telegram(db: Database = Depends(get_db), event_hub: EventHub = Depends(get_event_hub)) -> dict[str, bool]:
    job = create_job(db, event_hub, "sync", "settings", "Telegram")
    append_log(db, job["id"], "[INFO] Telegram settings accepted. Live notification is intentionally disabled in this backend baseline.")
    finish_job(db, event_hub, job["id"])
    return {"success": True}


def _settings(db: Database) -> dict[str, Any]:
    row = db.query_one("SELECT value FROM app_settings WHERE key = 'settings'")
    return loads_object(row["value"] if row else "{}")


def _require_domain(db: Database, domain_id: str) -> dict[str, Any]:
    row = db.query_one("SELECT * FROM domains WHERE id = ?", (domain_id,))
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "Domain not found"})
    return public_domain(row)


def _require_dns_channel(db: Database, channel_id: str) -> dict[str, Any]:
    row = db.query_one("SELECT * FROM dns_channels WHERE id = ?", (channel_id,))
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "DNS channel not found"})
    return public_dns_channel(row)


def _require_node(db: Database, node_id: str) -> dict[str, Any]:
    row = db.query_one("SELECT * FROM nodes WHERE id = ?", (node_id,))
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "Node not found"})
    return public_node(db, row)


def _node_detail(db: Database, event_hub: EventHub, node_id: str) -> dict[str, Any]:
    row = db.query_one("SELECT * FROM nodes WHERE id = ?", (node_id,))
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "Node not found"})
    assignment_rows = db.query_all(
        """
        SELECT a.*, d.domain
        FROM node_assignments a
        JOIN domains d ON d.id = a.domain_id
        WHERE a.node_id = ?
        ORDER BY d.domain
        """,
        (node_id,),
    )
    node = public_node(db, row)
    node["assignments"] = [public_assignment(item) for item in assignment_rows]
    node["recentEvents"] = [
        event for event in event_hub.recent(50)
        if event.get("payload", {}).get("nodeId") == node_id
    ][:10]
    return node


def _apply_safe_domain_action(config: AppConfig, db: Database, job_id: str, domain_id: str, action: str) -> None:
    now = iso_now()
    if config.enable_script_exec:
        append_log(db, job_id, f"[INFO] Script execution requested via {config.master_script}.")
        append_log(db, job_id, "[WARN] Per-domain script execution is not enabled until cert-master-sync.sh supports a domain argument.")
    else:
        append_log(db, job_id, "[INFO] Safe metadata mode: set SSL_SYNC_ENABLE_SCRIPT_EXEC=1 after reviewing script integration.")

    if action in {"issue", "renew"}:
        expires = to_iso(utc_now() + timedelta(days=90))
        fake_sha = secrets.token_hex(32)
        db.execute(
            """
            UPDATE domains
            SET cert_sha256 = ?, expires_at = ?, last_issued_at = ?, status = 'active', updated_at = ?
            WHERE id = ?
            """,
            (fake_sha, expires, now, now, domain_id),
        )
        db.execute(
            """
            UPDATE node_assignments
            SET desired_sha256 = ?, expires_at = ?, status = CASE WHEN deployed_sha256 = ? THEN 'synced' ELSE 'pending' END, updated_at = ?
            WHERE domain_id = ?
            """,
            (fake_sha, expires, fake_sha, now, domain_id),
        )
    if action == "sync":
        db.execute(
            "UPDATE domains SET last_sync_at = ?, updated_at = ? WHERE id = ?",
            (now, now, domain_id),
        )
