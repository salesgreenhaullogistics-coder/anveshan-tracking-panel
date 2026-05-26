"""
Filflo Chat - main conversational interface.
Run with: python filflo_chat.py
"""

import argparse
import json
import os
import re
import signal
import sys
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

BOT_DIR = Path(__file__).parent.resolve()
if str(BOT_DIR) not in sys.path:
    sys.path.insert(0, str(BOT_DIR))

from llm_engine import LLMEngine, LLMResponse
from tool_registry import ToolRegistry
import filflo_combined_bot_v3 as v3
from filflo_monitor_bus import emit_monitor_event


class C:
    """ANSI color codes for pretty terminal output."""

    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    CYAN = "\033[96m"
    RED = "\033[91m"
    MAGENTA = "\033[95m"
    BLUE = "\033[94m"


@dataclass
class PlannedCommand:
    raw_text: str
    tool_name: str
    args: dict
    mode: str
    requires_confirmation: bool


BANNER = f"""{C.CYAN}{C.BOLD}
+--------------------------------------------------------------+
|                  Filflo Bot Chat Interface                   |
|                                                              |
|  Hindi / English dono chalega                                |
|  Type 'quit' to exit | 'help' for commands                   |
+--------------------------------------------------------------+
{C.RESET}"""


HELP_TEXT = f"""
{C.YELLOW}Available Commands:{C.RESET}
  {C.GREEN}help{C.RESET}              - Show this help
  {C.GREEN}status{C.RESET}            - Quick status summary
  {C.GREEN}pending{C.RESET}           - Show pending PO count
  {C.GREEN}logs{C.RESET}              - Today's log summary
  {C.GREEN}pods{C.RESET}              - List POD files
  {C.GREEN}download report{C.RESET}   - Download report, mail it, and import it to configured Google Sheets
  {C.GREEN}import report{C.RESET}     - Import already-downloaded report into configured Google Sheets
  {C.GREEN}feed data{C.RESET}         - Run Data Feeder
  {C.GREEN}feed data phase 1{C.RESET} - Run Data Feeder Phase 1 only
  {C.GREEN}feed data phase 2{C.RESET} - Run Data Feeder Phase 2 only
  {C.GREEN}feed data dry{C.RESET}     - Preview Data Feeder
  {C.GREEN}feed data phase 1 dry{C.RESET} - Preview Data Feeder Phase 1 only
  {C.GREEN}feed data phase 2 dry{C.RESET} - Preview Data Feeder Phase 2 only
  {C.GREEN}pod feed{C.RESET}          - Run POD Feeder
  {C.GREEN}pod feed dry{C.RESET}      - Preview POD Feeder
  {C.GREEN}instamart fetch{C.RESET}   - Fetch pending Instamart rows into Data.xlsx
  {C.GREEN}instamart fetch dry{C.RESET} - Preview Instamart fetch
  {C.GREEN}instamart book{C.RESET}    - Run isolated Instamart booking bot
  {C.GREEN}instamart otp 123456{C.RESET} - Submit OTP to a waiting Slack/Instamart run
  {C.GREEN}instamart push{C.RESET}    - Push booked Instamart rows back to Google Sheets
  {C.GREEN}instamart push dry{C.RESET} - Preview Instamart push
  {C.GREEN}monitor{C.RESET}           - Show monitor dashboard
  {C.GREEN}monitor reset{C.RESET}     - Reset monitor stats
  {C.GREEN}blinkit run{C.RESET}       - Run Blinkit appointment bot
  {C.GREEN}cleanup scootsy{C.RESET}   - Clean Scootsy return sheet
  {C.GREEN}sample excel{C.RESET}      - Create sample Excel workbook
  {C.GREEN}patch v3{C.RESET}          - Restore filflo_combined_bot_v3 from backup patch
  {C.GREEN}grn emails{C.RESET}        - Process Scootsy GRN emails
  {C.GREEN}grn emails dry{C.RESET}    - Preview Scootsy GRN email processing
  {C.GREEN}multi agent{C.RESET}       - Run parallel Filflo processing
  {C.GREEN}push sheets{C.RESET}       - Push Data.xlsx updates to Google Sheets
  {C.GREEN}feed data phase 1 | pod feed | status{C.RESET} - Run multiple commands in sequence
  {C.GREEN}feed data phase 1 and then status{C.RESET} - Natural-language multi-command sequence
  {C.GREEN}quit{C.RESET}              - Exit the chat

{C.YELLOW}Natural language examples:{C.RESET}
  {C.DIM}"Bot chalao"
  "PO 8502340958 ka status batao"
  "Report download karo"
  "Nandlal ko report mail karo"
  "Report download karke sheets me import karo"
  "Already downloaded report ko sheets me import karo"
  "Blinkit appointment bot chalao"
  "Instamart OTP 123456"
  "Instamart fetch and then instamart book and then instamart push"
  "Scootsy sheet cleanup karo"
  "Sample Excel bana do"{C.RESET}
"""


