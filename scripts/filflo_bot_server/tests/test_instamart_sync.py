"""
Unit tests for shared Instamart Python sync helpers.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from instamart_sync import (
    TRACKER_DEFINITIONS,
    build_row_number_map,
    dedupe_rows_by_po_number,
    extract_instamart_rows_from_values,
    format_scheduled_date_for_tracker,
)


def test_extract_instamart_rows_from_values_keeps_only_pending_instamart_platforms():
    values = [
        [],
        ["", "", "", "", "", "Scootsy", "", "", "", "", "In Transit", "12-05-2026", "", "", "", "", "", "", "", "", "", "", "PO-1"],
        ["", "", "", "", "", "Hands on Traders", "", "", "", "", "intransit", "13-05-2026", "", "", "", "", "", "", "", "", "", "", "PO-2"],
        ["", "", "", "", "", "Instamart", "", "", "", "", "intransit", "14-05-2026", "Already Booked", "", "", "", "", "", "", "", "", "", "PO-3"],
        ["", "", "", "", "", "Instamart", "", "", "", "", "intransit", "15-05-2026", "", "", "", "", "", "", "", "", "", "", "PO-4"],
    ]

    rows, skipped_missing_fields = extract_instamart_rows_from_values(
        values, TRACKER_DEFINITIONS["omkara"]
    )

    assert [row["PO Number"] for row in rows] == ["PO-1", "PO-4"]
    assert skipped_missing_fields == 0


def test_extract_instamart_rows_from_values_counts_missing_po_or_edd():
    values = [
        [],
        ["", "", "", "", "", "", "Instamart", "", "", "", "", "", "", "intransit", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "PO-1"],
        ["", "", "", "", "", "", "Scootsy", "", "", "", "", "", "", "intransit", "", "", "", "", "", "", "", "", "17-05-2026", "", "", "", "", "", "", "", ""],
    ]

    rows, skipped_missing_fields = extract_instamart_rows_from_values(
        values, TRACKER_DEFINITIONS["gracious"]
    )

    assert rows == []
    assert skipped_missing_fields == 2


def test_dedupe_rows_by_po_number_keeps_first_po():
    rows, duplicate_count = dedupe_rows_by_po_number(
        [
            {"PO Number": "PO-1", "EDD": "12-05-2026"},
            {"PO Number": "PO-1", "EDD": "13-05-2026"},
            {"PO Number": "PO-2", "EDD": "14-05-2026"},
        ]
    )

    assert rows == [
        {"PO Number": "PO-1", "EDD": "12-05-2026"},
        {"PO Number": "PO-2", "EDD": "14-05-2026"},
    ]
    assert duplicate_count == 1


def test_build_row_number_map_uses_first_occurrence_only():
    row_map = build_row_number_map(["PO Number", "PO-1", "PO-2", "PO-1"])

    assert row_map["PO-1"] == 2
    assert row_map["PO-2"] == 3


def test_format_scheduled_date_for_tracker_formats_supported_values():
    assert format_scheduled_date_for_tracker("12 May 2026") == "12-May-26"
