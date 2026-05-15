from __future__ import annotations

import json
from urllib import error, request


def send_telegram_message(bot_token: str, chat_id: str, text: str) -> dict[str, object]:
    token = bot_token.strip()
    target = chat_id.strip()
    if not token:
        raise ValueError("Telegram Bot Token is empty")
    if not target:
        raise ValueError("Telegram Chat ID is empty")

    payload = json.dumps(
        {
            "chat_id": target,
            "text": text,
        }
    ).encode("utf-8")
    req = request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=10) as response:
            raw = response.read().decode("utf-8")
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            detail = json.loads(body).get("description") or body
        except json.JSONDecodeError:
            detail = body or str(exc)
        raise RuntimeError(f"Telegram API error: {detail}") from exc
    except error.URLError as exc:
        reason = getattr(exc, "reason", exc)
        raise RuntimeError(f"Telegram request failed: {reason}") from exc

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Telegram API returned invalid JSON") from exc

    if not data.get("ok"):
        description = data.get("description") or "Unknown Telegram API error"
        raise RuntimeError(f"Telegram API error: {description}")

    return data