class FilfloChat:
    """
    Main conversational loop.
    Connects the LLM engine, tool registry, and Selenium workflows.
    """

    def __init__(self):
        self.logger = v3.setup_logging(v3.LOG_DIR)
        self.logger.info("=" * 60)
        self.logger.info("[FilfloChat] Starting conversational interface...")

        self.registry = ToolRegistry(logger=self.logger)
        self.llm = LLMEngine(
            tool_schemas=self.registry.to_openai_tools(),
            logger=self.logger,
        )

        self._running = True
        self._processing_lock = threading.Lock()

    READ_ONLY_TOOLS = {
        "get_status_summary",
        "get_po_status",
        "get_pending_count",
        "get_todays_log_summary",
        "list_pod_files",
        "get_monitor_dashboard",
    }
    PREPARE_TOOLS = {"feed_data", "feed_pod_data", "process_grn_emails", "fetch_instamart"}
    REPORT_TOOLS = {"download_report", "import_downloaded_report", "push_to_gsheet", "push_instamart"}
    PORTAL_WRITE_TOOLS = {
        "process_pending",
        "process_single_po",
        "process_multi_agent",
        "run_blinkit_booker",
        "book_instamart",
    }
    MAINTENANCE_TOOLS = {
        "reset_statuses",
        "cleanup_no_date",
        "reset_monitor_stats",
        "cleanup_scootsy_sheet",
        "patch_v3_bot",
        "create_sample_excel",
    }
    BATCH_SPLIT_RE = re.compile(r"\s*(?:\|\s*|,\s+|\band then\b|\bthen\b|\bphir\b)\s*", re.IGNORECASE)

    def _tool_mode(self, tool_name: str) -> str:
        if tool_name in self.READ_ONLY_TOOLS:
            return "read_only"
        if tool_name in self.PREPARE_TOOLS:
            return "prepare"
        if tool_name in self.REPORT_TOOLS:
            return "report"
        if tool_name in self.PORTAL_WRITE_TOOLS:
            return "portal_write"
        if tool_name in self.MAINTENANCE_TOOLS:
            return "maintenance"
        return "other"

    def _format_tool_call(self, tool_name: str, args: dict) -> str:
        if not args:
            return tool_name
        arg_text = ", ".join(f"{k}={v}" for k, v in args.items())
        return f"{tool_name}({arg_text})"

    def _split_batch_input(self, text: str) -> list[str]:
        segments = [part.strip() for part in self.BATCH_SPLIT_RE.split(text.strip()) if part.strip()]
        return segments

    def _looks_like_batch_request(self, text: str) -> bool:
        return len(self._split_batch_input(text)) > 1

    def _resolve_quick_tool(self, lower: str) -> tuple[str, dict] | None:
        otp_match = re.match(
            r"^\s*(?:instamart\s+)?otp(?:\s+is)?\s*[:\-]?\s*(\d{4,8})\s*$",
            lower,
            re.IGNORECASE,
        )
        if otp_match:
            return "submit_instamart_otp", {"otp": otp_match.group(1)}

        if lower in ("status", "summary"):
            return "get_status_summary", {}

        if lower in ("pending", "kitne pending"):
            return "get_pending_count", {}

        if lower in ("logs", "log", "aaj ka log"):
            return "get_todays_log_summary", {}

        if lower in ("pods", "pod files", "pod folder"):
            return "list_pod_files", {}

        if lower in ("download report", "report download", "report mail", "download and mail", "download report and mail"):
            return "download_report", {}

        if lower in ("import report", "report import", "import downloaded report", "sync downloaded report", "report ko sheets me import karo"):
            return "import_downloaded_report", {}

        if lower in ("process pending", "process all pending", "run pending", "bot chalao", "sare pending process karo"):
            return "process_pending", {}

        if lower in ("feed data", "data feed", "data feed karo", "etl chalao", "delivery data feed"):
            return "feed_data", {}

        if lower in (
            "feed data phase 1",
            "data feeder phase 1",
            "data feed phase 1",
            "phase 1 data feed",
            "phase 1 feeder",
        ):
            return "feed_data", {"run_portal": True, "run_courier": False}

        if lower in (
            "feed data phase 2",
            "data feeder phase 2",
            "data feed phase 2",
            "phase 2 data feed",
            "phase 2 feeder",
        ):
            return "feed_data", {"run_portal": False, "run_courier": True}

        if lower in ("feed data dry", "data feed dry", "data feed preview", "feed data dry run"):
            return "feed_data", {"dry_run": True}

        if lower in (
            "feed data phase 1 dry",
            "data feeder phase 1 dry",
            "data feed phase 1 dry",
            "phase 1 data feed dry",
            "feed data phase 1 preview",
        ):
            return "feed_data", {"dry_run": True, "run_portal": True, "run_courier": False}

        if lower in (
            "feed data phase 2 dry",
            "data feeder phase 2 dry",
            "data feed phase 2 dry",
            "phase 2 data feed dry",
            "feed data phase 2 preview",
        ):
            return "feed_data", {"dry_run": True, "run_portal": False, "run_courier": True}

        if lower in ("pod feed", "pod data feed", "pod feed karo", "feed pod", "pod feeder", "pod upload feed"):
            return "feed_pod_data", {}

        if lower in ("pod feed dry", "pod data feed dry", "pod feed preview", "pod feeder dry"):
            return "feed_pod_data", {"dry_run": True}

        if lower in ("instamart fetch", "fetch instamart", "instamart feed", "fetch instamart data"):
            return "fetch_instamart", {}

        if lower in (
            "instamart fetch dry",
            "fetch instamart dry",
            "instamart fetch preview",
            "instamart feed dry",
        ):
            return "fetch_instamart", {"dry_run": True}

        if lower in (
            "instamart book",
            "book instamart",
            "instamart booking",
            "instamart appointments",
        ):
            return "book_instamart", {}

        if lower in ("instamart push", "push instamart", "instamart sync back"):
            return "push_instamart", {}

        if lower in (
            "instamart push dry",
            "push instamart dry",
            "instamart push preview",
        ):
            return "push_instamart", {"dry_run": True}

        if lower in ("monitor", "dashboard", "monitor dashboard"):
            return "get_monitor_dashboard", {}

        if lower in ("monitor reset", "reset monitor"):
            return "reset_monitor_stats", {}

        if lower in (
            "blinkit run",
            "blinkit",
            "blinkit bot",
            "blinkit appointments",
            "blinkit appointment bot",
            "blinkit appointment bot chalao",
            "blinkit appointment booker",
            "blinkit appointment booker bot",
            "blinkit appointment booker chalao",
            "blinkit appointment booker bot chalao",
            "run blinkit appointment bot",
            "run blinkit appointment booker",
            "run blinkit appointment booker bot",
            "book blinkit appointments",
            "book blinkit slots",
            "blinkit partnersbiz",
            "partnersbiz booking",
        ):
            return "run_blinkit_booker", {}

        if lower in ("cleanup scootsy", "scootsy cleanup", "cleanup return sheet"):
            return "cleanup_scootsy_sheet", {}

        if lower in ("sample excel", "create sample excel"):
            return "create_sample_excel", {}

        if lower in ("patch v3", "restore v3", "repair v3"):
            return "patch_v3_bot", {}

        if lower in ("grn emails", "process grn emails"):
            return "process_grn_emails", {}

        if lower in ("grn emails dry", "process grn emails dry"):
            return "process_grn_emails", {"dry_run": True}

        if lower in ("multi agent", "parallel run"):
            return "process_multi_agent", {}

        if lower in ("push sheets", "data push", "sync sheets"):
            return "push_to_gsheet", {}

        return None

    def _plan_from_text(self, text: str) -> PlannedCommand | None:
        lower = text.strip().lower()
        quick = self._resolve_quick_tool(lower)
        if quick:
            tool_name, args = quick
            tool = self.registry.get(tool_name)
            return PlannedCommand(
                raw_text=text,
                tool_name=tool_name,
                args=args,
                mode=self._tool_mode(tool_name),
                requires_confirmation=bool(tool and tool.requires_confirmation),
            )

        snapshot = list(self.llm.conversation_history)
        try:
            response = self.llm.chat(text)
        finally:
            self.llm.conversation_history = snapshot

        if len(response.tool_calls) != 1:
            return None

        tool_call = response.tool_calls[0]
        tool_name = tool_call["name"]
        args = self.registry.normalize_arguments(tool_name, tool_call["arguments"])
        tool = self.registry.get(tool_name)
        if not tool:
            return None

        return PlannedCommand(
            raw_text=text,
            tool_name=tool_name,
            args=args,
            mode=self._tool_mode(tool_name),
            requires_confirmation=tool.requires_confirmation,
        )

    def _validate_batch_plan(self, plan: list[PlannedCommand]) -> list[str]:
        issues: list[str] = []
        if len(plan) > 5:
            issues.append("Ek batch me maximum 5 commands allowed hain.")

        names = [step.tool_name for step in plan]
        portal_count = sum(1 for step in plan if step.mode == "portal_write")
        if portal_count > 1:
            issues.append("Batch me ek se zyada portal-write command allow nahi hai.")

        if "download_report" in names and "import_downloaded_report" in names:
            issues.append("`download report` ke saath `import report` mat chalaiye; download flow me import already included hai.")

        if "process_pending" in names and "process_single_po" in names:
            issues.append("`process pending` aur `process single po` ek hi batch me saath allow nahi hain.")

        if "process_multi_agent" in names and len([step for step in plan if step.mode != "read_only"]) > 1:
            issues.append("`multi agent` ko doosre mutating command ke saath batch me mix nahi kar sakte.")

        first_portal_idx = next((idx for idx, step in enumerate(plan) if step.mode == "portal_write"), None)
        if first_portal_idx is not None:
            portal_step = plan[first_portal_idx]
            for later_step in plan[first_portal_idx + 1 :]:
                if later_step.mode == "read_only":
                    continue

                # Instamart's safe pipeline is fetch -> book -> push, so allow the
                # dedicated Python push step immediately after the isolated booker.
                if (
                    portal_step.tool_name == "book_instamart"
                    and later_step.tool_name == "push_instamart"
                ):
                    portal_step = later_step
                    continue

                issues.append("Portal-write command ke baad sirf read-only commands allow hain.")
                break

        first_maintenance_idx = next((idx for idx, step in enumerate(plan) if step.mode == "maintenance"), None)
        if first_maintenance_idx is not None:
            for later_step in plan[first_maintenance_idx + 1 :]:
                if later_step.mode != "read_only":
                    issues.append("Maintenance command ke baad sirf read-only commands allow hain.")
                    break

        return issues

    def describe_plan(self, plan: list[PlannedCommand]) -> str:
        lines = ["Plan:"]
        for idx, step in enumerate(plan, start=1):
            lines.append(f"{idx}. {self._format_tool_call(step.tool_name, step.args)}")
        lines.append("")
        lines.append("Safety checks:")
        lines.append("- execution mode: sequential")
        lines.append("- failure policy: continue next safe step")
        lines.append("- portal-write guard: enabled")
        lines.append(f"- commands in batch: {len(plan)}/5")
        return "\n".join(lines)

    def plan_message(self, text: str) -> tuple[list[PlannedCommand] | None, str | None]:
        lower = text.strip().lower()
        if lower in ("help", "?", "madad"):
            return None, HELP_TEXT

        parts = self._split_batch_input(text)
        if len(parts) > 1:
            plan: list[PlannedCommand] = []
            unresolved: list[str] = []
            for part in parts:
                planned = self._plan_from_text(part)
                if planned is None:
                    unresolved.append(part)
                else:
                    plan.append(planned)

            if unresolved:
                unresolved_text = "\n".join(f"- {item}" for item in unresolved)
                return None, f"In command parts ko safely samajh nahi paya:\n{unresolved_text}"
            return plan, None

        resolved = self._resolve_quick_tool(lower)
        if resolved:
            tool_name, args = resolved
            tool = self.registry.get(tool_name)
            if not tool:
                return None, f"Unknown tool: {tool_name}"
            return [
                PlannedCommand(
                    raw_text=text,
                    tool_name=tool_name,
                    args=args,
                    mode=self._tool_mode(tool_name),
                    requires_confirmation=tool.requires_confirmation,
                )
            ], None

        snapshot = list(self.llm.conversation_history)
        try:
            response = self.llm.chat(text)
        finally:
            self.llm.conversation_history = snapshot

        if not response.tool_calls:
            return None, response.content or "(No response)"

        plan: list[PlannedCommand] = []
        for tool_call in response.tool_calls:
            tool_name = tool_call["name"]
            args = self.registry.normalize_arguments(tool_name, tool_call["arguments"])
            tool = self.registry.get(tool_name)
            if not tool:
                return None, f"Unknown tool: {tool_name}"
            plan.append(
                PlannedCommand(
                    raw_text=text,
                    tool_name=tool_name,
                    args=args,
                    mode=self._tool_mode(tool_name),
                    requires_confirmation=tool.requires_confirmation,
                )
            )
        return plan, None

    def execute_plan(
        self,
        plan: list[PlannedCommand],
        *,
        progress_callback: Callable[[str], None] | None = None,
    ) -> str:
        issues = self._validate_batch_plan(plan)
        if issues:
            issue_text = "\n".join(f"- {issue}" for issue in issues)
            emit_monitor_event(
                "chat",
                "Batch rejected: " + " | ".join(issues),
                level="WARNING",
                event_type="batch_rejected",
                data={"issues": issues},
            )
            return f"Batch reject kiya gaya:\n{issue_text}"

        emit_monitor_event(
            "chat",
            f"Starting batch with {len(plan)} step(s).",
            event_type="batch_start",
            data={
                "steps": [
                    {"tool_name": step.tool_name, "args": step.args, "mode": step.mode}
                    for step in plan
                ]
            },
        )
        results: list[str] = []
        mutation_failed = False

        with self._processing_lock:
            for idx, step in enumerate(plan, start=1):
                display = self._format_tool_call(step.tool_name, step.args)
                if mutation_failed and step.mode != "read_only":
                    msg = f"{idx}. SKIP {display} -> previous mutating step failed"
                    results.append(msg)
                    if progress_callback:
                        progress_callback(msg)
                    continue

                if progress_callback:
                    progress_callback(f"Step {idx}/{len(plan)} running: {display}")

                result = self.registry.execute(
                    step.tool_name,
                    step.args,
                    progress_callback=progress_callback,
                )
                status = "OK" if result.success else "FAIL"
                line = f"{idx}. {status} {display} -> {result.message}"
                results.append(line)
                if progress_callback:
                    progress_callback(line)

                if not result.success and step.mode != "read_only":
                    mutation_failed = True

        header = "Batch complete." if not mutation_failed else "Batch complete with guarded skips."
        emit_monitor_event(
            "chat",
            header,
            level="WARNING" if mutation_failed else "INFO",
            event_type="batch_complete",
            data={"mutation_failed": mutation_failed, "result_count": len(results)},
        )
        return header + "\n" + "\n".join(results)

    def _confirm_batch(self, plan: list[PlannedCommand]) -> bool:
        print(f"\n{C.YELLOW}Batch Plan:{C.RESET}")
        for idx, step in enumerate(plan, start=1):
            print(f"  {idx}. {self._format_tool_call(step.tool_name, step.args)}")

        print(f"\n{C.YELLOW}Safety Checks:{C.RESET}")
        print("  - Execution mode: sequential")
        print("  - Failure policy: continue next safe step")
        print("  - Portal-write guard: enabled")
        print(f"  - Commands in batch: {len(plan)}/5")
        print(f"\n{C.YELLOW}Kya poora batch confirm karte ho? (y/n){C.RESET}")

        try:
            choice = input(f"{C.MAGENTA}Confirm Batch > {C.RESET}").strip().lower()
            return choice in ("y", "yes", "ha", "haan", "han", "ok", "theek", "thik")
        except (EOFError, KeyboardInterrupt):
            return False

    def _execute_batch(self, plan: list[PlannedCommand]) -> str:
        issues = self._validate_batch_plan(plan)
        if issues:
            issue_text = "\n".join(f"- {issue}" for issue in issues)
            return f"Batch reject kiya gaya:\n{issue_text}"

        if not self._confirm_batch(plan):
            return "Batch cancelled."

        def emit_progress(message: str) -> None:
            if message.startswith("Step "):
                print(f"\n{C.BLUE}{message}{C.RESET}")
                print(f"{C.DIM}Executing...{C.RESET}")
                return
            if ". OK " in message:
                print(f"   {C.GREEN}{message.split(' -> ', 1)[-1]}{C.RESET}")
                return
            if ". FAIL " in message or ". SKIP " in message:
                print(f"   {C.RED}{message.split(' -> ', 1)[-1]}{C.RESET}")
                return
            print(f"   {C.CYAN}{message}{C.RESET}")

        return self.execute_plan(plan, progress_callback=emit_progress)

    def _handle_batch_request(self, text: str) -> str | None:
        parts = self._split_batch_input(text)
        if len(parts) <= 1:
            return None

        plan, error = self.plan_message(text)
        if error:
            return error
        if not plan:
            return None
        return self._execute_batch(plan)

    def _handle_quick_command(self, text: str) -> str | None:
        """Handle simple commands directly without an LLM call."""
        lower = text.strip().lower()

        if lower in ("help", "?", "madad"):
            return HELP_TEXT

        resolved = self._resolve_quick_tool(lower)
        if resolved:
            tool_name, args = resolved
            if args.get("dry_run"):
                with self._processing_lock:
                    return self.registry.execute(tool_name, args).message
            return self._run_tool_with_confirm(tool_name, args)

        return None

    def _confirm_action(self, tool_name: str, args: dict) -> bool:
        """Ask the user to confirm before running a destructive tool."""
        tool = self.registry.get(tool_name)
        if not tool or not tool.requires_confirmation:
            return True

        args_str = ", ".join(f"{k}={v}" for k, v in args.items()) if args else "default settings"
        print(f"\n{C.YELLOW}Action: {tool_name}({args_str}){C.RESET}")
        print(f"{C.YELLOW}Kya confirm karte ho? (y/n){C.RESET}")

        try:
            choice = input(f"{C.MAGENTA}Confirm > {C.RESET}").strip().lower()
            return choice in ("y", "yes", "ha", "haan", "han", "ok", "theek", "thik")
        except (EOFError, KeyboardInterrupt):
            return False

    def _run_tool_with_confirm(self, tool_name: str, args: dict) -> str:
        """Execute a tool directly with confirmation prompt."""
        if not self._confirm_action(tool_name, args):
            return "Action cancelled."

        with self._processing_lock:
            result = self.registry.execute(tool_name, args)
        status = "OK" if result.success else "FAIL"
        return f"{status} {result.message}"

    def _process_llm_response(self, response: LLMResponse) -> str:
        """Handle the LLM response and execute any tool calls."""
        if not response.tool_calls:
            return response.content or "(No response)"

        final_reply = response.content or ""

        for tool_call in response.tool_calls:
            tool_name = tool_call["name"]
            tool_args = tool_call["arguments"]
            tool_id = tool_call.get("id", "unknown")

            print(f"\n{C.BLUE}Tool: {tool_name}{C.RESET}")
            if tool_args:
                print(f"{C.DIM}Args: {json.dumps(tool_args, ensure_ascii=False)}{C.RESET}")

            if not self._confirm_action(tool_name, tool_args):
                cancel_msg = f"User cancelled the action '{tool_name}'."
                follow_up = self.llm.feed_tool_result(tool_id, tool_name, cancel_msg)
                return follow_up.content or "Action cancelled."

            print(f"{C.DIM}Executing...{C.RESET}")
            with self._processing_lock:
                result = self.registry.execute(tool_name, tool_args)

            status_icon = f"{C.GREEN}OK" if result.success else f"{C.RED}FAIL"
            print(
                f"   {status_icon} {result.message[:100]}{C.RESET}"
                if len(result.message) > 100
                else f"   {status_icon} {result.message}{C.RESET}"
            )

            follow_up = self.llm.feed_tool_result(tool_id, tool_name, result.message)
            if follow_up.tool_calls:
                return self._process_llm_response(follow_up)

            final_reply = follow_up.content or result.message

        return final_reply

    def run(self):
        """Start the interactive chat loop."""
        print(BANNER)
        print(f"{C.DIM}LLM Backend: {self.llm.backend} | Model: {self.llm.model}{C.RESET}")
        print(f"{C.DIM}Excel: {v3.DEFAULT_EXCEL_PATH}{C.RESET}")
        print(f"{C.DIM}POD Folder: {v3.POD_FOLDER}{C.RESET}")
        print()

        while self._running:
            try:
                user_input = input(f"{C.GREEN}{C.BOLD}You > {C.RESET}").strip()
            except (EOFError, KeyboardInterrupt):
                print(f"\n{C.YELLOW}Bye!{C.RESET}")
                break

            if not user_input:
                continue

            if user_input.lower() in ("quit", "exit", "bye", "q", "band karo"):
                print(f"{C.YELLOW}Filflo Bot shutting down. Bye!{C.RESET}")
                break

            batch_reply = self._handle_batch_request(user_input)
            if batch_reply:
                print(f"\n{C.CYAN}Bot > {C.RESET}{batch_reply}")
                continue

            quick = self._handle_quick_command(user_input)
            if quick:
                print(f"\n{C.CYAN}Bot > {C.RESET}{quick}")
                continue

            try:
                print(f"{C.DIM}Thinking...{C.RESET}")
                response = self.llm.chat(user_input)
                reply = self._process_llm_response(response)
                print(f"\n{C.CYAN}Bot > {C.RESET}{reply}")
            except Exception as exc:
                self.logger.error(f"[FilfloChat] Error: {exc}", exc_info=True)
                print(f"\n{C.RED}Bot > Error: {exc}{C.RESET}")

            self.llm.trim_history(max_turns=25)

        self.shutdown()

    def shutdown(self):
        self.registry.shutdown()
        self.logger.info("[FilfloChat] Session ended.")


