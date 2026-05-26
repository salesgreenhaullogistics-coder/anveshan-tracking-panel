"""
Cleanup script for the PRN-GDN-RTV Scootsy sheet.

Actions:
1. Strip "Re:", "Fwd:", "Fw:" prefixes from Email SL (column B)
2. Remove duplicate rows (keep the first occurrence, delete from bottom)
"""

import re
from pathlib import Path

import gspread


BOT_FOLDER = Path(__file__).resolve().parent
GOOGLE_CLIENT_SECRET = BOT_FOLDER / "client_secret.json"
GOOGLE_AUTH_TOKEN = BOT_FOLDER / "authorized_user.json"

SPREADSHEET_ID = "1R5IM18UjnF5hB1gPz8Si3oLp6-Et58y5gIEeJS29tyU"
WORKSHEET_GID = 1067521138


def cleanup_scootsy_sheet(
    spreadsheet_id: str = SPREADSHEET_ID,
    worksheet_gid: int = WORKSHEET_GID,
) -> dict:
    """Clean the configured Scootsy worksheet and return a summary."""
    gc = gspread.oauth(
        credentials_filename=str(GOOGLE_CLIENT_SECRET),
        authorized_user_filename=str(GOOGLE_AUTH_TOKEN),
    )

    spreadsheet = gc.open_by_key(spreadsheet_id)
    sheet = None
    for ws in spreadsheet.worksheets():
        if ws.id == worksheet_gid:
            sheet = ws
            break
    if sheet is None:
        sheet = spreadsheet.sheet1

    all_rows = sheet.get_all_values()
    if len(all_rows) <= 1:
        return {
            "sheet_title": sheet.title,
            "total_rows": len(all_rows),
            "updated_subjects": 0,
            "deleted_duplicates": 0,
        }

    data_rows = all_rows[1:]
    seen_subjects = set()
    rows_to_delete: list[int] = []
    rows_to_update: list[tuple[int, str]] = []

    for i, row in enumerate(data_rows):
        row_num = i + 2
        subject = row[1] if len(row) > 1 else ""

        cleaned = re.sub(
            r"^(?:\s*(?:Re|Fwd|Fw)\s*:\s*)+",
            "",
            subject,
            flags=re.IGNORECASE,
        ).strip()

        if cleaned != subject:
            rows_to_update.append((row_num, cleaned))

        cleaned_key = cleaned.strip()
        if cleaned_key in seen_subjects:
            rows_to_delete.append(row_num)
        else:
            seen_subjects.add(cleaned_key)

    for row_num, cleaned_subject in rows_to_update:
        sheet.update_cell(row_num, 2, cleaned_subject)

    rows_to_delete.sort(reverse=True)
    for row_num in rows_to_delete:
        sheet.delete_rows(row_num)

    return {
        "sheet_title": sheet.title,
        "total_rows": len(all_rows),
        "updated_subjects": len(rows_to_update),
        "deleted_duplicates": len(rows_to_delete),
    }


def main():
    summary = cleanup_scootsy_sheet()
    print(f"Sheet: {summary['sheet_title']}")
    print(f"Total rows: {summary['total_rows']}")
    print(f"Updated subjects: {summary['updated_subjects']}")
    print(f"Deleted duplicates: {summary['deleted_duplicates']}")
    print("Cleanup complete.")


if __name__ == "__main__":
    main()
