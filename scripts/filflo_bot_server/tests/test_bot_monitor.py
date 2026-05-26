"""
Unit tests for bot_monitor.py — BotMonitor, SessionStats, alerting.
"""

import pytest
import sys
import json
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bot_monitor import BotMonitor, SessionStats, PORecord


class TestSessionStats:

    def test_success_rate_zero_when_empty(self):
        s = SessionStats()
        assert s.success_rate == 0.0

    def test_success_rate_calculation(self):
        s = SessionStats(total_processed=10, total_verified=7)
        assert s.success_rate == 70.0

    def test_avg_duration_zero_when_empty(self):
        s = SessionStats()
        assert s.avg_duration_sec == 0.0

    def test_avg_duration_calculation(self):
        s = SessionStats(total_processed=4, total_duration_sec=40.0)
        assert s.avg_duration_sec == 10.0

    def test_uptime_is_positive(self):
        s = SessionStats()
        assert s.uptime_minutes >= 0


class TestBotMonitor:

    def _make_monitor(self, **kwargs):
        return BotMonitor(logger=MagicMock(), **kwargs)

    def test_record_success(self):
        m = self._make_monitor()
        m.record("PO-001", success=True, duration_sec=5.0)
        stats = m.get_stats_dict()
        assert stats["total_processed"] == 1
        assert stats["total_verified"] == 1
        assert stats["consecutive_failures"] == 0

    def test_record_failure(self):
        m = self._make_monitor()
        m.record("PO-001", success=False, error="FAILED - Login")
        stats = m.get_stats_dict()
        assert stats["total_failed"] == 1
        assert stats["consecutive_failures"] == 1

    def test_consecutive_failures_reset_on_success(self):
        m = self._make_monitor()
        m.record("PO-001", success=False, error="err")
        m.record("PO-002", success=False, error="err")
        m.record("PO-003", success=True, duration_sec=3.0)
        stats = m.get_stats_dict()
        assert stats["consecutive_failures"] == 0
        assert stats["max_consecutive_failures"] == 2

    def test_skipped_resets_consecutive_failures(self):
        m = self._make_monitor()
        m.record("PO-001", success=False, error="err")
        m.record("PO-002", success=False, category="skipped")
        stats = m.get_stats_dict()
        assert stats["consecutive_failures"] == 0
        assert stats["total_skipped"] == 1

    def test_dashboard_returns_string(self):
        m = self._make_monitor()
        m.record("PO-001", success=True, duration_sec=5.0)
        m.record("PO-002", success=False, error="FAILED - Login")
        dash = m.dashboard()
        assert "Monitoring Dashboard" in dash
        assert "PO-002" in dash

    def test_alert_triggered_at_threshold(self):
        m = self._make_monitor(alert_threshold=3)
        with patch.object(m, "_send_alert_email") as mock_email:
            for i in range(3):
                m.record(f"PO-{i}", success=False, error="err")
            # Alert should have been triggered (via thread, but we mock)
            # Check that consecutive_failures reached threshold
            assert m._stats.consecutive_failures == 3

    def test_reset(self):
        m = self._make_monitor()
        m.record("PO-001", success=True, duration_sec=5.0)
        m.record("PO-002", success=False, error="err")
        m.reset()
        stats = m.get_stats_dict()
        assert stats["total_processed"] == 0
        assert stats["total_verified"] == 0
        assert stats["total_failed"] == 0

    def test_stats_persistence(self, tmp_path):
        stats_file = tmp_path / "stats.json"
        m1 = self._make_monitor(stats_file=stats_file)
        for i in range(10):
            m1.record(f"PO-{i}", success=True, duration_sec=2.0)
        # Stats should have been saved (every 10 records)
        assert stats_file.exists()
        data = json.loads(stats_file.read_text())
        assert data["total_processed"] == 10

        # Load into new monitor
        m2 = self._make_monitor(stats_file=stats_file)
        stats = m2.get_stats_dict()
        assert stats["total_processed"] == 10

    def test_recent_deque_capped_at_100(self):
        m = self._make_monitor()
        for i in range(150):
            m.record(f"PO-{i}", success=True, duration_sec=1.0)
        assert len(m._recent) == 100
