"""
Unit tests for po_status.py — POStatus enum, is_row_done(), categorize_result().
"""

import pytest
import sys
from pathlib import Path

# Ensure the bot folder is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from po_status import POStatus, is_row_done, categorize_result


# ═══════════════════════════════════════════════════════════════════════
#  POStatus enum basics
# ═══════════════════════════════════════════════════════════════════════

class TestPOStatusEnum:
    """Test the POStatus enum members and their string representation."""

    def test_enum_is_str(self):
        """POStatus inherits from str so values can go straight to Excel."""
        assert isinstance(POStatus.VERIFIED_DELIVERY_AND_POD, str)
        assert POStatus.VERIFIED_DELIVERY_AND_POD == "VERIFIED - Delivery + POD Done"

    def test_all_verified_start_with_verified(self):
        verified_members = [
            POStatus.VERIFIED_DELIVERY_AND_POD,
            POStatus.VERIFIED_DELIVERY_ONLY,
            POStatus.VERIFIED_DELIVERY_PORTAL,
            POStatus.VERIFIED_DELIVERY,
            POStatus.VERIFIED_POD_UPLOADED,
            POStatus.VERIFIED_DELIVERY_POD_FAIL,
        ]
        for m in verified_members:
            assert m.value.startswith("VERIFIED"), f"{m.name} should start with VERIFIED"

    def test_all_failed_start_with_failed(self):
        failed_members = [
            POStatus.FAILED_LOGIN,
            POStatus.FAILED_PO_NOT_FOUND,
            POStatus.FAILED_PO_NOT_FOUND_POD,
            POStatus.FAILED_POD_UPLOAD,
            POStatus.FAILED_DELIVERY_FORM,
            POStatus.FAILED_ACTION_SELECT,
            POStatus.FAILED_DATE_ENTRY,
            POStatus.FAILED_SAVE,
            POStatus.FAILED_BROWSER_CRASH,
            POStatus.FAILED_BROWSER_RELOGIN,
        ]
        for m in failed_members:
            assert m.value.startswith("FAILED"), f"{m.name} should start with FAILED"

    def test_no_duplicate_values(self):
        values = [m.value for m in POStatus]
        assert len(values) == len(set(values)), "Duplicate status values found"


# ═══════════════════════════════════════════════════════════════════════
#  POStatus property helpers
# ═══════════════════════════════════════════════════════════════════════

class TestPOStatusProperties:

    @pytest.mark.parametrize("member", [
        POStatus.VERIFIED_DELIVERY_AND_POD,
        POStatus.VERIFIED_DELIVERY_ONLY,
        POStatus.VERIFIED_DELIVERY_PORTAL,
        POStatus.VERIFIED_DELIVERY,
        POStatus.VERIFIED_POD_UPLOADED,
        POStatus.VERIFIED_DELIVERY_POD_FAIL,
    ])
    def test_is_verified_true(self, member):
        assert member.is_verified is True

    @pytest.mark.parametrize("member", [
        POStatus.FAILED_LOGIN,
        POStatus.SKIPPED_NO_DATA,
        POStatus.ALREADY_DONE,
        POStatus.UNVERIFIED_STATUS_UNCHANGED,
    ])
    def test_is_verified_false(self, member):
        assert member.is_verified is False

    @pytest.mark.parametrize("member", [
        POStatus.FAILED_LOGIN,
        POStatus.FAILED_PO_NOT_FOUND,
        POStatus.FAILED_BROWSER_CRASH,
    ])
    def test_is_failed_true(self, member):
        assert member.is_failed is True

    def test_is_failed_false_for_verified(self):
        assert POStatus.VERIFIED_DELIVERY.is_failed is False

    @pytest.mark.parametrize("member", [
        POStatus.SKIPPED_NO_DATA,
        POStatus.SKIPPED_PO_NOT_FOUND,
        POStatus.SKIPPED_POD_CLAIMED,
        POStatus.SKIPPED_BY_USER,
    ])
    def test_is_skipped_true(self, member):
        assert member.is_skipped is True

    def test_is_skipped_false_for_failed(self):
        assert POStatus.FAILED_LOGIN.is_skipped is False

    def test_is_terminal_verified(self):
        assert POStatus.VERIFIED_DELIVERY.is_terminal is True

    def test_is_terminal_skipped_by_user(self):
        assert POStatus.SKIPPED_BY_USER.is_terminal is True

    def test_is_terminal_false_for_failed(self):
        assert POStatus.FAILED_LOGIN.is_terminal is False

    def test_is_terminal_false_for_skipped_no_data(self):
        """SKIPPED_NO_DATA is retryable, so not terminal."""
        assert POStatus.SKIPPED_NO_DATA.is_terminal is False

    def test_is_unverified(self):
        assert POStatus.UNVERIFIED_STATUS_UNCHANGED.is_unverified is True
        assert POStatus.VERIFIED_DELIVERY.is_unverified is False


# ═══════════════════════════════════════════════════════════════════════
#  is_row_done()
# ═══════════════════════════════════════════════════════════════════════

class TestIsRowDone:

    @pytest.mark.parametrize("status", [
        "VERIFIED - Delivery + POD Done",
        "VERIFIED - Delivery Done",
        "VERIFIED - POD Uploaded",
        "verified - something",       # case insensitive
    ])
    def test_verified_is_done(self, status):
        assert is_row_done(status) is True

    def test_user_requested_skip_is_done(self):
        assert is_row_done("USER REQUESTED SKIP") is True

    @pytest.mark.parametrize("status", [
        "FAILED - Login",
        "SKIPPED - No delivery date",
        "",
        None,
        "PENDING",
        "UNVERIFIED - Save clicked but status unchanged",
    ])
    def test_not_done(self, status):
        assert is_row_done(status) is False

    def test_whitespace_handling(self):
        assert is_row_done("  VERIFIED - Delivery Done  ") is True
        assert is_row_done("  ") is False


# ═══════════════════════════════════════════════════════════════════════
#  categorize_result()
# ═══════════════════════════════════════════════════════════════════════

class TestCategorizeResult:

    @pytest.mark.parametrize("status,expected", [
        ("VERIFIED - Delivery + POD Done", "verified"),
        ("VERIFIED - Delivery Done", "verified"),
        ("UNVERIFIED - Save clicked but status unchanged", "unverified"),
        ("SKIPPED - No delivery date", "skipped"),
        ("ALREADY_DONE", "skipped"),
        ("FAILED - Login", "failed"),
        ("FAILED - PO Not Found", "failed"),
        ("", "failed"),            # empty defaults to failed
        (None, "failed"),          # None defaults to failed
        ("random garbage", "failed"),
    ])
    def test_categorization(self, status, expected):
        assert categorize_result(status) == expected

    def test_case_insensitive(self):
        assert categorize_result("verified - something") == "verified"
        assert categorize_result("Failed - Whatever") == "failed"
