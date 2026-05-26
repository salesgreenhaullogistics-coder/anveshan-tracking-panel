"""
Instamart Data Pusher - push booked Instamart appointments from Data.xlsx to tracker sheets.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from instamart_sync import (
    DATA_XLSX_PATH,
    TRACKER_DEFINITIONS,
    build_row_number_map,
    column_letter_to_index,
    create_google_client,
    current_tracker_sheet_names,
    format_scheduled_date_for_tracker,
    load_instamart_rows_ready_for_push,
    setup_instamart_logging,
)


def _prepare_tracker_map(gc, tracker_definition, worksheet_name: str, logger):
    try:
        logger.info(
            "[PUSH] Preparing %s tracker tab '%s' for PO-number matching",
            tracker_definition.display_name,
            worksheet_name,
        )
        worksheet = gc.open_by_key(tracker_definition.sheet_id).worksheet(worksheet_name)
        po_values = worksheet.col_values(column_letter_to_index(tracker_definition.po_lookup_column))
        return {
            "worksheet": worksheet,
            "row_map": build_row_number_map(po_values),
            "errors": 0,
        }
    except Exception as exc:
        logger.error(
            "[PUSH] %s failed while preparing '%s': %s",
            tracker_definition.display_name,
            worksheet_name,
            exc,
        )
        return {"worksheet": None, "row_map": {}, "errors": 1}


def run_push(dry_run: bool = False, excel_path: Path | str = DATA_XLSX_PATH) -> dict:
    excel_path = Path(excel_path)
    logger = setup_instamart_logging("InstamartDataPusher", "instamart_data_pusher")
    logger.info("=" * 60)
    logger.info("[PUSH] Starting Instamart reverse sync")
    logger.info("[PUSH] Workbook: %s", excel_path)
    logger.info("[PUSH] Dry run: %s", dry_run)

    try:
        ready_rows = load_instamart_rows_ready_for_push(excel_path, logger)
    except Exception as exc:
        logger.error("[PUSH] Failed to read workbook rows: %s", exc)
        return {
            "success": False,
            "workbook_path": str(excel_path),
            "total_ready": 0,
            "pushed_omkara": 0,
            "pushed_gracious": 0,
            "unmatched": 0,
            "errors": 1,
            "error": str(exc),
        }

    if not ready_rows:
        logger.info("[PUSH] No Instamart rows with appointment data were found.")
        logger.info("=" * 60)
        return {
            "success": True,
            "workbook_path": str(excel_path),
            "dry_run": dry_run,
            "total_ready": 0,
            "pushed_omkara": 0,
            "pushed_gracious": 0,
            "unmatched": 0,
            "errors": 0,
        }

    try:
        gc = create_google_client()
    except Exception as exc:
        logger.error("[PUSH] Authentication failed: %s", exc)
        return {
            "success": False,
            "workbook_path": str(excel_path),
            "total_ready": len(ready_rows),
            "pushed_omkara": 0,
            "pushed_gracious": 0,
            "unmatched": 0,
            "errors": 1,
            "error": str(exc),
        }

    worksheet_names = current_tracker_sheet_names()
    omkara_context = _prepare_tracker_map(
        gc,
        TRACKER_DEFINITIONS["omkara"],
        worksheet_names["omkara"],
        logger,
    )
    gracious_context = _prepare_tracker_map(
        gc,
        TRACKER_DEFINITIONS["gracious"],
        worksheet_names["gracious"],
        logger,
    )

    omkara_updates = []
    omkara_formats = []
    gracious_updates = []
    gracious_formats = []
    pushed_omkara = 0
    pushed_gracious = 0
    unmatched = 0

    for row in ready_rows:
        po_number = row["po_number"]
        appointment_date = format_scheduled_date_for_tracker(row["scheduled_date"])
        appointment_id = row["appointment_id"]
        reporting_time = row["reporting_time"]

        if po_number in omkara_context["row_map"]:
            row_index = omkara_context["row_map"][po_number]
            omkara_updates.extend(
                [
                    {"range": f"M{row_index}", "values": [[appointment_date]]},
                    {"range": f"P{row_index}", "values": [[appointment_id]]},
                    {"range": f"Q{row_index}", "values": [[reporting_time]]},
                ]
            )
            if appointment_date:
                omkara_formats.append(
                    {"range": f"M{row_index}", "format": {"textFormat": {"bold": True}}}
                )
            pushed_omkara += 1
            continue

        if po_number in gracious_context["row_map"]:
            row_index = gracious_context["row_map"][po_number]
            gracious_updates.extend(
                [
                    {"range": f"P{row_index}", "values": [[appointment_date]]},
                    {"range": f"AB{row_index}", "values": [[appointment_id]]},
                    {"range": f"AD{row_index}", "values": [[reporting_time]]},
                ]
            )
            if appointment_date:
                gracious_formats.append(
                    {"range": f"P{row_index}", "format": {"textFormat": {"bold": True}}}
                )
            pushed_gracious += 1
            continue

        unmatched += 1
        logger.warning("[PUSH] PO %s was not found in Omkara or Gracious", po_number)

    try:
        if omkara_updates and omkara_context["worksheet"] is not None and not dry_run:
            omkara_context["worksheet"].batch_update(omkara_updates)
            if omkara_formats:
                omkara_context["worksheet"].batch_format(omkara_formats)
        if gracious_updates and gracious_context["worksheet"] is not None and not dry_run:
            gracious_context["worksheet"].batch_update(gracious_updates)
            if gracious_formats:
                gracious_context["worksheet"].batch_format(gracious_formats)
    except Exception as exc:
        logger.error("[PUSH] Batch update failed: %s", exc)
        return {
            "success": False,
            "workbook_path": str(excel_path),
            "dry_run": dry_run,
            "omkara_tab": worksheet_names["omkara"],
            "gracious_tab": worksheet_names["gracious"],
            "total_ready": len(ready_rows),
            "pushed_omkara": 0 if not dry_run else pushed_omkara,
            "pushed_gracious": 0 if not dry_run else pushed_gracious,
            "unmatched": unmatched,
            "errors": 1 + omkara_context["errors"] + gracious_context["errors"],
            "error": str(exc),
        }

    if omkara_updates:
        logger.info(
            "[PUSH] %s %s update(s) for Omkara",
            "Prepared" if dry_run else "Pushed",
            pushed_omkara,
        )
    if gracious_updates:
        logger.info(
            "[PUSH] %s %s update(s) for Gracious",
            "Prepared" if dry_run else "Pushed",
            pushed_gracious,
        )

    summary = {
        "success": omkara_context["errors"] == 0 and gracious_context["errors"] == 0,
        "workbook_path": str(excel_path),
        "dry_run": dry_run,
        "omkara_tab": worksheet_names["omkara"],
        "gracious_tab": worksheet_names["gracious"],
        "total_ready": len(ready_rows),
        "pushed_omkara": pushed_omkara,
        "pushed_gracious": pushed_gracious,
        "unmatched": unmatched,
        "errors": omkara_context["errors"] + gracious_context["errors"],
    }
    logger.info(
        "[PUSH] Complete. ready=%s pushed_omkara=%s pushed_gracious=%s unmatched=%s errors=%s",
        summary["total_ready"],
        summary["pushed_omkara"],
        summary["pushed_gracious"],
        summary["unmatched"],
        summary["errors"],
    )
    logger.info("=" * 60)
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Push completed Instamart appointment data from Data.xlsx back to Google Sheets"
    )
    parser.add_argument("--dry-run", action="store_true", help="Preview updates without writing to Google Sheets")
    parser.add_argument("--excel", default=str(DATA_XLSX_PATH), help="Workbook path to read from")
    args = parser.parse_args()
    run_push(dry_run=args.dry_run, excel_path=args.excel)
