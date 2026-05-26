"""
╔══════════════════════════════════════════════════════════════════╗
║  Filflo Bot — Monitoring & Alerting Module                       ║
║                                                                  ║
║  Tracks PO processing metrics, detects consecutive failures,    ║
║  and sends email alerts when thresholds are breached.           ║
╚══════════════════════════════════════════════════════════════════╝

Usage:
    from bot_monitor import BotMonitor
    monitor = BotMonitor(logger=logger)

    # Record each PO outcome
    monitor.record("8502340958", success=True, duration_sec=12.5)
    monitor.record("8502340959", success=False, duration_sec=5.0, error="FAILED - Login")

    # Get summary dashboard
    print(monitor.dashboard())

    # Alerting is automatic — fires when consecutive failures >= threshold
"""

import os
import time
import json
import threading
import logging
import smtplib
from pathlib import Path
from datetime import datetime, timedelta
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from collections import deque
from dataclasses import dataclass, field, asdict


# ═══════════════════════════════════════════════════════════════════════
#  DATA MODELS
# ═══════════════════════════════════════════════════════════════════════

@dataclass
class PORecord:
    """A single PO processing record."""
    po_number: str
    success: bool
    duration_sec: float
    error: str = ""
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())


@dataclass
class SessionStats:
    """Aggregated stats for the current bot session."""
    session_start: str = field(default_factory=lambda: datetime.now().isoformat())
    total_processed: int = 0
    total_verified: int = 0
    total_failed: int = 0
    total_skipped: int = 0
    total_duration_sec: float = 0.0
    consecutive_failures: int = 0
    max_consecutive_failures: int = 0
    last_alert_time: str = ""

    @property
    def success_rate(self) -> float:
        if self.total_processed == 0:
            return 0.0
        return (self.total_verified / self.total_processed) * 100

    @property
    def avg_duration_sec(self) -> float:
        if self.total_processed == 0:
            return 0.0
        return self.total_duration_sec / self.total_processed

    @property
    def uptime_minutes(self) -> float:
        start = datetime.fromisoformat(self.session_start)
        return (datetime.now() - start).total_seconds() / 60


# ═══════════════════════════════════════════════════════════════════════
#  BOT MONITOR
# ═══════════════════════════════════════════════════════════════════════

