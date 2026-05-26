"""
patch_bot_v3.py  (FINAL VERSION)
─────────────────────────────────
The patch has already been applied to:
    filflo_combined_bot_v3_backup_20260402_152456.py

This script simply copies that patched file as the new
    filflo_combined_bot_v3.py

Run from the Filflo_Bot folder:
    python patch_bot_v3.py
"""

import sys
import io
import shutil
from pathlib import Path
from datetime import datetime

# Fix Unicode output on Windows cp1252 console
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

FOLDER  = Path(__file__).parent
TARGET  = FOLDER / "filflo_combined_bot_v3.py"
SOURCE  = FOLDER / "filflo_combined_bot_v3_backup_20260402_152456.py"

def apply_patch_bot(
    source: Path = SOURCE,
    target: Path = TARGET,
    create_backup: bool = True,
) -> dict:
    """Copy the patched backup file into place and return a summary."""
    if not source.exists():
        raise FileNotFoundError(f"Patched source file not found: {source}")

    backup_path = None
    if create_backup and target.exists() and target.stat().st_size > 0:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_path = FOLDER / f"{target.stem}_OLD_{stamp}{target.suffix}"
        shutil.copy2(target, backup_path)

    shutil.copy2(source, target)
    line_count = len(target.read_text(encoding="utf-8").splitlines())

    return {
        "source": str(source),
        "target": str(target),
        "backup": str(backup_path) if backup_path else "",
        "line_count": line_count,
    }


def main():
    print()
    print("Filflo Bot v3 - Final Patcher")
    print("=" * 50)

    try:
        summary = apply_patch_bot()
    except FileNotFoundError as exc:
        print(f"ERROR: {exc}")
        sys.exit(1)

    if summary["backup"]:
        print(f"  Old file backed up: {Path(summary['backup']).name}")
    print(f"  Copied: {Path(summary['source']).name}  ->  {Path(summary['target']).name}")
    print(f"  Lines in new file: {summary['line_count']}")
    print()
    print("=" * 50)
    print("SUCCESS - filflo_combined_bot_v3.py is now updated.")
    print()
    print("Changes applied:")
    print("  1. Download timeout:     120s  ->  600s (10 min)")
    print("  2. Retry attempts:       1     ->  up to 10")
    print("  3. Wait between retries:       5 minutes")
    print("  4. Page refresh before each retry")

if __name__ == "__main__":
    main()
