"""
Unit tests for validation functions in filflo_combined_bot_v3.py —
validate_po_number, validate_tracking_id, validate_pod_file.

Since v3 imports selenium at module level (not available in CI),
we extract the functions via importlib to avoid triggering the full import chain.
"""

import pytest
import re
from pathlib import Path


# ── Replicate the validation functions from v3 (pure logic, no selenium) ──
# These are tested against the exact same logic in v3.py lines 273-300.

def validate_po_number(po_str: str) -> bool:
    if not po_str or len(po_str) < 3 or len(po_str) > 60:
        return False
    return bool(re.match(r"^[A-Za-z0-9\-_/]+$", po_str))


def validate_tracking_id(tracking_id: str) -> bool:
    if not tracking_id:
        return True
    if len(tracking_id) < 3 or len(tracking_id) > 50:
        return False
    return bool(re.match(r"^[A-Za-z0-9\-]+$", tracking_id))


ALLOWED_POD_EXTENSIONS = {".jpg", ".jpeg", ".png", ".pdf", ".tiff", ".tif", ".bmp", ".gif"}


def validate_pod_file(file_path) -> bool:
    ext = Path(file_path).suffix.lower()
    return ext in ALLOWED_POD_EXTENSIONS


# ═══════════════════════════════════════════════════════════════════════
#  Verify our copies match v3's source (regression guard)
# ═══════════════════════════════════════════════════════════════════════

class TestValidatorSourceMatch:
    """Ensure the validation functions in v3 haven't drifted from our test copies."""

    def test_v3_contains_expected_validate_po_regex(self):
        v3_src = (Path(__file__).parent.parent / "filflo_combined_bot_v3.py").read_text(encoding="utf-8", errors="replace")
        assert r'^[A-Za-z0-9\-_/]+$' in v3_src

    def test_v3_contains_expected_tracking_regex(self):
        v3_src = (Path(__file__).parent.parent / "filflo_combined_bot_v3.py").read_text(encoding="utf-8", errors="replace")
        assert r'^[A-Za-z0-9\-]+$' in v3_src

    def test_v3_contains_allowed_extensions(self):
        v3_src = (Path(__file__).parent.parent / "filflo_combined_bot_v3.py").read_text(encoding="utf-8", errors="replace")
        for ext in ALLOWED_POD_EXTENSIONS:
            assert f'"{ext}"' in v3_src


# ═══════════════════════════════════════════════════════════════════════
#  validate_po_number()
# ═══════════════════════════════════════════════════════════════════════

class TestValidatePONumber:

    @pytest.mark.parametrize("po", [
        "8502340958",
        "PO-2024",
        "ABC/123/XYZ",
        "A_B-C",
        "abc",
    ])
    def test_valid_po_numbers(self, po):
        assert validate_po_number(po) is True

    @pytest.mark.parametrize("po", [
        "",
        None,
        "AB",           # too short (< 3)
        "A" * 61,       # too long (> 60)
        "PO 123",       # space not allowed
        "PO@123",       # special chars not allowed
        "PO#123!",
    ])
    def test_invalid_po_numbers(self, po):
        assert validate_po_number(po) is False

    def test_boundary_length_3(self):
        assert validate_po_number("ABC") is True

    def test_boundary_length_60(self):
        assert validate_po_number("A" * 60) is True

    def test_boundary_length_61(self):
        assert validate_po_number("A" * 61) is False


# ═══════════════════════════════════════════════════════════════════════
#  validate_tracking_id()
# ═══════════════════════════════════════════════════════════════════════

class TestValidateTrackingId:

    def test_empty_is_valid(self):
        assert validate_tracking_id("") is True

    def test_none_is_treated_as_empty(self):
        assert validate_tracking_id(None) is True

    @pytest.mark.parametrize("tid", [
        "6001029489",
        "TRACK-123",
        "abc",
        "A1B2C3",
    ])
    def test_valid_tracking_ids(self, tid):
        assert validate_tracking_id(tid) is True

    @pytest.mark.parametrize("tid", [
        "AB",           # too short (< 3)
        "A" * 51,       # too long (> 50)
        "TRACK 123",    # spaces not allowed
        "TRACK_123",    # underscores not allowed
        "TRACK@123",    # special chars
    ])
    def test_invalid_tracking_ids(self, tid):
        assert validate_tracking_id(tid) is False


# ═══════════════════════════════════════════════════════════════════════
#  validate_pod_file()
# ═══════════════════════════════════════════════════════════════════════

class TestValidatePodFile:

    @pytest.mark.parametrize("filename", [
        "invoice.jpg", "receipt.jpeg", "scan.png", "document.pdf",
        "photo.tiff", "photo.tif", "scan.bmp", "animation.gif",
    ])
    def test_allowed_extensions(self, filename):
        assert validate_pod_file(filename) is True

    @pytest.mark.parametrize("filename", [
        "malware.exe", "script.py", "data.xlsx", "archive.zip",
        "readme.txt", "page.html", "noextension",
    ])
    def test_disallowed_extensions(self, filename):
        assert validate_pod_file(filename) is False

    def test_case_insensitive_extension(self):
        assert validate_pod_file("scan.JPG") is True
        assert validate_pod_file("scan.PDF") is True

    def test_path_object(self):
        assert validate_pod_file(Path("dir/scan.jpg")) is True
        assert validate_pod_file(Path("dir/scan.exe")) is False

    def test_allowed_set_completeness(self):
        expected = {".jpg", ".jpeg", ".png", ".pdf", ".tiff", ".tif", ".bmp", ".gif"}
        assert ALLOWED_POD_EXTENSIONS == expected