def main():
    parser = argparse.ArgumentParser(description="Filflo Chat interface")
    parser.add_argument("--slack", action="store_true", help="Run the Slack bridge instead of terminal chat")
    args = parser.parse_args()

    signal.signal(signal.SIGINT, lambda _s, _f: sys.exit(0))

    if not os.environ.get("GROQ_API_KEY") and not os.environ.get("OPENAI_API_KEY"):
        print(
            f"""
{C.RED}{C.BOLD}ERROR: No API key found!{C.RESET}

Set one of these environment variables:

{C.GREEN}Option 1 - Groq (recommended):{C.RESET}
  PowerShell: {C.YELLOW}$env:GROQ_API_KEY="gsk_your_key_here"{C.RESET}

{C.GREEN}Option 2 - OpenAI:{C.RESET}
  PowerShell: {C.YELLOW}$env:OPENAI_API_KEY="sk-your_key_here"{C.RESET}
  PowerShell: {C.YELLOW}$env:FILFLO_LLM_BACKEND="openai"{C.RESET}
"""
        )
        sys.exit(1)

    chat = FilfloChat()
    if args.slack:
        from filflo_slack_bridge import FilfloSlackBridge

        bridge = FilfloSlackBridge(chat, logger=chat.logger)
        try:
            bridge.run_forever()
        finally:
            chat.shutdown()
        return

    chat.run()


if __name__ == "__main__":
    main()
