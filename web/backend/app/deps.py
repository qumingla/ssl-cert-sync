from __future__ import annotations

from fastapi import Request

from .db import Database
from .events import EventHub


def get_db(request: Request) -> Database:
    return request.app.state.db


def get_event_hub(request: Request) -> EventHub:
    return request.app.state.event_hub
