"""
Shared monitor event bus for the visible Filflo Monitor window.
"""

from __future__ import annotations

import json
import logging
import threading
from datetime import datetime
from pathlib import Path
from typing import Any


BOT_DIR = Path(__file__).resolve().parent
LOG_DIR = BOT_DIR / "logs"
MONITOR_EVENTS_PATH = LOG_DIR / "filflo_monitor_events.jsonl"
MONITOR_EVENTS_BACKUP_PATH = LOG_DIR / "filflo_monitor_events.prev.jsonl"
MAX_MONITOR_EVENTS_BYTES = 5 * 1024 * 1024

_WRITE_LOCK = threading.Lock()


def _ensure_monitor_log_dir() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)


def _rotate_events_file_if_needed() -> None:
    if not MONITOR_EVENTS_PATH.exists():
        return
    try:
        if MONITOR_EVENTS_PATH.stat().st_size < MAX_MONITOR_EVENTS_BYTES:
            return
    except OSError:
        return

    try:
        if MONITOR_EVENTS_BACKUP_PATH.exists():
            MONITOR_EVENTS_BACKUP_PATH.unlink()
    except OSError:
        pass

    try:
        MONITOR_EVENTS_PATH.replace(MONITOR_EVENTS_BACKUP_PATH)
    except OSError:
        pass


def emit_monitor_event(
    source: str,
    message: str,
    *,
    level: str = "INFO",
    event_type: str = "message",
    data: dict[str, Any] | None = None,
) -> None:
    payload = {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "source": str(source or "unknown"),
        "level": str(level or "INFO").upper(),
        "event_type": str(event_type or "message"),
        "message": str(message or ""),
        "data": data or {},
    }

    try:
        _ensure_monitor_log_dir()
        with _WRITE_LOCK:
            _rotate_events_file_if_needed()
            with MONITOR_EVENTS_PATH.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except Exception:
        # The monitor must never be allowed to break the real bots.
        pass


class MonitorLogHandler(logging.Handler):
    def __init__(self, source: str | None = None):
        super().__init__(level=logging.INFO)
        self.source = source
        self._filflo_monitor_handler = True

    def emit(self, record: logging.LogRecord) -> None:
        try:
            message = record.getMessage()
            correlation_id = getattr(record, "correlation_id", "")
            if correlation_id and correlation_id != "MAIN":
                message = f"[{correlation_id}] {message}"
            emit_monitor_event(
                self.source or record.name,
                message,
                level=record.levelname,
                event_type="log",
                data={"logger": record.name},
            )
        except Exception:
            pass


def attach_monitor_handler(logger: logging.Logger, *, source: str | None = None) -> logging.Logger:
    for handler in logger.handlers:
        if getattr(handler, "_filflo_monitor_handler", False):
            return logger

    logger.addHandler(MonitorLogHandler(source=source))
    return logger


def read_recent_monitor_events(max_lines: int = 80) -> list[dict[str, Any]]:
    if max_lines <= 0:
        return []

    events: list[dict[str, Any]] = []
    for path in (MONITOR_EVENTS_BACKUP_PATH, MONITOR_EVENTS_PATH):
        if not path.exists():
            continue
        try:
            with path.open("r", encoding="utf-8", errors="replace") as handle:
                for raw_line in handle.readlines():
                    raw_line = raw_line.strip()
                    if not raw_line:
                        continue
                    try:
                        events.append(json.loads(raw_line))
                    except json.JSONDecodeError:
                        continue
        except OSError:
            continue

    return events[-max_lines:]
