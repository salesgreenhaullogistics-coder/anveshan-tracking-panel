"""
Internal registry that exposes bot workflows as LLM-callable tools.
"""

import inspect
import threading
import time
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable

import filflo_combined_bot_v3 as v3
from filflo_monitor_bus import emit_monitor_event


@dataclass
class ToolDefinition:
    """One tool that the LLM can call."""

    name: str
    description: str
    parameters: dict
    handler: Callable
    requires_confirmation: bool = False


@dataclass
class ToolResult:
    """Returned after a tool executes."""

    success: bool
    message: str
    data: dict = field(default_factory=dict)


class ToolRegistry:
    """Central registry that holds tool definitions and dispatches calls."""

    _PLACEHOLDER_EXCEL_TOKENS = (
        "path_to_your_excel_file",
        "path_to_excel_file",
        "your_excel_file",
        "path/to/your/excel/file",
        "path\\to\\your\\excel\\file",
        "excel_path_here",
        "excel_file_path",
        "<excel_path>",
        "<path_to_excel>",
    )
    _PLACEHOLDER_EXCEL_RE = re.compile(r"^(?:<.*>|example[_\-\s]*file.*|sample[_\-\s]*file.*)$", re.IGNORECASE)

    def __init__(self, logger=None):
        self.logger = logger or v3.setup_logging(v3.LOG_DIR)
        self._tools: dict[str, ToolDefinition] = {}
        self._active_driver = None
        self._monitor = None
        self._driver_lock = threading.Lock()
        self._register_all()

    def register(self, tool: ToolDefinition):
        self._tools[tool.name] = tool

    def get(self, name: str) -> ToolDefinition | None:
        return self._tools.get(name)

    def to_openai_tools(self) -> list[dict]:
        """Return tool schemas compatible with OpenAI/Groq tool calling."""
        schemas = []
        for tool in self._tools.values():
            schemas.append(
                {
                    "type": "function",
                    "function": {
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.parameters,
                    },
                }
            )
        return schemas

    def _normalize_excel_path(self, value) -> str | None:
        text = str(value or "").strip().strip("`").strip("\"'")
        if not text:
            return None

        lowered = text.replace("\\", "/").lower()
        if any(token in lowered for token in self._PLACEHOLDER_EXCEL_TOKENS):
            return None
        if self._PLACEHOLDER_EXCEL_RE.match(text):
            return None
        return text

    def normalize_arguments(self, name: str, arguments: dict | None) -> dict:
        if not arguments or not isinstance(arguments, dict):
            return {}

        normalized = dict(arguments)
        if "excel_path" in normalized:
            excel_path = self._normalize_excel_path(normalized.get("excel_path"))
            if excel_path:
                normalized["excel_path"] = excel_path
            else:
                normalized.pop("excel_path", None)

        return normalized

    def execute(
        self,
        name: str,
        arguments: dict = None,
        *,
        progress_callback: Callable[[str], None] | None = None,
    ) -> ToolResult:
        tool = self._tools.get(name)
        if not tool:
            emit_monitor_event(
                "tool_registry",
                f"Unknown tool requested: {name}",
                level="ERROR",
                event_type="tool_result",
                data={"tool_name": name},
            )
            return ToolResult(success=False, message=f"Unknown tool: {name}")

        arguments = self.normalize_arguments(name, arguments)

        emit_monitor_event(
            "tool_registry",
            f"Starting {name}({arguments})",
            level="INFO",
            event_type="tool_start",
            data={"tool_name": name, "arguments": arguments},
        )
        try:
            self.logger.info(f"[ToolRegistry] Executing: {name}({arguments})")
            handler_kwargs = dict(arguments)
            if progress_callback:
                try:
                    handler_signature = inspect.signature(tool.handler)
                except (TypeError, ValueError):
                    handler_signature = None
                if handler_signature and "progress_callback" in handler_signature.parameters:
                    handler_kwargs["progress_callback"] = progress_callback

            result = tool.handler(**handler_kwargs)
            emit_monitor_event(
                "tool_registry",
                f"{'OK' if result.success else 'FAIL'} {name} -> {result.message}",
                level="INFO" if result.success else "ERROR",
                event_type="tool_result",
                data={"tool_name": name, "arguments": arguments, "success": result.success},
            )
            return result
        except Exception as exc:
            self.logger.error(f"[ToolRegistry] {name} raised: {exc}", exc_info=True)
            emit_monitor_event(
                "tool_registry",
                f"FAIL {name} -> {exc}",
                level="ERROR",
                event_type="tool_result",
                data={"tool_name": name, "arguments": arguments, "success": False},
            )
            return ToolResult(success=False, message=f"Tool '{name}' failed: {exc}")

    def _get_or_create_driver(self):
        with self._driver_lock:
            if self._active_driver is None:
                self._active_driver = v3.create_driver(self.logger)
            return self._active_driver

    def _close_driver(self):
        with self._driver_lock:
            if self._active_driver:
                try:
                    self._active_driver.quit()
                except Exception:
                    pass
                self._active_driver = None

    def _get_monitor(self):
        if self._monitor is None:
            from bot_monitor import BotMonitor

            stats_file = v3.LOG_DIR / "monitor_stats.json"
            self._monitor = BotMonitor(logger=self.logger, stats_file=stats_file)
        return self._monitor

    def _record_monitor_result(self, po_number: str, result: str, duration_sec: float = 0.0):
        v3.record_monitor_outcome(self._get_monitor(), po_number, result, duration_sec)

    def _register_all(self):
        self._register_process_pending()
        self._register_process_single_po()
        self._register_download_report()
        self._register_import_downloaded_report()
        self._register_get_status_summary()
        self._register_get_po_status()
        self._register_get_pending_count()
        self._register_get_todays_log_summary()
        self._register_list_pod_files()
        self._register_reset_statuses()
        self._register_cleanup_no_date()
        self._register_feed_data()
        self._register_feed_pod_data()
        self._register_grn_email_processor()
        self._register_process_multi_agent()
        self._register_push_to_gsheet()
        self._register_fetch_instamart()
        self._register_book_instamart()
        self._register_submit_instamart_otp()
        self._register_push_instamart()
        self._register_get_monitor_dashboard()
        self._register_reset_monitor_stats()
        self._register_run_blinkit_booker()
        self._register_cleanup_scootsy_sheet()
        self._register_create_sample_excel()
        self._register_patch_v3_bot()

    def _register_push_to_gsheet(self):
        def handler() -> ToolResult:
            try:
                import push_to_gsheet

                self.logger.info("[Tool: push_to_gsheet] Starting reverse sync pipeline...")
                summary = push_to_gsheet.run_push()
                success, message = push_to_gsheet.describe_run_summary(summary)
                return ToolResult(success, message, summary)
            except Exception as exc:
                return ToolResult(False, f"Push failed: {exc}")

        self.register(
            ToolDefinition(
                name="push_to_gsheet",
                description=(
                    "Push legacy courier appointment data from Data.xlsx back to the Omkara and "
                    "Gracious Google Sheets by matching AWB numbers."
                ),
                parameters={"type": "object", "properties": {}, "required": []},
                handler=handler,
                requires_confirmation=True,
            )
        )

    def _register_fetch_instamart(self):
        def handler(dry_run: bool = False, excel_path: str = "") -> ToolResult:
            import instamart_data_feeder

            summary = instamart_data_feeder.run_fetch(
                dry_run=dry_run,
                excel_path=excel_path or instamart_data_feeder.DATA_XLSX_PATH,
            )
            success = bool(summary.get("success", False))
            label = "preview complete" if dry_run else "run complete"
            return ToolResult(
                success,
                (
                    f"Instamart fetch {label}. Added={summary.get('added', 0)}, "
                    f"Skipped duplicate={summary.get('skipped_duplicate', 0)}, "
                    f"Errors={summary.get('errors', 0)}."
                ),
                summary,
            )

        self.register(
            ToolDefinition(
                name="fetch_instamart",
                description=(
                    "Fetch pending Instamart and Scootsy tracker rows into Data.xlsx using only "
                    "PO Number and EDD, without affecting the legacy AWB-based feeder."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "dry_run": {"type": "boolean"},
                        "excel_path": {"type": "string"},
                    },
                },
                handler=handler,
                requires_confirmation=True,
            )
        )

    def _register_book_instamart(self):
        def handler(
            excel_path: str = "",
            progress_callback: Callable[[str], None] | None = None,
        ) -> ToolResult:
            import instamart_booking_runner

            summary = instamart_booking_runner.run_booking(
                excel_path=excel_path or instamart_booking_runner.DATA_XLSX_PATH,
                progress_callback=progress_callback,
            )
            message = summary.get("message", "Instamart booking run finished.")
            return ToolResult(bool(summary.get("success", False)), message, summary)

        self.register(
            ToolDefinition(
                name="book_instamart",
                description=(
                    "Run the isolated Instamart Playwright booking bot against the blank-AWB "
                    "Instamart rows inside Data.xlsx."
                ),
                parameters={"type": "object", "properties": {"excel_path": {"type": "string"}}},
                handler=handler,
                requires_confirmation=True,
            )
        )

    def _register_submit_instamart_otp(self):
        def handler(otp: str) -> ToolResult:
            import instamart_runtime

            summary = instamart_runtime.submit_instamart_otp(otp)
            return ToolResult(
                True,
                f"Instamart OTP submitted to {summary.get('otp_file', '')}.",
                summary,
            )

        self.register(
            ToolDefinition(
                name="submit_instamart_otp",
                description=(
                    "Submit an OTP to a currently waiting Instamart login run without starting "
                    "a new booking session."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "otp": {"type": "string"},
                    },
                    "required": ["otp"],
                },
                handler=handler,
                requires_confirmation=False,
            )
        )

    def _register_push_instamart(self):
        def handler(dry_run: bool = False, excel_path: str = "") -> ToolResult:
            import instamart_push_to_gsheet

            summary = instamart_push_to_gsheet.run_push(
                dry_run=dry_run,
                excel_path=excel_path or instamart_push_to_gsheet.DATA_XLSX_PATH,
            )
            success = bool(summary.get("success", False))
            label = "preview complete" if dry_run else "run complete"
            return ToolResult(
                success,
                (
                    f"Instamart push {label}. Omkara={summary.get('pushed_omkara', 0)}, "
                    f"Gracious={summary.get('pushed_gracious', 0)}, "
                    f"Unmatched={summary.get('unmatched', 0)}, Errors={summary.get('errors', 0)}."
                ),
                summary,
            )

        self.register(
            ToolDefinition(
                name="push_instamart",
                description=(
                    "Push completed blank-AWB Instamart appointment rows from Data.xlsx back to "
                    "the tracker sheets by matching PO Number."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "dry_run": {"type": "boolean"},
                        "excel_path": {"type": "string"},
                    },
                },
                handler=handler,
                requires_confirmation=True,
            )
        )

    def _register_process_pending(self):
        def handler(excel_path: str = "") -> ToolResult:
            path = Path(excel_path) if excel_path else v3.DEFAULT_EXCEL_PATH
            if not path.exists():
                return ToolResult(False, f"Excel file not found: {path}")
            summary = v3.process_all_entries(path, self.logger, monitor=self._get_monitor())
            success = summary.get("failed", 0) == 0 and summary.get("unverified", 0) == 0
            message = (
                f"Batch processing completed. Verified={summary.get('verified', 0)}, "
                f"Unverified={summary.get('unverified', 0)}, "
                f"Skipped={summary.get('skipped', 0)}, Failed={summary.get('failed', 0)}."
            )
            return ToolResult(success, message, summary)

        self.register(
            ToolDefinition(
                name="process_pending",
                description="Process all pending PO entries from the Excel sheet.",
                parameters={"type": "object", "properties": {"excel_path": {"type": "string"}}},
                handler=handler,
                requires_confirmation=True,
            )
        )

    def _register_process_single_po(self):
        def handler(po_number: str) -> ToolResult:
            path = v3.DEFAULT_EXCEL_PATH
            entries = v3.read_pending_entries(path, self.logger)
            match = [entry for entry in entries if entry["po_number"] == po_number.strip()]
            if not match:
                return ToolResult(False, f"PO '{po_number}' not found.")

            driver = self._get_or_create_driver()
            if not v3.is_session_valid(driver, self.logger):
                v3.login(driver, self.logger)

            started = time.perf_counter()
            result_status = v3.process_single_po_with_retry(driver, match[0], path, self.logger)
            duration_sec = time.perf_counter() - started
            self._record_monitor_result(po_number.strip(), result_status, duration_sec)

            success = (
                result_status.startswith("VERIFIED")
                or result_status.startswith("SKIPPED")
                or result_status == "ALREADY_DONE"
            )
            return ToolResult(success, f"PO {po_number}: {result_status}", {"status": result_status})

        self.register(
            ToolDefinition(
                name="process_single_po",
                description="Process one specific PO number.",
                parameters={
                    "type": "object",
                    "properties": {"po_number": {"type": "string"}},
                    "required": ["po_number"],
                },
                handler=handler,
                requires_confirmation=True,
            )
        )

    def _register_get_status_summary(self):
        def handler() -> ToolResult:
            path = v3.DEFAULT_EXCEL_PATH
            if not path.exists():
                return ToolResult(False, "Excel not found.")

            wb = __import__("openpyxl").load_workbook(path, data_only=True)
            ws = wb.active
            total = verified = failed = pending = 0
            for row in range(2, ws.max_row + 1):
                if not ws.cell(row, 1).value:
                    continue
                total += 1
                stat = str(ws.cell(row, 5).value or "").upper()
                if "VERIFIED" in stat:
                    verified += 1
                elif "FAILED" in stat:
                    failed += 1
                else:
                    pending += 1
            wb.close()

            msg = f"Total: {total} | Done: {verified} | Fail: {failed} | Pending: {pending}"
            return ToolResult(True, msg, {"total": total, "verified": verified, "failed": failed, "pending": pending})

        self.register(
            ToolDefinition(
                name="get_status_summary",
                description="Summary of POs in Excel.",
                parameters={"type": "object", "properties": {}},
                handler=handler,
            )
        )

    def _register_get_po_status(self):
        def handler(po_number: str) -> ToolResult:
            path = v3.DEFAULT_EXCEL_PATH
            wb = __import__("openpyxl").load_workbook(path, data_only=True)
            ws = wb.active
            for row in range(2, ws.max_row + 1):
                if str(ws.cell(row, 1).value or "").strip() == po_number.strip():
                    status = str(ws.cell(row, 5).value or "Pending")
                    wb.close()
                    return ToolResult(True, f"PO {po_number} Status: {status}", {"status": status})
            wb.close()
            return ToolResult(False, f"PO {po_number} not found.")

        self.register(
            ToolDefinition(
                name="get_po_status",
                description="Check status of one PO.",
                parameters={
                    "type": "object",
                    "properties": {"po_number": {"type": "string"}},
                    "required": ["po_number"],
                },
                handler=handler,
            )
        )

    def _register_get_pending_count(self):
        def handler() -> ToolResult:
            entries = v3.read_pending_entries(v3.DEFAULT_EXCEL_PATH, self.logger)
            return ToolResult(True, f"Pending Entries: {len(entries)}", {"pending": len(entries)})

        self.register(
            ToolDefinition(
                name="get_pending_count",
                description="Get count of pending POs.",
                parameters={"type": "object", "properties": {}},
                handler=handler,
            )
        )

    def _register_get_todays_log_summary(self):
        def handler(date: str = "") -> ToolResult:
            log_date = date if date else datetime.now().strftime("%Y%m%d")
            log_file = v3.LOG_DIR / f"combined_bot_{log_date}.log"
            if not log_file.exists():
                return ToolResult(False, "Log not found.")

            lines = log_file.read_text(encoding="utf-8", errors="replace").splitlines()
            verified = sum(1 for line in lines if "VERIFIED" in line.upper())
            failed = sum(1 for line in lines if "FAILED" in line.upper())
            return ToolResult(
                True,
                f"Log {log_date}: {verified} Verified, {failed} Failed.",
                {"verified": verified, "failed": failed},
            )

        self.register(
            ToolDefinition(
                name="get_todays_log_summary",
                description="Read today's bot logs.",
                parameters={"type": "object", "properties": {"date": {"type": "string"}}},
                handler=handler,
            )
        )

    def _register_list_pod_files(self):
        def handler() -> ToolResult:
            files = [f.name for f in v3.POD_FOLDER.iterdir() if f.is_file() and not f.name.startswith(".")]
            return ToolResult(True, f"Found {len(files)} POD files waiting.", {"files": files, "count": len(files)})

        self.register(
            ToolDefinition(
                name="list_pod_files",
                description="List files in the POD folder.",
                parameters={"type": "object", "properties": {}},
                handler=handler,
            )
        )

    def _register_reset_statuses(self):
        def handler(status_filter: str = "") -> ToolResult:
            path = v3.DEFAULT_EXCEL_PATH
            wb = __import__("openpyxl").load_workbook(path)
            ws = wb.active
            count = 0
            for row in range(2, ws.max_row + 1):
                if not ws.cell(row, 1).value:
                    continue
                status = str(ws.cell(row, 5).value or "").strip()
                if not status_filter or status_filter.upper() in status.upper():
                    ws.cell(row, 5, value=None)
                    count += 1
            wb.save(path)
            wb.close()
            return ToolResult(True, f"Reset {count} statuses.", {"reset_count": count})

        self.register(
            ToolDefinition(
                name="reset_statuses",
                description="Clear the status column in Excel.",
                parameters={"type": "object", "properties": {"status_filter": {"type": "string"}}},
                handler=handler,
                requires_confirmation=True,
            )
        )

    def _register_cleanup_no_date(self):
        def handler() -> ToolResult:
            path = v3.DEFAULT_EXCEL_PATH
            wb = __import__("openpyxl").load_workbook(path)
            ws = wb.active
            to_delete = []
            for row in range(2, ws.max_row + 1):
                if not ws.cell(row, 1).value:
                    continue
                if not ws.cell(row, 3).value and "VERIFIED" not in str(ws.cell(row, 5).value or "").upper():
                    to_delete.append(row)
            for row in reversed(to_delete):
                ws.delete_rows(row)
            wb.save(path)
            wb.close()
            return ToolResult(True, f"Removed {len(to_delete)} rows without delivery date.", {"removed_rows": len(to_delete)})

        self.register(
            ToolDefinition(
                name="cleanup_no_date",
                description="Remove rows missing dates.",
                parameters={"type": "object", "properties": {}},
                handler=handler,
                requires_confirmation=True,
            )
        )

    def _register_feed_data(self):
        def handler(
            dry_run: bool = False,
            run_portal: bool = True,
            run_courier: bool = True,
        ) -> ToolResult:
            import importlib
            import data_feeder

            if not run_portal and not run_courier:
                return ToolResult(False, "Data Feeder ke liye kam se kam ek phase select karna padega.")

            data_feeder = importlib.reload(data_feeder)
            summary = data_feeder.run_etl(
                run_portal=run_portal,
                run_courier=run_courier,
                dry_run=dry_run,
            )

            if run_portal and run_courier:
                phase_label = "Phase 1 + Phase 2"
            elif run_portal:
                phase_label = "Phase 1"
            else:
                phase_label = "Phase 2"

            mode_label = "preview complete" if dry_run else "run complete"
            success = bool(summary.get("success", False))

            errors = []
            for phase_name, phase_result in summary.get("phases", {}).items():
                if phase_result.get("success") is False:
                    errors.append(f"{phase_name}: {phase_result.get('error', 'unknown error')}")

            if not success:
                return ToolResult(
                    False,
                    f"Data Feeder {phase_label} failed. " + " | ".join(errors),
                    summary,
                )

            return ToolResult(
                True,
                f"Data Feeder {phase_label} {mode_label}.",
                {
                    **summary,
                    "dry_run": dry_run,
                    "run_portal": run_portal,
                    "run_courier": run_courier,
                },
            )

        self.register(
            ToolDefinition(
                name="feed_data",
                description=(
                    "Run Data Feeder ETL. Phase 1 reads Order-wise.csv + Google Sheet to populate "
                    "Filflo_Tasks.xlsx. Phase 2 reads courier trackers to populate Data.xlsx."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "dry_run": {"type": "boolean"},
                        "run_portal": {
                            "type": "boolean",
                            "description": "Run only Phase 1 portal ETL when true and run_courier is false.",
                        },
                        "run_courier": {
                            "type": "boolean",
                            "description": "Run only Phase 2 courier ETL when true and run_portal is false.",
                        },
                    },
                },
                handler=handler,
                requires_confirmation=True,
            )
        )

    def _register_feed_pod_data(self):
        def handler(dry_run: bool = False) -> ToolResult:
            from pod_feeder import run_pod_feeder

            summary = run_pod_feeder(
                v3.POD_FOLDER,
                v3.DOWNLOAD_FOLDER / "Order-wise.csv",
                v3.DEFAULT_EXCEL_PATH,
                dry_run,
                self.logger,
            )
            return ToolResult(True, f"POD Feeder: {summary.get('added', 0)} added.", summary)

        self.register(
            ToolDefinition(
                name="feed_pod_data",
                description="Scan POD folder to create tasks.",
                parameters={"type": "object", "properties": {"dry_run": {"type": "boolean"}}},
                handler=handler,
                requires_confirmation=True,
            )
        )

    def _register_grn_email_processor(self):
        def handler(dry_run: bool = False) -> ToolResult:
            from scootsy_DN_updation import process_emails

            count = process_emails(dry_run=dry_run)
            return ToolResult(True, f"Processed {count} GRN emails.", {"processed": count})

        self.register(
            ToolDefinition(
                name="process_grn_emails",
                description="Process Purchase Return emails.",
                parameters={"type": "object", "properties": {"dry_run": {"type": "boolean"}}},
                handler=handler,
                requires_confirmation=True,
            )
        )

    def _register_process_multi_agent(self):
        def handler(workers: int = 3, dry_run: bool = False) -> ToolResult:
            import multi_agent_runner as mar

            summary = mar.run_multi_agent(v3.DEFAULT_EXCEL_PATH, workers, dry_run)
            success = summary.get("failed", 0) == 0
            return ToolResult(success, f"Multi-Agent: {summary.get('verified', 0)} verified.", summary)

        self.register(
            ToolDefinition(
                name="process_multi_agent",
                description="Fast parallel processing.",
                parameters={
                    "type": "object",
                    "properties": {
                        "workers": {"type": "integer"},
                        "dry_run": {"type": "boolean"},
                    },
                },
                handler=handler,
                requires_confirmation=True,
            )
        )

    def _register_download_report(self):
        def handler(recipient_email: str = "") -> ToolResult:
            email = recipient_email.strip() if recipient_email else ""
            success = v3.do_download_order_dump(self.logger, recipient_email=email or None)
            sheet_count = len(v3.get_google_sheet_targets())
            if success:
                target = email or "default recipients"
                return ToolResult(
                    True,
                    f"Order-wise report downloaded, emailed to {target}, and imported into {sheet_count} configured Google Sheet(s).",
                )
            return ToolResult(False, "Download, email, or Google Sheet import failed. Check logs for details.")

        self.register(
            ToolDefinition(
                name="download_report",
                description=(
                    "Download the Order-wise report CSV from the Filflo portal, email it, "
                    "and import it into the configured Google Sheets."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "recipient_email": {
                            "type": "string",
                            "description": "Email address to send the report to. Leave empty for default.",
                        }
                    },
                    "required": [],
                },
                handler=handler,
                requires_confirmation=True,
            )
        )

    def _register_import_downloaded_report(self):
        def handler(file_path: str = "") -> ToolResult:
            target_file = Path(file_path).expanduser() if file_path else v3.find_latest_downloaded_report(self.logger)
            if not target_file:
                return ToolResult(False, "No downloaded Order-wise CSV found to import.")
            if not target_file.exists():
                return ToolResult(False, f"Report file not found: {target_file}")

            success = v3.sync_csv_to_google_sheet(target_file, self.logger)
            sheet_count = len(v3.get_google_sheet_targets())
            if success:
                return ToolResult(
                    True,
                    f"Report {target_file.name} imported into {sheet_count} configured Google Sheet(s).",
                    {"file_path": str(target_file), "sheet_count": sheet_count},
                )
            return ToolResult(False, f"Google Sheet import failed for {target_file.name}. Check logs for details.")

        self.register(
            ToolDefinition(
                name="import_downloaded_report",
                description=(
                    "Import the latest downloaded Order-wise CSV, or a specific CSV path, "
                    "into the configured Google Sheets without downloading it again."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "file_path": {
                            "type": "string",
                            "description": "Optional full CSV path. Leave empty to use the latest downloaded Order-wise file.",
                        }
                    },
                    "required": [],
                },
                handler=handler,
                requires_confirmation=True,
            )
        )

    def _register_get_monitor_dashboard(self):
        def handler() -> ToolResult:
            monitor = self._get_monitor()
            return ToolResult(True, monitor.dashboard(), monitor.get_stats_dict())

        self.register(
            ToolDefinition(
                name="get_monitor_dashboard",
                description="Show the bot monitoring dashboard.",
                parameters={"type": "object", "properties": {}},
                handler=handler,
            )
        )

    def _register_reset_monitor_stats(self):
        def handler() -> ToolResult:
            monitor = self._get_monitor()
            monitor.reset()
            return ToolResult(True, "Monitor stats reset.")

        self.register(
            ToolDefinition(
                name="reset_monitor_stats",
                description="Reset persisted monitor statistics.",
                parameters={"type": "object", "properties": {}},
                handler=handler,
                requires_confirmation=True,
            )
        )

    def _register_run_blinkit_booker(self):
        def handler(excel_path: str = "") -> ToolResult:
            import blinkit_appointment_booker as blinkit

            normalized = self.normalize_arguments("run_blinkit_booker", {"excel_path": excel_path})
            summary = blinkit.run_booking(normalized.get("excel_path") or None)
            return ToolResult(bool(summary.get("success")), summary.get("message", "Blinkit run finished."), summary)

        self.register(
            ToolDefinition(
                name="run_blinkit_booker",
                description=(
                    "Run the Blinkit PartnersBiz appointment booking bot. "
                    "If excel_path is omitted, use the configured default workbook automatically. "
                    "Requires Chrome remote debugging login to PartnersBiz."
                ),
                parameters={"type": "object", "properties": {"excel_path": {"type": "string"}}},
                handler=handler,
                requires_confirmation=True,
            )
        )

    def _register_cleanup_scootsy_sheet(self):
        def handler() -> ToolResult:
            import cleanup_sheet

            summary = cleanup_sheet.cleanup_scootsy_sheet()
            message = (
                f"Scootsy sheet cleaned. Updated {summary['updated_subjects']} subjects "
                f"and deleted {summary['deleted_duplicates']} duplicates in '{summary['sheet_title']}'."
            )
            return ToolResult(True, message, summary)

        self.register(
            ToolDefinition(
                name="cleanup_scootsy_sheet",
                description="Clean the Scootsy return sheet by fixing prefixes and removing duplicates.",
                parameters={"type": "object", "properties": {}},
                handler=handler,
                requires_confirmation=True,
            )
        )

    def _register_create_sample_excel(self):
        def handler(output_path: str = "", overwrite: bool = False) -> ToolResult:
            import create_sample_excel as sample_excel

            created_path = sample_excel.create_sample_excel(output_path or None, overwrite=overwrite)
            return ToolResult(True, f"Sample Excel created at {created_path}.", {"path": str(created_path)})

        self.register(
            ToolDefinition(
                name="create_sample_excel",
                description="Create a sample Filflo tasks workbook with the expected headers.",
                parameters={
                    "type": "object",
                    "properties": {
                        "output_path": {"type": "string"},
                        "overwrite": {"type": "boolean"},
                    },
                },
                handler=handler,
                requires_confirmation=True,
            )
        )

    def _register_patch_v3_bot(self):
        def handler() -> ToolResult:
            import patch_bot_v3

            summary = patch_bot_v3.apply_patch_bot()
            message = (
                f"filflo_combined_bot_v3.py updated from backup source. "
                f"Lines in new file: {summary['line_count']}."
            )
            return ToolResult(True, message, summary)

        self.register(
            ToolDefinition(
                name="patch_v3_bot",
                description="Restore or replace filflo_combined_bot_v3.py using the saved patched backup.",
                parameters={"type": "object", "properties": {}},
                handler=handler,
                requires_confirmation=True,
            )
        )

    def shutdown(self):
        self._close_driver()
        self.logger.info("[ToolRegistry] Shutdown complete.")
