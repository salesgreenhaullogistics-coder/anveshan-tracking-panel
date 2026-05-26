"""
Instamart Data Feeder - fetch pending Instamart/Scootsy tracker rows into Data.xlsx.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from instamart_sync import (
    DATA_XLSX_PATH,
    TRACKER_DEFINITIONS,
    append_instamart_rows,
    create_google_client,
    current_tracker_sheet_names,
    dedupe_rows_by_po_number,
    extract_instamart_rows_from_values,
    setup_instamart_logging,
)


def _read_tracker_rows(gc, tracker_definition, worksheet_name: str, logger):
    try:
        logger.info(
            "[FETCH] Reading %s tracker tab '%s'",
            tracker_definition.display_name,
            worksheet_name,
        )
        worksheet = gc.open_by_key(tracker_definition.sheet_id).worksheet(worksheet_name)
        values = worksheet.get_all_values()
        rows, skipped_missing_fields = extract_instamart_rows_from_values(values, tracker_definition)
        logger.info(
            "[FETCH] %s yielded %s eligible Instamart row(s)",
            tracker_definition.display_name,
            len(rows),
        )
        if skipped_missing_fields:
            logger.warning(
                "[FETCH] %s skipped %s row(s) with blank PO Number or EDD",
                tracker_definition.display_name,
                skipped_missing_fields,
            )
        return {
            "rows": rows,
            "errors": 0,
            "skipped_missing_fields": skipped_missing_fields,
        }
    except Exception as exc:
        logger.error(
            "[FETCH] %s failed while reading '%s': %s",
            tracker_definition.display_name,
            worksheet_name,
            exc,
        )
        return {"rows": [], "errors": 1, "skipped_missing_fields": 0}


def run_fetch(dry_run: bool = False, excel_path: Path | str = DATA_XLSX_PATH) -> dict:
    excel_path = Path(excel_path)
    logger = setup_instamart_logging("InstamartDataFeeder", "instamart_data_feeder")
    logger.info("=" * 60)
    logger.info("[FETCH] Starting Instamart fetch pipeline")
    logger.info("[FETCH] Workbook: %s", excel_path)
    logger.info("[FETCH] Dry run: %s", dry_run)

    try:
        gc = create_google_client()
    except Exception as exc:
        logger.error("[FETCH] Authentication failed: %s", exc)
        return {
            "success": False,
            "workbook_path": str(excel_path),
            "added": 0,
            "skipped_duplicate": 0,
            "skipped_invalid": 0,
            "duplicate_across_trackers": 0,
            "skipped_missing_fields": 0,
            "errors": 1,
            "error": str(exc),
        }

    worksheet_names = current_tracker_sheet_names()
    omkara_result = _read_tracker_rows(
        gc,
        TRACKER_DEFINITIONS["omkara"],
        worksheet_names["omkara"],
        logger,
    )
    gracious_result = _read_tracker_rows(
        gc,
        TRACKER_DEFINITIONS["gracious"],
        worksheet_names["gracious"],
        logger,
    )

    combined_rows = [*omkara_result["rows"], *gracious_result["rows"]]
    unique_rows, duplicate_across_trackers = dedupe_rows_by_po_number(combined_rows)
    append_summary = append_instamart_rows(unique_rows, excel_path, logger, dry_run=dry_run)

    summary = {
        "success": omkara_result["errors"] == 0 and gracious_result["errors"] == 0,
        "workbook_path": str(excel_path),
        "dry_run": dry_run,
        "omkara_tab": worksheet_names["omkara"],
        "gracious_tab": worksheet_names["gracious"],
        "total_fetched": len(combined_rows),
        "total_unique": len(unique_rows),
        "duplicate_across_trackers": duplicate_across_trackers,
        "added": append_summary["added"],
        "skipped_duplicate": append_summary["skipped_duplicate"],
        "skipped_invalid": append_summary["skipped_invalid"],
        "skipped_missing_fields": (
            omkara_result["skipped_missing_fields"] + gracious_result["skipped_missing_fields"]
        ),
        "errors": omkara_result["errors"] + gracious_result["errors"],
    }

    logger.info(
        "[FETCH] Complete. fetched=%s unique=%s added=%s duplicate_in_workbook=%s duplicate_across_trackers=%s errors=%s",
        summary["total_fetched"],
        summary["total_unique"],
        summary["added"],
        summary["skipped_duplicate"],
        summary["duplicate_across_trackers"],
        summary["errors"],
    )
    logger.info("=" * 60)
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fetch Instamart rows from Google Sheets into Data.xlsx")
    parser.add_argument("--dry-run", action="store_true", help="Preview rows without writing to Data.xlsx")
    parser.add_argument("--excel", default=str(DATA_XLSX_PATH), help="Workbook path to append into")
    args = parser.parse_args()
    run_fetch(dry_run=args.dry_run, excel_path=args.excel)
