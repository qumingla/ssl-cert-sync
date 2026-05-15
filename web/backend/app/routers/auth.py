from __future__ import annotations

import secrets

from fastapi import APIRouter, HTTPException, Request, status

from ..config import AppConfig
from ..schemas import LoginRequest
from ..security import create_signed_token

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login")
async def login(payload: LoginRequest, request: Request) -> dict[str, str]:
    config: AppConfig = request.app.state.config
    valid_username = secrets.compare_digest(payload.username, config.admin_username)
    valid_password = secrets.compare_digest(payload.password, config.admin_password)
    if not (valid_username and valid_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"error": "Invalid credentials"})
    token = create_signed_token(config, subject=payload.username, kind="admin")
    return {"token": token}
