"""
Tests for shared Instamart runtime helpers.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from instamart_runtime import normalize_instamart_otp, submit_instamart_otp


def test_normalize_instamart_otp_keeps_digits_only():
    assert normalize_instamart_otp(" 12 34-56 ") == "123456"


def test_normalize_instamart_otp_rejects_invalid_values():
    with pytest.raises(ValueError):
        normalize_instamart_otp("abc")


def test_submit_instamart_otp_writes_to_status_file_path(tmp_path: Path):
    status_path = tmp_path / "instamart-live-status.json"
    otp_path = tmp_path / "nested" / "instamart-otp.txt"
    status_path.write_text(
        json.dumps(
            {
                "state": "waiting_for_otp",
                "updatedAt": datetime.now(timezone.utc).isoformat(),
                "otpFile": str(otp_path),
            }
        ),
        encoding="utf-8",
    )

    summary = submit_instamart_otp("654321", status_path=status_path)

    assert summary["otp"] == "654321"
    assert otp_path.read_text(encoding="utf-8").strip() == "654321"


def test_submit_instamart_otp_requires_waiting_state(tmp_path: Path):
    status_path = tmp_path / "instamart-live-status.json"
    status_path.write_text(json.dumps({"state": "authenticated"}), encoding="utf-8")

    with pytest.raises(RuntimeError):
        submit_instamart_otp("654321", status_path=status_path)


def test_submit_instamart_otp_rejects_stale_waiting_status(tmp_path: Path):
    status_path = tmp_path / "instamart-live-status.json"
    status_path.write_text(
        json.dumps(
            {
                "state": "waiting_for_otp",
                "updatedAt": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(RuntimeError):
        submit_instamart_otp("654321", status_path=status_path)
