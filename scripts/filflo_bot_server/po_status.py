"""
╔══════════════════════════════════════════════════════════════════╗
║  PO Status Enum & State Machine — Filflo Bot                    ║
║                                                                  ║
║  Single source of truth for all PO status values.               ║
║  Replaces fragile string-based status matching across modules.  ║
╚══════════════════════════════════════════════════════════════════╝
"""

from enum import Enum


class POStatus(str, Enum):
    """
    Every status the bot can assign to a PO row.
    Inherits from str so it can be written directly to Excel
    and compared with string operations.
    """

    # ── Success ───────────────────────────────────────────────
    VERIFIED_DELIVERY_AND_POD = "VERIFIED - Delivery + POD Done"
    VERIFIED_DELIVERY_ONLY    = "VERIFIED - Delivery Done (no POD)"
    VERIFIED_DELIVERY_PORTAL  = "VERIFIED - Delivery Done (already on portal)"
    VERIFIED_DELIVERY         = "VERIFIED - Delivery Done"
    VERIFIED_POD_UPLOADED     = "VERIFIED - POD Uploaded"
    VERIFIED_DELIVERY_POD_FAIL = "VERIFIED - Delivery Done, POD FAILED"

    # ── Unverified (save clicked but portal didn't confirm) ───
    UNVERIFIED_STATUS_UNCHANGED = "UNVERIFIED - Save clicked but status unchanged"

    # ── Failed ────────────────────────────────────────────────
    FAILED_LOGIN              = "FAILED - Login"
    FAILED_PO_NOT_FOUND       = "FAILED - PO Not Found"
    FAILED_PO_NOT_FOUND_POD   = "FAILED - PO Not Found for POD"
    FAILED_POD_UPLOAD         = "FAILED - POD Upload Failed"
    FAILED_DELIVERY_FORM      = "FAILED - Could not open delivery form"
    FAILED_ACTION_SELECT      = "FAILED - Could not select action"
    FAILED_DATE_ENTRY         = "FAILED - Date entry"
    FAILED_SAVE               = "FAILED - Save"
    FAILED_BROWSER_CRASH      = "FAILED - Browser crash"
    FAILED_BROWSER_RELOGIN    = "FAILED - Browser crash, re-login failed"

    # ── Skipped ───────────────────────────────────────────────
    SKIPPED_NO_DATA           = "SKIPPED - No delivery date and no tracking ID"
    SKIPPED_PO_NOT_FOUND      = "SKIPPED - PO Not Found"
    SKIPPED_POD_CLAIMED       = "SKIPPED - POD claimed by another worker"
    SKIPPED_BY_USER           = "USER REQUESTED SKIP"

    # ── Internal (not written to Excel) ───────────────────────
    ALREADY_DONE              = "ALREADY_DONE"

    # ── Helpers ───────────────────────────────────────────────

    @property
    def is_verified(self) -> bool:
        return self.value.startswith("VERIFIED")

    @property
    def is_failed(self) -> bool:
        return self.value.startswith("FAILED")

    @property
    def is_skipped(self) -> bool:
        return self.value.startswith("SKIPPED") or self.value.startswith("USER REQUESTED")

    @property
    def is_terminal(self) -> bool:
        """Row should not be re-processed."""
        return self.is_verified or self == POStatus.SKIPPED_BY_USER

    @property
    def is_unverified(self) -> bool:
        return self.value.startswith("UNVERIFIED")


def is_row_done(status_str: str) -> bool:
    """
    Check if a raw status string from Excel indicates the row is done.
    Handles both POStatus enum values and legacy free-form strings.
    """
    s = str(status_str or "").strip().upper()
    return s.startswith("VERIFIED") or "USER REQUESTED SKIP" in s


def categorize_result(result_str: str) -> str:
    """
    Categorize a result string into one of: verified, unverified, skipped, failed.
    Works with both POStatus enum values and legacy strings.
    """
    s = str(result_str or "").strip().upper()
    if s.startswith("VERIFIED"):
        return "verified"
    elif s.startswith("UNVERIFIED"):
        return "unverified"
    elif s.startswith("SKIPPED") or s == "ALREADY_DONE":
        return "skipped"
    else:
        return "failed"
