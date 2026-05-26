"""
Unit tests for excel_utils.py — normalize_po_number, parse_delivery_date,
should_prefer_all_time, find_pod_file.
"""

import pytest
import sys
from pathlib import Path
from datetime import datetime, timedelta

# Ensure the bot folder is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from excel_utils import (
    normalize_po_number,
    parse_delivery_date,
    should_prefer_all_time,
    find_pod_file,
)


# ═══════════════════════════════════════════════════════════════════════
#  normalize_po_number()
# ═══════════════════════════════════════════════════════════════════════

class TestNormalizePONumber:

    def test_plain_number(self):
        assert normalize_po_number("8502340958") == "8502340958"

    def test_strips_whitespace(self):
        assert normalize_po_number("  8502340958  ") == "8502340958"

    def test_strips_quotes(self):
        assert normalize_po_number("'8502340958'") == "8502340958"
        assert normalize_po_number('"8502340958"') == "8502340958"

    def test_removes_zero_width_chars(self):
        assert normalize_po_number("850234\u200b0958") == "8502340958"
        assert normalize_po_number("\ufeff8502340958") == "8502340958"

    def test_removes_tabs(self):
        assert normalize_po_number("8502340958\t") == "8502340958"

    def test_none_returns_empty(self):
        assert normalize_po_number(None) == ""

    def test_empty_string(self):
        assert normalize_po_number("") == ""

    def test_numeric_input(self):
        """Excel may pass numeric PO as int/float."""
        assert normalize_po_number(8502340958) == "8502340958"

    def test_float_input(self):
        assert normalize_po_number(8502340958.0) == "8502340958.0"

    def test_alphanumeric_po(self):
        assert normalize_po_number("PO-2024/0123") == "PO-2024/0123"


# ═══════════════════════════════════════════════════════════════════════
#  parse_delivery_date()
# ═══════════════════════════════════════════════════════════════════════

class TestParseDeliveryDate:

    def test_datetime_object(self):
        dt = datetime(2024, 3, 15)
        assert parse_delivery_date(dt) == "15-03-2024"

    @pytest.mark.parametrize("input_str,expected", [
        ("15-Mar-24", "15-03-2024"),
        ("15-Mar-2024", "15-03-2024"),
        ("15-03-2024", "15-03-2024"),
        ("15/03/2024", "15-03-2024"),
        ("15-03-24", "15-03-2024"),
        ("15/03/24", "15-03-2024"),
        ("2024-03-15", "15-03-2024"),
        ("03/15/2024", "15-03-2024"),
    ])
    def test_string_formats(self, input_str, expected):
        assert parse_delivery_date(input_str) == expected

    def test_whitespace_in_date(self):
        assert parse_delivery_date("  15-03-2024  ") == "15-03-2024"

    def test_two_digit_year_becomes_2000s(self):
        result = parse_delivery_date("15-Mar-24")
        assert "2024" in result

    def test_invalid_date_raises(self):
        with pytest.raises(ValueError, match="Cannot parse delivery date"):
            parse_delivery_date("not-a-date")

    def test_empty_string_raises(self):
        with pytest.raises(ValueError):
            parse_delivery_date("")


# ═══════════════════════════════════════════════════════════════════════
#  should_prefer_all_time()
# ═══════════════════════════════════════════════════════════════════════

class TestShouldPreferAllTime:

    def test_recent_date_returns_false(self):
        """Dates within 25 days should use default 'Last 30 Days' filter."""
        recent = datetime.now() - timedelta(days=10)
        assert should_prefer_all_time(recent) is False

    def test_old_date_returns_true(self):
        """Dates older than 25 days should switch to 'All Time' filter."""
        old = datetime.now() - timedelta(days=30)
        assert should_prefer_all_time(old) is True

    def test_none_returns_false(self):
        assert should_prefer_all_time(None) is False

    def test_empty_string_returns_false(self):
        assert should_prefer_all_time("") is False

    def test_string_date_works(self):
        old_str = (datetime.now() - timedelta(days=60)).strftime("%d-%m-%Y")
        assert should_prefer_all_time(old_str) is True

    def test_boundary_25_days(self):
        """Exactly 25 days ago should NOT prefer all time (<=25 is recent)."""
        boundary = datetime.now() - timedelta(days=25)
        assert should_prefer_all_time(boundary) is False

    def test_boundary_26_days(self):
        """26 days ago SHOULD prefer all time."""
        boundary = datetime.now() - timedelta(days=26)
        assert should_prefer_all_time(boundary) is True


# ═══════════════════════════════════════════════════════════════════════
#  find_pod_file()
# ═══════════════════════════════════════════════════════════════════════

class TestFindPodFile:

    def test_exact_match(self, tmp_path):
        pod = tmp_path / "6001029489.jpg"
        pod.touch()
        result = find_pod_file(tmp_path, "6001029489")
        assert result == pod

    def test_case_insensitive_match(self, tmp_path):
        pod = tmp_path / "TRACK123.pdf"
        pod.touch()
        result = find_pod_file(tmp_path, "track123")
        assert result == pod

    def test_prefix_match_with_suffix(self, tmp_path):
        pod = tmp_path / "301203752 a.pdf"
        pod.touch()
        result = find_pod_file(tmp_path, "301203752")
        assert result == pod

    def test_no_match(self, tmp_path):
        (tmp_path / "different_file.jpg").touch()
        result = find_pod_file(tmp_path, "6001029489")
        assert result is None

    def test_empty_tracking_id(self, tmp_path):
        (tmp_path / "something.jpg").touch()
        assert find_pod_file(tmp_path, "") is None
        assert find_pod_file(tmp_path, None) is None

    def test_nonexistent_folder(self):
        result = find_pod_file(Path("/nonexistent/folder"), "123")
        assert result is None

    def test_unsupported_extension_ignored(self, tmp_path):
        """Files with unsupported extensions should not match."""
        (tmp_path / "6001029489.exe").touch()
        result = find_pod_file(tmp_path, "6001029489")
        assert result is None

    def test_hidden_chars_in_tracking_id(self, tmp_path):
        pod = tmp_path / "6001029489.jpg"
        pod.touch()
        # Tracking ID with zero-width space
        result = find_pod_file(tmp_path, "600102\u200b9489")
        assert result == pod

    def test_multiple_files_picks_exact(self, tmp_path):
        """When both exact and prefix match exist, exact should win."""
        exact = tmp_path / "123456.jpg"
        prefix = tmp_path / "123456 a.pdf"
        exact.touch()
        prefix.touch()
        result = find_pod_file(tmp_path, "123456")
        assert result == exact

    def test_pdf_extension(self, tmp_path):
        pod = tmp_path / "TRACK99.pdf"
        pod.touch()
        result = find_pod_file(tmp_path, "TRACK99")
        assert result == pod
