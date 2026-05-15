from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Any
from uuid import uuid4

from .db import Database, dumps, loads_object
from .timeutil import iso_now


class EventHub:
    def __init__(self, db: Database):
        self.db = db
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()

    def publish(
        self,
        event_type: str,
        level: str,
        message: str,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        event = {
            "id": f"evt_{uuid4().hex}",
            "type": event_type,
            "level": level,
            "message": message,
            "createdAt": iso_now(),
            "payload": payload or {},
        }
        self.db.execute(
            """
            INSERT INTO events (id, type, level, message, payload_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                event["id"],
                event_type,
                level,
                message,
                dumps(event["payload"]),
                event["createdAt"],
            ),
        )
        stale: list[asyncio.Queue[dict[str, Any]]] = []
        for queue in self._subscribers:
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                stale.append(queue)
        for queue in stale:
            self._subscribers.discard(queue)
        return event

    def recent(self, limit: int = 50) -> list[dict[str, Any]]:
        rows = self.db.query_all(
            """
            SELECT * FROM events
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        )
        return [event_from_row(row) for row in rows]

    async def stream(self) -> AsyncIterator[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=100)
        self._subscribers.add(queue)
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15)
                    yield event
                except TimeoutError:
                    yield {
                        "id": f"evt_ping_{uuid4().hex}",
                        "type": "node_heartbeat",
                        "level": "info",
                        "message": "SSE heartbeat",
                        "createdAt": iso_now(),
                        "payload": {"heartbeat": True},
                    }
        finally:
            self._subscribers.discard(queue)


def event_from_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "type": row["type"],
        "level": row["level"],
        "message": row["message"],
        "createdAt": row["created_at"],
        "payload": loads_object(row.get("payload_json")),
    }
