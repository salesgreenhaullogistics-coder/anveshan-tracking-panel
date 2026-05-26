"""
╔══════════════════════════════════════════════════════════════════╗
║  LLM Engine — Intent Classification via Tool Calling            ║
║                                                                  ║
║  Supports TWO backends (user picks one via env var):            ║
║    1. Groq   (FREE, fast, uses llama-3.3-70b-versatile)        ║
║    2. OpenAI (GPT-4o-mini, needs paid key)                     ║
║                                                                  ║
║  The LLM sees the tool schemas and decides which tool to call   ║
║  based on the user's natural-language input (Hindi/English).    ║
╚══════════════════════════════════════════════════════════════════╝
"""

import os
import json
import logging
from typing import Optional
from dataclasses import dataclass, field

# We use the openai library for both OpenAI and Groq (Groq is OpenAI-compatible)
try:
    from openai import OpenAI
except ImportError:
    OpenAI = None

try:
    from groq import Groq
except ImportError:
    Groq = None


# ═══════════════════════════════════════════════════════════════════════════
#  SYSTEM PROMPT — the "brain" personality
# ═══════════════════════════════════════════════════════════════════════════

SYSTEM_PROMPT = """You are "Filflo Bot Assistant" — a bilingual (Hindi + English) AI assistant
for Anveshan Farm's logistics team. You manage a B2B order automation bot that runs on
the Filflo portal (anveshan.filflo.in).

Your capabilities (via tools):
1. Process pending orders (fill delivery dates, upload PODs)
2. Process a specific PO number
3. Download Order-wise report CSV, email it, and import it into the configured Google Sheets
4. Import an already-downloaded Order-wise report CSV into the configured Google Sheets
5. Check overall status summary from Excel
6. Check status of a specific PO
7. Get count of pending & ready entries
8. Read today's (or any date's) bot activity log
9. List POD files (waiting + uploaded)
10. Reset status entries in Excel
11. Feed Data (ETL) — read Order-wise.csv + Google Sheet, merge delivery dates, and auto-populate Filflo_Tasks.xlsx

IMPORTANT BEHAVIOR:
- Understand Hindi, Hinglish, and English naturally.
- When the user asks a question about data/status, use the appropriate read-only tool.
- When the user wants an ACTION (process, download, reset), use the action tool.
- For dangerous/destructive actions (process, reset, download), ALWAYS confirm with the user
  before executing by setting requires_confirmation in your response.
- If the user's intent is unclear, ask a clarifying question — do NOT guess a destructive action.
- Reply in the SAME language the user used (Hindi reply for Hindi input, English for English).
- Keep replies concise and friendly. Use relevant emojis sparingly.
- For optional file/path arguments like excel_path, never invent placeholder values.
- If the user did not give a real path, omit that argument and let the tool use its default file.
- If the user is just chatting or greeting, respond warmly without calling any tool.

EXAMPLES of intent mapping:
- "Nandlal ko report mail kar do" → download_report(recipient_email="nandlal@anveshan.farm")
- "Report download karo" → download_report()
- "Order-wise report bhejo" → download_report()
- "Report download karke sheets me import karo" → download_report()
- "Report download karke isko mail karo abc@xyz.com" → download_report(recipient_email="abc@xyz.com")
- "Already downloaded report ko sheets me import karo" → import_downloaded_report()
- "Latest report import karo" → import_downloaded_report()
- "Aaj kitne PODs upload hue?" → get_todays_log_summary()
- "PO 8502340958 ka status batao" → get_po_status(po_number="8502340958")
- "Bot chalao" → process_pending()
- "Kitne orders ready hain?" → get_pending_count()
- "Failed entries reset karo" → reset_statuses(status_filter="FAILED")
- "Kal ka log dikhao" → get_todays_log_summary(date="YYYYMMDD for yesterday")
- "POD folder mein kitni files hain?" → list_pod_files()
- "Data feed karo" → feed_data()
- "CSV se delivery dates utha ke Excel mein daal do" → feed_data()
- "Pehle dikhao kya data aayega" → feed_data(dry_run=true)
- "Aaj ka data prepare karo" → feed_data()
- "Data feeder phase 1 chalao" → feed_data(run_portal=true, run_courier=false)
- "Data feeder phase 2 chalao" → feed_data(run_portal=false, run_courier=true)
- "Data feeder phase 1 preview dikhao" → feed_data(dry_run=true, run_portal=true, run_courier=false)
- "POD data feed karo" → feed_pod_data()
- "POD folder se task list banao" → feed_pod_data()
- "POD upload ke liye data prepare karo" → feed_pod_data()
- "POD files scan karke Excel mein daal do" → feed_pod_data()
- "Pehle dikhao kitne POD match hote hain" → feed_pod_data(dry_run=true)
"""


