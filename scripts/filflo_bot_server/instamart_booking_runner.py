"""
Python wrapper that launches the isolated Instamart Playwright booking bot.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Callable

from instamart_sync import BOT_FOLDER, DATA_XLSX_PATH, setup_instamart_logging
from instamart_runtime import read_instamart_status


INSTAMART_BOT_DIR = BOT_FOLDER / "instamart-playwright-bot"


def build_instamart_booking_command(excel_path: Path | str = DATA_XLSX_PATH) -> list[str]:
    excel_path = Path(excel_path).resolve()

    if shutil.which("npm.cmd"):
        return ["npm.cmd", "run", "book-instamart", "--", "--excel", str(excel_path)]
    if shutil.which("npm"):
        return ["npm", "run", "book-instamart", "--", "--excel", str(excel_path)]
    if shutil.which("node"):
        return ["node", "src/index.js", "book-instamart", "--excel", str(excel_path)]

    raise FileNotFoundError("Neither npm nor node is available on PATH for Instamart booking.")


def _read_process_output(
    process: subprocess.Popen,
    logger,
    output_lines: list[str],
) -> None:
    assert process.stdout is not None
    for line in process.stdout:
        text = line.rstrip()
        output_lines.append(text)
        if text:
            logger.info("[BOOK] %s", text)


def _status_signature(status: dict | None) -> tuple[str, str, str, str]:
    if not status:
        return ("", "", "", "")

    return (
        str(status.get("updatedAt", "") or ""),
        str(status.get("state", "") or ""),
        str(status.get("message", "") or ""),
        str(status.get("poNumber", "") or ""),
    )


def _status_progress_message(status: dict | None) -> str | None:
    if not status:
        return None

    state = str(status.get("state", "") or "").strip()
    message = str(status.get("message", "") or "").strip()

    if state == "waiting_for_otp":
        otp_file = str(status.get("otpFile", "") or "").strip()
        otp_hint = (
            f" Reply here with `instamart otp 123456` or add the OTP to `{otp_file}`."
            if otp_file
            else " Reply here with `instamart otp 123456`."
        )
        return f"{message or 'Instamart login is waiting for OTP.'}{otp_hint}"

    if state == "authenticated":
        return message or "Instamart login completed successfully. Continuing booking."

    return None


def run_booking(
    excel_path: Path | str = DATA_XLSX_PATH,
    *,
    progress_callback: Callable[[str], None] | None = None,
) -> dict:
    excel_path = Path(excel_path).resolve()
    logger = setup_instamart_logging("InstamartBookingRunner", "instamart_booking_runner")
    command = build_instamart_booking_command(excel_path)

    logger.info("=" * 60)
    logger.info("[BOOK] Launching isolated Instamart booking bot")
    logger.info("[BOOK] Working directory: %s", INSTAMART_BOT_DIR)
    logger.info("[BOOK] Command: %s", " ".join(command))

    process = subprocess.Popen(
        command,
        cwd=INSTAMART_BOT_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )

    output_lines: list[str] = []
    output_thread = threading.Thread(
        target=_read_process_output,
        args=(process, logger, output_lines),
        name="instamart-booking-output",
        daemon=True,
    )
    output_thread.start()

    baseline_signature = _status_signature(read_instamart_status())
    last_signature = baseline_signature
    last_progress_message = ""

    while process.poll() is None:
        status = read_instamart_status()
        signature = _status_signature(status)
        if signature != last_signature:
            last_signature = signature
            if progress_callback:
                progress_message = _status_progress_message(status)
                if progress_message and progress_message != last_progress_message:
                    progress_callback(progress_message)
                    last_progress_message = progress_message
        time.sleep(1)

    return_code = process.wait()
    output_thread.join(timeout=5)

    final_status = read_instamart_status()
    final_progress_message = _status_progress_message(final_status)
    if (
        progress_callback
        and final_progress_message
        and final_progress_message != last_progress_message
        and _status_signature(final_status) != baseline_signature
    ):
        progress_callback(final_progress_message)
    success = return_code == 0
    message = (
        "Instamart booking run finished."
        if success
        else f"Instamart booking run failed with exit code {return_code}."
    )

    logger.info("[BOOK] %s", message)
    logger.info("=" * 60)
    return {
        "success": success,
        "message": message,
        "returncode": return_code,
        "command": command,
        "workdir": str(INSTAMART_BOT_DIR),
        "workbook_path": str(excel_path),
        "output_tail": "\n".join(output_lines[-40:]),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Launch the isolated Instamart Playwright booking bot")
    parser.add_argument("--excel", default=str(DATA_XLSX_PATH), help="Workbook path to process")
    args = parser.parse_args()
    run_booking(excel_path=args.excel)
