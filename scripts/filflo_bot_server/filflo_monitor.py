"""
Persistent visible monitor window for all Filflo bot activity.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path
from typing import Any

from filflo_monitor_bus import MONITOR_EVENTS_PATH, read_recent_monitor_events


BOT_DIR = Path(__file__).resolve().parent
INSTAMART_STATUS_PATH = BOT_DIR / "instamart-playwright-bot" / "state" / "instamart-live-status.json"


def set_console_title(title: str) -> None:
    try:
        os.system(f"title {title}")
    except Exception:
        pass


def format_event(event: dict[str, Any]) -> str:
    timestamp = event.get("timestamp", "--")
    source = str(event.get("source", "unknown")).strip() or "unknown"
    level = str(event.get("level", "INFO")).upper()
    message = str(event.get("message", "")).strip()
    return f"[{timestamp}] [{source}] {level:<7} {message}"


def print_header() -> None:
    print("=" * 78, flush=True)
    print("Filflo Monitor", flush=True)
    print("Keep this window open to watch bot activity from Slack or local runs.", flush=True)
    print(f"Event stream: {MONITOR_EVENTS_PATH}", flush=True)
    print(f"Instamart status: {INSTAMART_STATUS_PATH}", flush=True)
    print("Press Ctrl+C to stop the monitor window.", flush=True)
    print("=" * 78, flush=True)


def print_recent_events(max_lines: int) -> None:
    events = read_recent_monitor_events(max_lines=max_lines)
    if not events:
        print("[startup] No recent monitor events yet.", flush=True)
        return

    print(f"[startup] Showing last {len(events)} event(s):", flush=True)
    for event in events:
        print(format_event(event), flush=True)


def load_instamart_status() -> dict[str, Any] | None:
    if not INSTAMART_STATUS_PATH.exists():
        return None
    try:
        return json.loads(INSTAMART_STATUS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None


def format_instamart_status(status: dict[str, Any]) -> str:
    state = status.get("state", "unknown")
    message = status.get("message", "")
    po_number = status.get("poNumber")
    details = []
    if po_number:
        details.append(f"PO={po_number}")
    if "total" in status:
        details.append(f"total={status.get('total')}")
    if "booked" in status:
        details.append(f"booked={status.get('booked')}")
    if "skipped" in status:
        details.append(f"skipped={status.get('skipped')}")
    if "errors" in status:
        details.append(f"errors={status.get('errors')}")
    tail = f" ({', '.join(details)})" if details else ""
    return f"[instamart-status] {state} | {message}{tail}"


def print_current_instamart_status() -> str | None:
    status = load_instamart_status()
    if not status:
        return None
    line = format_instamart_status(status)
    print(line, flush=True)
    return status.get("updatedAt")


def follow_monitor_stream(poll_seconds: float = 0.5) -> None:
    MONITOR_EVENTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    MONITOR_EVENTS_PATH.touch(exist_ok=True)

    with MONITOR_EVENTS_PATH.open("r", encoding="utf-8", errors="replace") as handle:
        handle.seek(0, os.SEEK_END)
        last_instamart_updated_at = None

        while True:
            line = handle.readline()
            if line:
                raw_line = line.strip()
                if raw_line:
                    try:
                        print(format_event(json.loads(raw_line)), flush=True)
                    except json.JSONDecodeError:
                        pass
                continue

            status = load_instamart_status()
            updated_at = status.get("updatedAt") if status else None
            if updated_at and updated_at != last_instamart_updated_at:
                print(format_instamart_status(status), flush=True)
                last_instamart_updated_at = updated_at

            time.sleep(poll_seconds)


def main() -> None:
    parser = argparse.ArgumentParser(description="Visible monitor window for Filflo bot progress")
    parser.add_argument("--recent", type=int, default=60, help="Number of recent events to show on startup")
    parser.add_argument("--once", action="store_true", help="Print the current snapshot and exit")
    args = parser.parse_args()

    set_console_title("Filflo Monitor")
    print_header()
    print_recent_events(args.recent)
    current_status_stamp = print_current_instamart_status()

    if args.once:
        if current_status_stamp is None:
            print("[startup] No Instamart status file present.", flush=True)
        return

    print("[monitor] Waiting for new events...", flush=True)
    try:
        follow_monitor_stream()
    except KeyboardInterrupt:
        print("\n[monitor] Stopped.", flush=True)


if __name__ == "__main__":
    main()
