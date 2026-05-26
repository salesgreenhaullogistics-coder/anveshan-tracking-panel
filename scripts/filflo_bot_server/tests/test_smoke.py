"""
Smoke tests — compile checks, import verification, config validation.
These run fast and catch broken imports or syntax errors before any real testing.
"""

import pytest
import sys
import importlib
from pathlib import Path

BOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BOT_DIR))


# ═══════════════════════════════════════════════════════════════════════
#  Compile / Syntax checks
# ═══════════════════════════════════════════════════════════════════════

class TestCompilation:
    """Every .py in the bot folder should compile without syntax errors."""

    @pytest.mark.parametrize("py_file", sorted(BOT_DIR.glob("*.py")))
    def test_file_compiles(self, py_file):
        import py_compile
        py_compile.compile(str(py_file), doraise=True)


# ═══════════════════════════════════════════════════════════════════════
#  Import checks — core modules that must load cleanly
# ═══════════════════════════════════════════════════════════════════════

class TestImports:

    def test_import_po_status(self):
        mod = importlib.import_module("po_status")
        assert hasattr(mod, "POStatus")
        assert hasattr(mod, "is_row_done")
        assert hasattr(mod, "categorize_result")

    def test_import_filflo_config(self):
        mod = importlib.import_module("filflo_config")
        assert hasattr(mod, "FILFLO_URL")
        assert hasattr(mod, "DEFAULT_EXCEL_PATH")
        assert hasattr(mod, "POD_FOLDER")
        assert hasattr(mod, "MAX_PO_RETRIES")

    def test_import_excel_utils(self):
        mod = importlib.import_module("excel_utils")
        assert hasattr(mod, "normalize_po_number")
        assert hasattr(mod, "parse_delivery_date")
        assert hasattr(mod, "find_pod_file")
        assert hasattr(mod, "read_pending_entries")
        assert hasattr(mod, "update_excel_status")


# ═══════════════════════════════════════════════════════════════════════
#  Config validation
# ═══════════════════════════════════════════════════════════════════════

class TestConfigValidation:

    def test_filflo_url_is_https(self):
        from filflo_config import FILFLO_URL
        assert FILFLO_URL.startswith("https://"), "FILFLO_URL must use HTTPS"

    def test_paths_are_pathlib(self):
        from filflo_config import (
            BOT_FOLDER, DEFAULT_EXCEL_PATH, POD_FOLDER,
            POD_DONE_FOLDER, LOG_DIR, EXCEL_LOCK_PATH,
        )
        for p in [BOT_FOLDER, DEFAULT_EXCEL_PATH, POD_FOLDER,
                   POD_DONE_FOLDER, LOG_DIR, EXCEL_LOCK_PATH]:
            assert isinstance(p, Path), f"{p} should be a Path object"

    def test_column_indices_positive(self):
        from filflo_config import (
            COL_PO_NUMBER, COL_ORDER_TYPE, COL_DELIVERY_DATE,
            COL_TRACKING_ID, COL_STATUS, HEADER_ROW,
        )
        for col in [COL_PO_NUMBER, COL_ORDER_TYPE, COL_DELIVERY_DATE,
                     COL_TRACKING_ID, COL_STATUS, HEADER_ROW]:
            assert isinstance(col, int) and col >= 1, f"Column index {col} must be >= 1"

    def test_timeouts_are_positive(self):
        from filflo_config import (
            PAGE_LOAD_TIMEOUT, ELEMENT_WAIT_TIMEOUT,
            MAX_PO_RETRIES, SEARCH_POLL_SECONDS,
        )
        for val in [PAGE_LOAD_TIMEOUT, ELEMENT_WAIT_TIMEOUT,
                     MAX_PO_RETRIES, SEARCH_POLL_SECONDS]:
            assert isinstance(val, (int, float)) and val > 0

    def test_max_retries_reasonable(self):
        from filflo_config import MAX_PO_RETRIES
        assert 1 <= MAX_PO_RETRIES <= 10, "MAX_PO_RETRIES should be 1-10"

    def test_po_status_enum_has_minimum_members(self):
        from po_status import POStatus
        assert len(POStatus) >= 15, "POStatus should have at least 15 status values"

    def test_no_env_file_checked_in(self):
        """The .env file should not be in the tests directory."""
        env_in_tests = Path(__file__).parent / ".env"
        assert not env_in_tests.exists(), ".env should not be in tests/"
