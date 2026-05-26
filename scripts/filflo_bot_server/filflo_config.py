"""
Filflo B2B Bot — Centralized Configuration Module

This module contains all configuration constants, environment variable loading,
and required env var validation. It serves as the single source of truth for
bot settings across all modules.
"""

import os
import warnings
from pathlib import Path
try:
    from dotenv import load_dotenv
except ImportError:
    def load_dotenv(*_args, **_kwargs):
        return False

# Load .env file from the same directory as this module
load_dotenv(Path(__file__).resolve().parent / ".env")

# ═══════════════════════════════════════════════════════════════════════════════
#  CORE CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════

FILFLO_URL     = "https://anveshan.filflo.in/b2b/b2b_order_team"
LOGIN_EMAIL    = os.getenv("FILFLO_LOGIN_EMAIL", "")
LOGIN_PASSWORD = os.getenv("FILFLO_LOGIN_PASSWORD", "")

BOT_FOLDER          = Path(os.getenv("FILFLO_BOT_FOLDER", str(Path(__file__).resolve().parent)))
DEFAULT_EXCEL_PATH  = BOT_FOLDER / "Filflo_Tasks.xlsx"
POD_FOLDER          = BOT_FOLDER / "POD_FILES"
POD_DONE_FOLDER     = BOT_FOLDER / "POD_FILES" / "_uploaded"
LOG_DIR             = BOT_FOLDER / "logs"
EXCEL_LOCK_PATH     = BOT_FOLDER / ".excel.lock"

POLL_INTERVAL_SECONDS = 60

# ── Validate required environment variables at import time ──
_REQUIRED_ENV_VARS = ["FILFLO_LOGIN_EMAIL", "FILFLO_LOGIN_PASSWORD"]
_missing = [v for v in _REQUIRED_ENV_VARS if not os.getenv(v)]
if _missing:
    warnings.warn(
        f"Missing required environment variables: {', '.join(_missing)}. "
        f"Create a .env file in {BOT_FOLDER} — see .env.example for reference.",
        stacklevel=2,
    )

# Download & Email config
DOWNLOAD_FOLDER     = BOT_FOLDER   # Downloaded file saved here
GMAIL_SENDER        = os.getenv("FILFLO_GMAIL_SENDER", "")
GMAIL_APP_PASSWORD  = os.getenv("FILFLO_GMAIL_APP_PASSWORD", "")
EMAIL_RECIPIENT     = os.getenv("FILFLO_EMAIL_RECIPIENT", "")

# Excel columns (1-indexed)
COL_PO_NUMBER     = 1
COL_ORDER_TYPE    = 2
COL_DELIVERY_DATE = 3
COL_TRACKING_ID   = 4
COL_STATUS        = 5
HEADER_ROW        = 1

# Timeouts
PAGE_LOAD_TIMEOUT    = 30
ELEMENT_WAIT_TIMEOUT = 20
MAX_PO_RETRIES       = 3
SEARCH_POLL_SECONDS  = 18