class BotMonitor:
    """
    Tracks PO processing metrics and sends email alerts on consecutive failures.

    Args:
        logger:                   Python logger instance.
        alert_threshold:          Number of consecutive failures before alerting (default: 3).
        alert_cooldown_minutes:   Minimum minutes between alert emails (default: 30).
        stats_file:               Path to persist stats between restarts (optional).
    """

    def __init__(
        self,
        logger: logging.Logger = None,
        alert_threshold: int = 3,
        alert_cooldown_minutes: int = 30,
        stats_file: Path = None,
    ):
        self.logger = logger or logging.getLogger(__name__)
        self.alert_threshold = alert_threshold
        self.alert_cooldown = timedelta(minutes=alert_cooldown_minutes)
        self.stats_file = stats_file

        self._lock = threading.Lock()
        self._stats = SessionStats()
        self._recent: deque[PORecord] = deque(maxlen=100)  # Last 100 records
        self._last_alert_dt = None

        # Load persisted stats if available
        if self.stats_file and self.stats_file.exists():
            self._load_stats()

        self.logger.info(
            f"[Monitor] Initialized — alert after {alert_threshold} consecutive failures, "
            f"cooldown {alert_cooldown_minutes}min"
        )

    # ── Record a PO outcome ───────────────────────────────────────────

    def record(self, po_number: str, success: bool, duration_sec: float = 0.0,
               error: str = "", category: str = ""):
        """
        Record a PO processing result and check alert thresholds.

        Args:
            po_number:    The PO number processed.
            success:      True if verified successfully.
            duration_sec: How long the PO took to process.
            error:        Error message if failed.
            category:     "verified", "failed", "skipped", or "unverified".
        """
        rec = PORecord(
            po_number=po_number,
            success=success,
            duration_sec=duration_sec,
            error=error,
        )

        with self._lock:
            self._recent.append(rec)
            self._stats.total_processed += 1
            self._stats.total_duration_sec += duration_sec

            if success or category == "verified":
                self._stats.total_verified += 1
                self._stats.consecutive_failures = 0
            elif category == "skipped":
                self._stats.total_skipped += 1
                self._stats.consecutive_failures = 0
            else:
                self._stats.total_failed += 1
                self._stats.consecutive_failures += 1
                self._stats.max_consecutive_failures = max(
                    self._stats.max_consecutive_failures,
                    self._stats.consecutive_failures,
                )

            # Check alert threshold
            if self._stats.consecutive_failures >= self.alert_threshold:
                self._maybe_send_alert()

            # Persist stats periodically
            if self.stats_file and self._stats.total_processed % 10 == 0:
                self._save_stats()

    # ── Dashboard ─────────────────────────────────────────────────────

    def dashboard(self) -> str:
        """Return a formatted text dashboard of current session stats."""
        with self._lock:
            s = self._stats
            recent_fails = [r for r in self._recent if not r.success]
            last_5_fails = list(recent_fails)[-5:]

        lines = [
            "",
            "╔══════════════════════════════════════════════════════════╗",
            "║          Filflo Bot — Monitoring Dashboard              ║",
            "╠══════════════════════════════════════════════════════════╣",
            f"║  Session Uptime     : {s.uptime_minutes:.1f} minutes",
            f"║  Total Processed    : {s.total_processed}",
            f"║  Verified (success) : {s.total_verified}",
            f"║  Failed             : {s.total_failed}",
            f"║  Skipped            : {s.total_skipped}",
            f"║  Success Rate       : {s.success_rate:.1f}%",
            f"║  Avg Processing Time: {s.avg_duration_sec:.1f}s",
            f"║  Consecutive Fails  : {s.consecutive_failures}",
            f"║  Max Consec. Fails  : {s.max_consecutive_failures}",
            "╠══════════════════════════════════════════════════════════╣",
        ]

        if last_5_fails:
            lines.append("║  Recent Failures:")
            for r in last_5_fails:
                ts = r.timestamp[11:19]  # HH:MM:SS
                lines.append(f"║    {ts}  PO {r.po_number}: {r.error[:40]}")
        else:
            lines.append("║  No recent failures!")

        lines.append("╚══════════════════════════════════════════════════════════╝")
        return "\n".join(lines)

    def get_stats_dict(self) -> dict:
        """Return stats as a dictionary for programmatic use."""
        with self._lock:
            return asdict(self._stats)

    # ── Alerting ──────────────────────────────────────────────────────

    def _maybe_send_alert(self):
        """Send alert email if cooldown has elapsed."""
        now = datetime.now()

        if self._last_alert_dt and (now - self._last_alert_dt) < self.alert_cooldown:
            self.logger.debug("[Monitor] Alert suppressed (cooldown active)")
            return

        self._last_alert_dt = now
        self._stats.last_alert_time = now.isoformat()

        # Collect failure details
        recent_fails = [r for r in self._recent if not r.success][-5:]

        self.logger.warning(
            f"[Monitor] ALERT: {self._stats.consecutive_failures} consecutive failures! "
            f"Attempting to send alert email..."
        )

        # Try email alert in background thread (non-blocking)
        threading.Thread(
            target=self._send_alert_email,
            args=(self._stats.consecutive_failures, recent_fails),
            daemon=True,
        ).start()

    def _send_alert_email(self, fail_count: int, recent_fails: list):
        """Send alert email using Gmail SMTP (same creds as bot)."""
        try:
            sender = os.getenv("FILFLO_GMAIL_SENDER", "")
            password = os.getenv("FILFLO_GMAIL_APP_PASSWORD", "")
            recipient = os.getenv("FILFLO_EMAIL_RECIPIENT", "")

            if not all([sender, password, recipient]):
                self.logger.warning("[Monitor] Cannot send alert — email not configured")
                return

            subject = f"[Filflo Bot ALERT] {fail_count} consecutive failures"

            fail_details = "\n".join(
                f"  - PO {r.po_number}: {r.error} ({r.timestamp[11:19]})"
                for r in recent_fails
            ) or "  (no details available)"

            body = (
                f"Filflo Bot has encountered {fail_count} consecutive failures.\n\n"
                f"Recent failures:\n{fail_details}\n\n"
                f"Session stats:\n"
                f"  Total processed: {self._stats.total_processed}\n"
                f"  Success rate: {self._stats.success_rate:.1f}%\n"
                f"  Uptime: {self._stats.uptime_minutes:.0f} minutes\n\n"
                f"Please check the bot logs and Filflo portal.\n\n"
                f"-- Filflo Bot Monitor"
            )

            msg = MIMEMultipart()
            msg["From"] = sender
            msg["To"] = recipient
            msg["Subject"] = subject
            msg.attach(MIMEText(body, "plain"))

            with smtplib.SMTP("smtp.gmail.com", 587) as server:
                server.starttls()
                server.login(sender, password)
                server.send_message(msg)

            self.logger.info(f"[Monitor] Alert email sent to {recipient}")

        except Exception as e:
            self.logger.error(f"[Monitor] Failed to send alert email: {e}")

    # ── Persistence ───────────────────────────────────────────────────

    def _save_stats(self):
        """Save stats to JSON file."""
        try:
            data = asdict(self._stats)
            self.stats_file.write_text(json.dumps(data, indent=2))
        except Exception as e:
            self.logger.error(f"[Monitor] Failed to save stats: {e}")

    def _load_stats(self):
        """Load stats from JSON file."""
        try:
            data = json.loads(self.stats_file.read_text())
            # Only restore cumulative counters, reset session-specific ones
            self._stats.total_processed = data.get("total_processed", 0)
            self._stats.total_verified = data.get("total_verified", 0)
            self._stats.total_failed = data.get("total_failed", 0)
            self._stats.total_skipped = data.get("total_skipped", 0)
            self.logger.info(
                f"[Monitor] Loaded persisted stats — "
                f"{self._stats.total_processed} processed, "
                f"{self._stats.success_rate:.1f}% success rate"
            )
        except Exception as e:
            self.logger.warning(f"[Monitor] Could not load stats: {e}")

    def reset(self):
        """Reset all stats (e.g., at start of a new batch run)."""
        with self._lock:
            self._stats = SessionStats()
            self._recent.clear()
            self._last_alert_dt = None
            if self.stats_file:
                self._save_stats()
        self.logger.info("[Monitor] Stats reset")
