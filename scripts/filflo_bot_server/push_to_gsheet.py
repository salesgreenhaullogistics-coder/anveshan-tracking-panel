"""
Data pusher reverse ETL pipeline.

Reads Data.xlsx and pushes appointment updates to Omkara, Gracious, and Skylark
Google Sheets by matching AWB numbers.
"""

from __future__ import annotations

import logging
import sys
from datetime import datetime
from numbers import Integral, Real
from pathlib import Path

import gspread
import pandas as pd

from filflo_monitor_bus import attach_monitor_handler


BOT_FOLDER = Path(__file__).resolve().parent
LOG_DIR = BOT_FOLDER / "logs"

EXCEL_PATH_COURIER = BOT_FOLDER / "Data.xlsx"

GOOGLE_CLIENT_SECRET = BOT_FOLDER / "client_secret.json"
GOOGLE_AUTH_TOKEN = BOT_FOLDER / "authorized_user.json"

OMKARA_SHEET_ID = "1VcGBpoD_ev1p_1XpZ4yMMVv_HdBP19Gqo-2sPFMrCho"
SKYLARK_SHEET_ID = "1zL7fue0UmtHRinhsO7tp5F3G97mWpZOgWYzQVGbKrHg"
GRACIOUS_SHEET_ID = "1ZlB2B1UhpSFtVkxRRoQG7uU56iBZTwZ6GGd7Mudl0z8"

TARGET_DATE_FORMAT = "%d-%b-%y"


