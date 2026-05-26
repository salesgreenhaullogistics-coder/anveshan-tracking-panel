"""
Unit tests for the legacy Google Sheets push flow.
"""

import logging
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import push_to_gsheet


class FakeWorksheet:
    def __init__(self, column_values):
        self._column_values = column_values
        self.batch_update_calls = []
        self.batch_format_calls = []

    def col_values(self, _column_index):
        return list(self._column_values)

    def batch_update(self, payload):
        self.batch_update_calls.append(payload)

    def batch_format(self, payload):
        self.batch_format_calls.append(payload)


class FakeSpreadsheet:
    def __init__(self, worksheet):
        self._worksheet = worksheet
        self.requested_tabs = []

    def worksheet(self, tab_name):
        self.requested_tabs.append(tab_name)
        return self._worksheet


class FakeGoogleClient:
    def __init__(self, omkara_worksheet, gracious_worksheet):
        self._sheets = {
            push_to_gsheet.OMKARA_SHEET_ID: FakeSpreadsheet(omkara_worksheet),
            push_to_gsheet.GRACIOUS_SHEET_ID: FakeSpreadsheet(gracious_worksheet),
        }

    def open_by_key(self, sheet_id):
        return self._sheets[sheet_id]


def make_logger():
    logger = logging.getLogger("push_to_gsheet_test")
    logger.handlers = []
    logger.addHandler(logging.NullHandler())
    return logger


def configure_common_monkeypatches(monkeypatch, tmp_path, dataframe, google_client):
    workbook_path = tmp_path / "Data.xlsx"
    workbook_path.write_text("placeholder", encoding="utf-8")

    monkeypatch.setattr(push_to_gsheet, "EXCEL_PATH_COURIER", workbook_path)
    monkeypatch.setattr(push_to_gsheet, "setup_pusher_logging", make_logger)
    monkeypatch.setattr(push_to_gsheet.pd, "read_excel", lambda _path: dataframe)
    monkeypatch.setattr(push_to_gsheet.gspread, "oauth", lambda **_kwargs: google_client)


def test_normalize_identifier_removes_excel_float_suffix_without_stripping_plain_text():
    assert push_to_gsheet.normalize_identifier(303508526.0) == "303508526"
    assert push_to_gsheet.normalize_identifier(" 303508526.0 ") == "303508526"
    assert push_to_gsheet.normalize_identifier("0303508526") == "0303508526"


def test_describe_run_summary_marks_no_match_runs_as_not_updated():
    success, message = push_to_gsheet.describe_run_summary(
        {
            "status": "no_matches",
            "pushed_omkara": 0,
            "pushed_gracious": 0,
            "unmatched": 16,
            "omkara_tab": "April",
            "gracious_tab": "Apr. 26",
        }
    )

    assert success is False
    assert "nothing was updated" in message
    assert "April" in message


def test_run_push_matches_float_awbs_from_excel_against_string_tracker_values(monkeypatch, tmp_path):
    dataframe = pd.DataFrame(
        [
            {
                "AWB No.": 303508526.0,
                "Appointment ID": 195750200001.0,
                "Scheduled Date": "04 May 2026",
                "Reporting Time": "08:00 am",
            },
            {
                "AWB No.": 303503745.0,
                "Appointment ID": 705986900002.0,
                "Scheduled Date": "05 May 2026",
                "Reporting Time": "09:00 am",
            },
        ]
    )
    omkara_worksheet = FakeWorksheet(["AWB No.", "303508526", "303503745"])
    gracious_worksheet = FakeWorksheet(["AWB No."])
    google_client = FakeGoogleClient(omkara_worksheet, gracious_worksheet)
    configure_common_monkeypatches(monkeypatch, tmp_path, dataframe, google_client)

    summary = push_to_gsheet.run_push()

    assert summary["success"] is True
    assert summary["status"] == "pushed"
    assert summary["pushed_omkara"] == 2
    assert summary["pushed_gracious"] == 0
    assert summary["unmatched"] == 0
    assert len(omkara_worksheet.batch_update_calls) == 1
    assert omkara_worksheet.batch_update_calls[0][0] == {
        "range": "M2",
        "values": [["04-May-26"]],
    }
    assert omkara_worksheet.batch_update_calls[0][1] == {
        "range": "P2",
        "values": [["195750200001"]],
    }


def test_run_push_returns_no_matches_when_tracker_values_do_not_contain_workbook_awbs(monkeypatch, tmp_path):
    dataframe = pd.DataFrame(
        [
            {
                "AWB No.": 303508526.0,
                "Appointment ID": 195750200001.0,
                "Scheduled Date": "04 May 2026",
                "Reporting Time": "08:00 am",
            }
        ]
    )
    omkara_worksheet = FakeWorksheet(["AWB No.", "999999999"])
    gracious_worksheet = FakeWorksheet(["AWB No.", "888888888"])
    google_client = FakeGoogleClient(omkara_worksheet, gracious_worksheet)
    configure_common_monkeypatches(monkeypatch, tmp_path, dataframe, google_client)

    summary = push_to_gsheet.run_push()

    assert summary["success"] is False
    assert summary["status"] == "no_matches"
    assert summary["pushed_omkara"] == 0
    assert summary["pushed_gracious"] == 0
    assert summary["unmatched"] == 1
    assert omkara_worksheet.batch_update_calls == []
    assert gracious_worksheet.batch_update_calls == []
