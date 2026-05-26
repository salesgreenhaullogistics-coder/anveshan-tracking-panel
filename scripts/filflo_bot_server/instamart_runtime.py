"""
Shared runtime helpers for the isolated Instamart booking bot.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from instamart_sync import BOT_FOLDER


INSTAMART_BOT_DIR = BOT_FOLDER / "instamart-playwright-bot"
INSTAMART_STATE_DIR = INSTAMART_BOT_DIR / "state"
INSTAMART_STATUS_PATH = INSTAMART_STATE_DIR / "instamart-live-status.json"
INSTAMART_OTP_PATH = INSTAMART_STATE_DIR / "instamart-otp.txt"

OTP_RE = re.compile(r"^\d{4,8}$")
FRESH_WAITING_STATUS_SECONDS = 15 * 60


def read_instamart_status(status_path: Path | str = INSTAMART_STATUS_PATH) -> dict[str, Any] | None:
    path = Path(status_path)
    if not path.exists():
        return None

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def get_instamart_status_state(status: dict[str, Any] | None) -> str:
    if not status:
        return ""
    return str(status.get("state", "") or "").strip()


def normalize_instamart_otp(value: Any) -> str:
    otp = re.sub(r"\D+", "", str(value or ""))
    if not OTP_RE.fullmatch(otp):
        raise ValueError("OTP must contain 4 to 8 digits.")
    return otp


def _parse_status_timestamp(value: Any) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None

    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def submit_instamart_otp(
    otp: Any,
    *,
    status_path: Path | str = INSTAMART_STATUS_PATH,
    default_otp_path: Path | str = INSTAMART_OTP_PATH,
    require_waiting: bool = True,
) -> dict[str, Any]:
    normalized_otp = normalize_instamart_otp(otp)
    status = read_instamart_status(status_path)
    state = get_instamart_status_state(status)

    if require_waiting and state != "waiting_for_otp":
        raise RuntimeError("Instamart bot is not currently waiting for OTP.")

    if require_waiting:
        updated_at = _parse_status_timestamp(status.get("updatedAt") if status else "")
        if updated_at is None:
            raise RuntimeError("Instamart waiting status is missing a usable timestamp.")
        age_seconds = (datetime.now(timezone.utc) - updated_at).total_seconds()
        if age_seconds > FRESH_WAITING_STATUS_SECONDS:
            raise RuntimeError("Instamart waiting status is stale. Start a fresh booking run first.")

    otp_path_value = ""
    if status:
        otp_path_value = str(status.get("otpFile", "") or "").strip()

    otp_path = Path(otp_path_value or default_otp_path)
    otp_path.parent.mkdir(parents=True, exist_ok=True)
    otp_path.write_text(f"{normalized_otp}\n", encoding="utf-8")

    return {
        "otp": normalized_otp,
        "otp_file": str(otp_path),
        "status": status or {},
    }