def setup_pusher_logging() -> logging.Logger:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_file = LOG_DIR / f"data_pusher_{datetime.now():%Y%m%d}.log"

    logger = logging.getLogger("DataPusher")
    logger.setLevel(logging.DEBUG)
    if logger.handlers:
        attach_monitor_handler(logger, source="push_to_gsheet")
        return logger

    file_handler = logging.FileHandler(log_file, encoding="utf-8")
    file_handler.setFormatter(
        logging.Formatter(
            "%(asctime)s | %(levelname)-8s | %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
    )
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(
        logging.Formatter("%(asctime)s | %(levelname)-8s | %(message)s", datefmt="%H:%M:%S")
    )

    logger.addHandler(file_handler)
    logger.addHandler(console_handler)
    attach_monitor_handler(logger, source="push_to_gsheet")
    return logger


def normalize_identifier(value) -> str:
    """Normalize Excel and Google Sheets identifiers such as AWB values."""
    if value is None or pd.isna(value):
        return ""

    if isinstance(value, Integral) and not isinstance(value, bool):
        return str(value)

    if isinstance(value, Real) and not isinstance(value, bool):
        numeric_value = float(value)
        if numeric_value.is_integer():
            return str(int(numeric_value))

    text = str(value).strip()
    text = (
        text.replace("\u200b", "")
        .replace("\ufeff", "")
        .replace("\t", "")
        .replace(" ", "")
    )
    if not text or text.lower() == "nan":
        return ""
    if text.endswith(".0") and text.replace(".", "", 1).isdigit():
        return text.split(".", 1)[0]
    return text


def build_row_number_map(values) -> dict[str, int]:
    """Map normalized tracker identifiers to their first sheet row."""
    row_map: dict[str, int] = {}
    for idx, value in enumerate(values, start=1):
        key = normalize_identifier(value)
        if key and key not in row_map:
            row_map[key] = idx
    return row_map


def describe_run_summary(summary: dict) -> tuple[bool, str]:
    """Convert a run summary into a tool-friendly status and message."""
    status = summary.get("status")
    pushed_omkara = summary.get("pushed_omkara", 0)
    pushed_skylark = summary.get("pushed_skylark", 0)
    pushed_gracious = summary.get("pushed_gracious", 0)
    unmatched = summary.get("unmatched", 0)
    total_pushed = pushed_omkara + pushed_skylark + pushed_gracious
    omkara_tab = summary.get("omkara_tab")
    skylark_tab = summary.get("skylark_tab")
    gracious_tab = summary.get("gracious_tab")
    tab_hint = ""
    if omkara_tab or skylark_tab or gracious_tab:
        tab_hint = (
            f" Checked Omkara '{omkara_tab}', Skylark '{skylark_tab}', "
            f"and Gracious '{gracious_tab}'."
        )

    if status == "pushed":
        return (
            True,
            "Legacy push complete. "
            f"Updated {total_pushed} row(s): Omkara {pushed_omkara}, "
            f"Skylark {pushed_skylark}, Gracious {pushed_gracious}, unmatched {unmatched}.",
        )

    if status == "nothing_to_push":
        return True, "No completed appointments were found in Data.xlsx, so nothing needed pushing."

    if status == "no_matches":
        return (
            False,
            "Push ran, but no tracker rows matched the workbook AWBs so nothing was updated."
            f"{tab_hint}",
        )

    if status == "pushed_with_errors":
        return (
            False,
            "Push updated some tracker rows, but finished with errors. "
            f"Updated {total_pushed} row(s): Omkara {pushed_omkara}, "
            f"Skylark {pushed_skylark}, Gracious {pushed_gracious}, unmatched {unmatched}.",
        )

    error_text = summary.get("error") or "Unknown error"
    return False, f"Push failed: {error_text}"


def _build_summary(
    *,
    success: bool,
    status: str,
    workbook_path: Path,
    omkara_tab: str,
    skylark_tab: str,
    gracious_tab: str,
    total_ready: int,
    pushed_omkara: int,
    pushed_skylark: int,
    pushed_gracious: int,
    unmatched: int,
    errors: int,
    error: str | None = None,
) -> dict:
    summary = {
        "success": success,
        "status": status,
        "workbook_path": str(workbook_path),
        "omkara_tab": omkara_tab,
        "skylark_tab": skylark_tab,
        "gracious_tab": gracious_tab,
        "total_ready": total_ready,
        "pushed_omkara": pushed_omkara,
        "pushed_skylark": pushed_skylark,
        "pushed_gracious": pushed_gracious,
        "unmatched": unmatched,
        "errors": errors,
    }
    if error:
        summary["error"] = error
    return summary


def run_push() -> dict:
    logger = setup_pusher_logging()
    logger.info("=" * 60)
    logger.info("[PUSH] Starting reverse sync from Excel to Google Sheets")

    now = datetime.now()
    omkara_tab_name = now.strftime("%B")
    skylark_tab_name = "Tracker"
    gracious_tab_name = now.strftime("%b. %y")

    if not EXCEL_PATH_COURIER.exists():
        error_message = f"Source file not found: {EXCEL_PATH_COURIER.name}"
        logger.error("[PUSH] %s", error_message)
        return _build_summary(
            success=False,
            status="missing_file",
            workbook_path=EXCEL_PATH_COURIER,
            omkara_tab=omkara_tab_name,
            skylark_tab=skylark_tab_name,
            gracious_tab=gracious_tab_name,
            total_ready=0,
            pushed_omkara=0,
            pushed_skylark=0,
            pushed_gracious=0,
            unmatched=0,
            errors=1,
            error=error_message,
        )

    try:
        df = pd.read_excel(EXCEL_PATH_COURIER)
        df_ready = df[df["Appointment ID"].notna() | df["Scheduled Date"].notna()].copy()
    except Exception as exc:
        error_message = f"Failed to read {EXCEL_PATH_COURIER.name}: {exc}"
        logger.error("[PUSH] %s", error_message)
        return _build_summary(
            success=False,
            status="read_error",
            workbook_path=EXCEL_PATH_COURIER,
            omkara_tab=omkara_tab_name,
            skylark_tab=skylark_tab_name,
            gracious_tab=gracious_tab_name,
            total_ready=0,
            pushed_omkara=0,
            pushed_skylark=0,
            pushed_gracious=0,
            unmatched=0,
            errors=1,
            error=error_message,
        )

    if df_ready.empty:
        logger.info("[PUSH] No completed appointments found in Excel. Nothing to push.")
        logger.info("=" * 60)
        return _build_summary(
            success=True,
            status="nothing_to_push",
            workbook_path=EXCEL_PATH_COURIER,
            omkara_tab=omkara_tab_name,
            skylark_tab=skylark_tab_name,
            gracious_tab=gracious_tab_name,
            total_ready=0,
            pushed_omkara=0,
            pushed_skylark=0,
            pushed_gracious=0,
            unmatched=0,
            errors=0,
        )

    logger.info("[PUSH] Found %s rows with appointment data ready to push.", len(df_ready))

    try:
        gc = gspread.oauth(
            credentials_filename=str(GOOGLE_CLIENT_SECRET),
            authorized_user_filename=str(GOOGLE_AUTH_TOKEN),
        )
    except Exception as exc:
        error_message = f"Authentication failed: {exc}"
        logger.error("[PUSH] %s", error_message)
        return _build_summary(
            success=False,
            status="auth_error",
            workbook_path=EXCEL_PATH_COURIER,
            omkara_tab=omkara_tab_name,
            skylark_tab=skylark_tab_name,
            gracious_tab=gracious_tab_name,
            total_ready=len(df_ready),
            pushed_omkara=0,
            pushed_skylark=0,
            pushed_gracious=0,
            unmatched=0,
            errors=1,
            error=error_message,
        )

    omkara_updates = []
    omkara_formats = []
    skylark_updates = []
    skylark_formats = []
    gracious_updates = []
    gracious_formats = []
    prep_errors = 0

    try:
        logger.info("[PUSH] Fetching Omkara tab: '%s'", omkara_tab_name)
        omkara_ws = gc.open_by_key(OMKARA_SHEET_ID).worksheet(omkara_tab_name)
        omkara_map = build_row_number_map(omkara_ws.col_values(3))
    except Exception as exc:
        logger.error("[PUSH] Failed accessing Omkara: %s", exc)
        omkara_ws = None
        omkara_map = {}
        prep_errors += 1

    try:
        logger.info("[PUSH] Fetching Skylark tab: '%s'", skylark_tab_name)
        skylark_ws = gc.open_by_key(SKYLARK_SHEET_ID).worksheet(skylark_tab_name)
        skylark_map = build_row_number_map(skylark_ws.col_values(3))
    except Exception as exc:
        logger.error("[PUSH] Failed accessing Skylark: %s", exc)
        skylark_ws = None
        skylark_map = {}
        prep_errors += 1

    try:
        logger.info("[PUSH] Fetching Gracious tab: '%s'", gracious_tab_name)
        gracious_ws = gc.open_by_key(GRACIOUS_SHEET_ID).worksheet(gracious_tab_name)
        gracious_map = build_row_number_map(gracious_ws.col_values(4))
    except Exception as exc:
        logger.error("[PUSH] Failed accessing Gracious: %s", exc)
        gracious_ws = None
        gracious_map = {}
        prep_errors += 1

    matched_omkara = 0
    matched_skylark = 0
    matched_gracious = 0
    unmatched_awbs: list[str] = []

    for _, row in df_ready.iterrows():
        raw_awb = row["AWB No."]
        awb = normalize_identifier(raw_awb)
        if not awb:
            unmatched_awbs.append("<blank>")
            logger.warning("[PUSH] Skipping row with blank or invalid AWB value: %r", raw_awb)
            continue

        raw_date = row["Scheduled Date"]
        if pd.notna(raw_date):
            try:
                appointment_date = pd.to_datetime(raw_date).strftime(TARGET_DATE_FORMAT)
            except Exception:
                appointment_date = str(raw_date).strip()
        else:
            appointment_date = ""

        appointment_id = normalize_identifier(row["Appointment ID"])
        reporting_time = str(row["Reporting Time"]).strip() if pd.notna(row["Reporting Time"]) else ""

        if awb in omkara_map:
            row_idx = omkara_map[awb]
            omkara_updates.extend(
                [
                    {"range": f"M{row_idx}", "values": [[appointment_date]]},
                    {"range": f"P{row_idx}", "values": [[appointment_id]]},
                    {"range": f"Q{row_idx}", "values": [[reporting_time]]},
                ]
            )
            if appointment_date:
                omkara_formats.append(
                    {"range": f"M{row_idx}", "format": {"textFormat": {"bold": True}}}
                )
            matched_omkara += 1
            continue

        if awb in gracious_map:
            row_idx = gracious_map[awb]
            gracious_updates.extend(
                [
                    {"range": f"P{row_idx}", "values": [[appointment_date]]},
                    {"range": f"AB{row_idx}", "values": [[appointment_id]]},
                    {"range": f"AD{row_idx}", "values": [[reporting_time]]},
                ]
            )
            if appointment_date:
                gracious_formats.append(
                    {"range": f"P{row_idx}", "format": {"textFormat": {"bold": True}}}
                )
            matched_gracious += 1
            continue

        if awb in skylark_map:
            row_idx = skylark_map[awb]
            skylark_updates.extend(
                [
                    {"range": f"M{row_idx}", "values": [[appointment_date]]},
                    {"range": f"N{row_idx}", "values": [[appointment_id]]},
                    {"range": f"O{row_idx}", "values": [[reporting_time]]},
                ]
            )
            if appointment_date:
                skylark_formats.append(
                    {"range": f"M{row_idx}", "format": {"textFormat": {"bold": True}}}
                )
            matched_skylark += 1
            continue

        unmatched_awbs.append(awb)

    try:
        if omkara_updates:
            omkara_ws.batch_update(omkara_updates)
            if omkara_formats:
                omkara_ws.batch_format(omkara_formats)
            logger.info("[PUSH] Pushed %s records to Omkara Tracker.", matched_omkara)
        else:
            logger.info("[PUSH] No matching records found to update in Omkara.")

        if gracious_updates:
            gracious_ws.batch_update(gracious_updates)
            if gracious_formats:
                gracious_ws.batch_format(gracious_formats)
            logger.info("[PUSH] Pushed %s records to Gracious Tracker.", matched_gracious)
        else:
            logger.info("[PUSH] No matching records found to update in Gracious.")

        if skylark_updates:
            skylark_ws.batch_update(skylark_updates)
            if skylark_formats:
                skylark_ws.batch_format(skylark_formats)
            logger.info("[PUSH] Pushed %s records to Skylark Tracker.", matched_skylark)
        else:
            logger.info("[PUSH] No matching records found to update in Skylark.")
    except Exception as exc:
        error_message = f"Batch update failed: {exc}"
        logger.error("[PUSH] %s", error_message)
        return _build_summary(
            success=False,
            status="batch_error",
            workbook_path=EXCEL_PATH_COURIER,
            omkara_tab=omkara_tab_name,
            skylark_tab=skylark_tab_name,
            gracious_tab=gracious_tab_name,
            total_ready=len(df_ready),
            pushed_omkara=0,
            pushed_skylark=0,
            pushed_gracious=0,
            unmatched=len(unmatched_awbs),
            errors=prep_errors + 1,
            error=error_message,
        )

    total_pushed = matched_omkara + matched_skylark + matched_gracious
    if total_pushed == 0:
        status = "no_matches" if prep_errors == 0 else "error"
        success = False
    elif prep_errors == 0:
        status = "pushed"
        success = True
    else:
        status = "pushed_with_errors"
        success = False

    if unmatched_awbs:
        logger.warning(
            "[PUSH] %s workbook AWB(s) were not found in tracker tabs. Sample: %s",
            len(unmatched_awbs),
            ", ".join(unmatched_awbs[:5]),
        )

    summary = _build_summary(
        success=success,
        status=status,
        workbook_path=EXCEL_PATH_COURIER,
        omkara_tab=omkara_tab_name,
        skylark_tab=skylark_tab_name,
        gracious_tab=gracious_tab_name,
        total_ready=len(df_ready),
        pushed_omkara=matched_omkara,
        pushed_skylark=matched_skylark,
        pushed_gracious=matched_gracious,
        unmatched=len(unmatched_awbs),
        errors=prep_errors,
    )

    logger.info("=" * 60)
    logger.info(
        "[PUSH] Complete. ready=%s pushed_omkara=%s pushed_skylark=%s pushed_gracious=%s unmatched=%s errors=%s status=%s",
        summary["total_ready"],
        summary["pushed_omkara"],
        summary["pushed_skylark"],
        summary["pushed_gracious"],
        summary["unmatched"],
        summary["errors"],
        summary["status"],
    )
    logger.info("Push Pipeline Complete!")
    return summary


if __name__ == "__main__":
    run_push()