# ═══════════════════════════════════════════════════════════════════════════
#  LLM ENGINE
# ═══════════════════════════════════════════════════════════════════════════

@dataclass
class LLMResponse:
    """Parsed LLM response — either a message or a tool call."""
    content: Optional[str] = None          # text reply (if no tool call)
    tool_calls: list = field(default_factory=list)   # list of {name, arguments}


class LLMEngine:
    """
    Wraps LLM API calls. Sends user message + tool schemas, receives either
    a text reply or a tool_call instruction.
    """

    def __init__(self, tool_schemas: list[dict], logger: logging.Logger = None):
        self.logger = logger or logging.getLogger("LLMEngine")
        self.tool_schemas = tool_schemas
        self.conversation_history: list[dict] = [
            {"role": "system", "content": SYSTEM_PROMPT}
        ]

        # Determine backend
        self.backend = os.environ.get("FILFLO_LLM_BACKEND", "groq").lower()
        self.client = None
        self.model = None

        self._init_client()

    def _init_client(self):
        if self.backend == "openai":
            if OpenAI is None:
                raise ImportError("pip install openai")
            api_key = os.environ.get("OPENAI_API_KEY")
            if not api_key:
                raise ValueError("Set OPENAI_API_KEY environment variable.")
            self.client = OpenAI(api_key=api_key)
            self.model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
            self.logger.info(f"[LLMEngine] Using OpenAI: {self.model}")

        elif self.backend == "groq":
            api_key = os.environ.get("GROQ_API_KEY")
            if not api_key:
                raise ValueError("Set GROQ_API_KEY environment variable.")

            if Groq is None:
                # Fallback to OpenAI client with Groq base_url
                if OpenAI is None:
                    raise ImportError("pip install groq  OR  pip install openai")
                self.client = OpenAI(
                    api_key=api_key,
                    base_url="https://api.groq.com/openai/v1"
                )
            else:
                self.client = Groq(api_key=api_key)

            self.model = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")

            # Fallback model chain: if primary model is rate-limited,
            # automatically try the next model in the list.
            # Each Groq model has its OWN separate rate limit.
            # NOTE: llama3-groq-*-tool-use-preview models were decommissioned
            #       by Groq (Jan 2026). Use llama-3.3-70b-versatile instead.
            self._groq_fallback_models = [
                "llama-3.3-70b-versatile",                  # primary (best quality + tool calling)
                "llama-3.1-70b-versatile",                  # fallback 1 (good tool calling)
                "llama-3.1-8b-instant",                     # fallback 2 (fast, lightweight)
            ]
            self.logger.info(f"[LLMEngine] Using Groq: {self.model}")

        else:
            raise ValueError(f"Unknown backend: {self.backend}. Use 'openai' or 'groq'.")

    # ── Send a message and get response ────────────────────────────────

    def chat(self, user_message: str) -> LLMResponse:
        """
        Send user_message to LLM with tool schemas.
        Returns LLMResponse with either content or tool_calls.
        """
        self.conversation_history.append({
            "role": "user",
            "content": user_message
        })

        try:
            response = self._call_with_fallback(
                temperature=0.3,
                max_tokens=1024,
            )
        except Exception as e:
            self.logger.error(f"[LLMEngine] API call failed: {e}")
            return LLMResponse(content=f"LLM API error: {e}")

        msg = response.choices[0].message

        # Case 1: LLM wants to call tool(s)
        if msg.tool_calls:
            parsed_calls = []
            for tc in msg.tool_calls:
                try:
                    raw = tc.function.arguments
                    args = json.loads(raw) if raw else {}
                    if not isinstance(args, dict):
                        args = {}
                except (json.JSONDecodeError, TypeError):
                    args = {}
                parsed_calls.append({
                    "id": tc.id,
                    "name": tc.function.name,
                    "arguments": args,
                })

            # Store the assistant's tool-call message in history
            self.conversation_history.append({
                "role": "assistant",
                "content": msg.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        }
                    }
                    for tc in msg.tool_calls
                ]
            })

            return LLMResponse(content=msg.content, tool_calls=parsed_calls)

        # Case 2: Plain text response
        self.conversation_history.append({
            "role": "assistant",
            "content": msg.content or ""
        })
        return LLMResponse(content=msg.content)

    # ── Feed tool result back to LLM ──────────────────────────────────

    def feed_tool_result(self, tool_call_id: str, tool_name: str, result: str) -> LLMResponse:
        """
        After executing a tool, send its result back to the LLM
        so it can generate a natural-language summary for the user.
        """
        self.conversation_history.append({
            "role": "tool",
            "tool_call_id": tool_call_id,
            "content": result,
        })

        try:
            response = self._call_with_fallback(
                temperature=0.5,
                max_tokens=1024,
                include_tools=False,  # Just summarize — don't offer more tool calls
            )
        except Exception as e:
            self.logger.error(f"[LLMEngine] Follow-up API call failed: {e}")
            return LLMResponse(content=f"Tool executed but LLM summary failed: {e}")

        msg = response.choices[0].message

        # Could be another tool call (chaining) or final text
        if msg.tool_calls:
            parsed_calls = []
            for tc in msg.tool_calls:
                try:
                    raw = tc.function.arguments
                    args = json.loads(raw) if raw else {}
                    if not isinstance(args, dict):
                        args = {}
                except (json.JSONDecodeError, TypeError):
                    args = {}
                parsed_calls.append({
                    "id": tc.id,
                    "name": tc.function.name,
                    "arguments": args,
                })
            self.conversation_history.append({
                "role": "assistant",
                "content": msg.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        }
                    }
                    for tc in msg.tool_calls
                ]
            })
            return LLMResponse(content=msg.content, tool_calls=parsed_calls)

        self.conversation_history.append({
            "role": "assistant",
            "content": msg.content or ""
        })
        return LLMResponse(content=msg.content)

    # ── Parse Groq's failed tool generation ──────────────────────────────

    def _parse_failed_tool_generation(self, error_str: str):
        """
        When Groq returns a tool_use_failed error, the model generated a
        malformed tool call like: <function=tool_name {"arg": "val"}></function>
        Parse this and construct a synthetic response object so the caller
        can still execute the tool.
        """
        import re

        # Extract the failed_generation text
        # The error string may contain escaped quotes like:
        #   '<function=download_report {\"report_type\": \"order_wise\"}></function>'
        #   or: '<function=download_report {"report_type": "order_wise"}></function>'
        # Try multiple patterns to handle both cases

        # First unescape any backslash-escaped quotes in the error string
        cleaned = error_str.replace("\\'", "'").replace('\\"', '"')

        # Pattern 1: <function=TOOL_NAME {JSON}></function>
        match = re.search(
            r"<function=(\w+)\s*(\{.*?\})>\s*</function>",
            cleaned
        )

        # Pattern 2: function=TOOL_NAME {JSON} (without angle brackets, partial match)
        if not match:
            match = re.search(
                r"function=(\w+)\s*(\{.*?\})",
                cleaned
            )

        if not match:
            self.logger.warning("[LLMEngine] Could not parse failed_generation.")
            return None

        tool_name = match.group(1)
        try:
            args_json = match.group(2)
            args = json.loads(args_json)
        except (json.JSONDecodeError, TypeError):
            # Try to fix common JSON issues (single quotes → double quotes)
            try:
                args = json.loads(args_json.replace("'", '"'))
            except Exception:
                args = {}

        self.logger.info(f"[LLMEngine] Recovered tool call from failed_generation: "
                         f"{tool_name}({args})")

        # Build a synthetic response that mimics OpenAI's tool_calls format
        class _Func:
            def __init__(self, name, arguments):
                self.name = name
                self.arguments = json.dumps(arguments) if isinstance(arguments, dict) else arguments

        class _ToolCall:
            def __init__(self, func):
                self.id = f"call_recovered_{tool_name}"
                self.function = func
                self.type = "function"

        class _Msg:
            def __init__(self, tc):
                self.content = None
                self.tool_calls = [tc]
                self.role = "assistant"

        class _Choice:
            def __init__(self, msg):
                self.message = msg

        class _Response:
            def __init__(self, choice):
                self.choices = [choice]

        tc = _ToolCall(_Func(tool_name, args))
        return _Response(_Choice(_Msg(tc)))

    # ── API call with automatic fallback on rate limit ─────────────────

    def _call_with_fallback(self, temperature: float = 0.3, max_tokens: int = 1024, include_tools: bool = True):
        """
        Try the API call with the current model. If rate-limited (429),
        automatically try fallback models (Groq only — each model has
        its own separate rate limit on the free tier).

        Set include_tools=False for follow-up calls where we only want
        a text summary (avoids Groq tool validation errors).
        """
        import time as _time

        # Build the list of models to try
        models_to_try = [self.model]
        if self.backend == "groq" and hasattr(self, "_groq_fallback_models"):
            for m in self._groq_fallback_models:
                if m not in models_to_try:
                    models_to_try.append(m)

        # Only pass tools if requested and available
        tools_param = self.tool_schemas if (include_tools and self.tool_schemas) else None

        last_error = None
        for model in models_to_try:
            try:
                kwargs = dict(
                    model=model,
                    messages=self.conversation_history,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
                if tools_param:
                    kwargs["tools"] = tools_param
                    kwargs["tool_choice"] = "auto"

                response = self.client.chat.completions.create(**kwargs)
                # If we switched models, log it
                if model != self.model:
                    self.logger.info(
                        f"[LLMEngine] Primary model rate-limited. "
                        f"Using fallback: {model}"
                    )
                return response

            except Exception as e:
                error_str = str(e)
                last_error = e

                # Check if it's a rate limit error (HTTP 429)
                if "429" in error_str or "rate_limit" in error_str.lower():
                    self.logger.warning(
                        f"[LLMEngine] Model '{model}' rate-limited. "
                        f"Trying next fallback …"
                    )
                    _time.sleep(1)  # Brief pause before trying next model
                    continue

                # Groq tool_use_failed: model generated malformed tool call
                # Parse the failed_generation and return it as a synthetic response
                if "tool_use_failed" in error_str and "failed_generation" in error_str:
                    self.logger.warning(
                        f"[LLMEngine] Groq tool_use_failed on '{model}'. "
                        f"Parsing failed_generation …"
                    )
                    parsed = self._parse_failed_tool_generation(error_str)
                    if parsed:
                        return parsed
                    # If parsing fails, try next model
                    _time.sleep(1)
                    continue

                # Model decommissioned — skip to next fallback
                if "model_decommissioned" in error_str or "decommissioned" in error_str.lower():
                    self.logger.warning(
                        f"[LLMEngine] Model '{model}' has been decommissioned. "
                        f"Trying next fallback …"
                    )
                    continue

                # Not a recoverable error — don't retry, just raise
                raise

        # All models exhausted
        raise last_error

    # ── Context management ─────────────────────────────────────────────

    def trim_history(self, max_turns: int = 20):
        """Keep conversation history manageable. Preserves system prompt."""
        if len(self.conversation_history) > max_turns * 2 + 1:
            self.conversation_history = (
                [self.conversation_history[0]]  # system prompt
                + self.conversation_history[-(max_turns * 2):]
            )

    def reset_history(self):
        """Start fresh conversation."""
        self.conversation_history = [
            {"role": "system", "content": SYSTEM_PROMPT}
        ]
