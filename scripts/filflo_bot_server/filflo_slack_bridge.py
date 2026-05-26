"""
Slack bridge for Filflo Chat.

Preferred mode:
- Socket Mode + interactive buttons when FILFLO_SLACK_APP_TOKEN is configured

Fallback mode:
- Slack polling (DM-only) with text confirmations when only FILFLO_SLACK_BOT_TOKEN is configured
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from uuid import uuid4

import filflo_combined_bot_v3 as v3
from filflo_chat import FilfloChat, PlannedCommand
from filflo_monitor_bus import emit_monitor_event
from instamart_runtime import submit_instamart_otp

try:
    from slack_sdk.socket_mode import SocketModeClient
    from slack_sdk.socket_mode.request import SocketModeRequest
    from slack_sdk.socket_mode.response import SocketModeResponse
    from slack_sdk.web import WebClient
except Exception:  # pragma: no cover - optional dependency
    SocketModeClient = None
    SocketModeRequest = None
    SocketModeResponse = None
    WebClient = None


BOT_DIR = Path(__file__).resolve().parent
STATE_DIR = BOT_DIR / "state"
STATE_DIR.mkdir(parents=True, exist_ok=True)
SLACK_STATE_PATH = STATE_DIR / "filflo_slack_state.json"


def _bool_env(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def _tuple_env(name: str) -> tuple[str, ...]:
    raw = os.getenv(name, "")
    return tuple(part.strip() for part in raw.split(",") if part.strip())


@dataclass(frozen=True, slots=True)
class SlackBridgeSettings:
    enabled: bool = _bool_env("FILFLO_SLACK_ENABLED", False)
    bot_token: str = os.getenv("FILFLO_SLACK_BOT_TOKEN", "").strip()
    app_token: str = os.getenv("FILFLO_SLACK_APP_TOKEN", "").strip()
    allowed_channel_ids: tuple[str, ...] = _tuple_env("FILFLO_SLACK_ALLOWED_CHANNEL_IDS")
    allowed_user_ids: tuple[str, ...] = _tuple_env("FILFLO_SLACK_ALLOWED_USER_IDS")
    poll_seconds: int = int(os.getenv("FILFLO_SLACK_POLL_SECONDS", "15") or "15")
    command_prefix: str = os.getenv("FILFLO_SLACK_COMMAND_PREFIX", "filflo:").strip() or "filflo:"
    reply_in_thread: bool = _bool_env("FILFLO_SLACK_REPLY_IN_THREAD", True)

    def is_configured(self) -> bool:
        return bool(self.enabled and self.bot_token and self.allowed_user_ids)

    @property
    def socket_mode_enabled(self) -> bool:
        return bool(self.app_token and SocketModeClient and WebClient)


@dataclass(slots=True)
class PendingSlackExecution:
    pending_id: str
    channel_id: str
    user_id: str
    thread_ts: str
    command_text: str
    created_at: float
    plan: list[PlannedCommand] = field(default_factory=list)


class FilfloSlackBridge:
    def __init__(self, chat: FilfloChat, logger=None):
        self.chat = chat
        self.logger = logger or v3.setup_logging(v3.LOG_DIR)
        self.settings = SlackBridgeSettings()
        self._stop_event = threading.Event()
        self._pending_lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._pending: dict[str, PendingSlackExecution] = {}
        self._socket_client: SocketModeClient | None = None
        self._web_client: WebClient | None = None
        self._poll_thread: threading.Thread | None = None
        self._state = self._load_state()

    def start(self) -> str:
        if not self.settings.enabled:
            return "Slack bridge disabled. Set FILFLO_SLACK_ENABLED=true to enable it."
        if not self.settings.is_configured():
            return "Slack bridge disabled: configuration incomplete."
        if WebClient is None:
            return "Slack bridge disabled: slack_sdk is not installed."

        self._web_client = WebClient(token=self.settings.bot_token)
        self.logger.info("[FilfloSlackBridge] Starting Slack bridge...")

        if self.settings.socket_mode_enabled:
            self._socket_client = SocketModeClient(app_token=self.settings.app_token, web_client=self._web_client)
            self._socket_client.socket_mode_request_listeners.append(self._process_socket_request)
            self._socket_client.connect()
            self.logger.info("[FilfloSlackBridge] Socket Mode enabled with interactive confirmations.")
            return "Slack bridge started in Socket Mode with buttons."

        self._poll_thread = threading.Thread(target=self._poll_loop, name="filflo-slack-poll", daemon=True)
        self._poll_thread.start()
        self.logger.info("[FilfloSlackBridge] Polling fallback enabled (text confirmation mode).")
        return "Slack bridge started in polling mode. Buttons need FILFLO_SLACK_APP_TOKEN."

    def run_forever(self) -> None:
        status_message = self.start()
        print(status_message)
        if "disabled" in status_message.lower():
            return
        try:
            while not self._stop_event.is_set():
                time.sleep(1)
        except KeyboardInterrupt:
            pass
        finally:
            self.shutdown()

    def shutdown(self) -> None:
        self._stop_event.set()
        if self._socket_client:
            try:
                self._socket_client.close()
            except Exception:
                pass
            self._socket_client = None
        if self._poll_thread and self._poll_thread.is_alive():
            self._poll_thread.join(timeout=3)
        self._save_state()
        self.logger.info("[FilfloSlackBridge] Shutdown complete.")

    def _load_state(self) -> dict[str, Any]:
        if not SLACK_STATE_PATH.exists():
            return {"last_ts": {}}
        try:
            return json.loads(SLACK_STATE_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {"last_ts": {}}

    def _save_state(self) -> None:
        with self._state_lock:
            SLACK_STATE_PATH.write_text(json.dumps(self._state, indent=2), encoding="utf-8")

    def _get_last_ts(self, channel_id: str) -> str | None:
        return self._state.get("last_ts", {}).get(channel_id)

    def _set_last_ts(self, channel_id: str, ts: str) -> None:
        with self._state_lock:
            self._state.setdefault("last_ts", {})[channel_id] = ts
        self._save_state()

    def _process_socket_request(self, client: SocketModeClient, req: SocketModeRequest) -> None:
        if SocketModeResponse is not None:
            client.send_socket_mode_response(SocketModeResponse(envelope_id=req.envelope_id))

        if req.type == "events_api":
            payload = req.payload or {}
            event = payload.get("event", {})
            event_id = payload.get("event_id")
            if event_id and self._state.setdefault("seen_event_ids", {}).get(event_id):
                return
            if event_id:
                self._state.setdefault("seen_event_ids", {})[event_id] = time.time()
                self._trim_seen_event_ids()
                self._save_state()
            self._handle_socket_event(event)
            return

        if req.type == "interactive":
            payload = req.payload or {}
            self._handle_interaction(payload)

    def _trim_seen_event_ids(self) -> None:
        seen = self._state.setdefault("seen_event_ids", {})
        if len(seen) <= 500:
            return
        items = sorted(seen.items(), key=lambda item: item[1], reverse=True)[:500]
        self._state["seen_event_ids"] = {key: value for key, value in items}

    def _handle_socket_event(self, event: dict[str, Any]) -> None:
        if event.get("type") != "message":
            return
        if event.get("subtype") or event.get("bot_id"):
            return

        channel_id = str(event.get("channel", "")).strip()
        user_id = str(event.get("user", "")).strip()
        channel_type = str(event.get("channel_type", "")).strip()
        text = str(event.get("text", "") or "").strip()
        message_ts = str(event.get("ts", "") or "").strip()

        if not self._is_allowed_message(channel_id, user_id, channel_type):
            return

        command_text = self._extract_command_text(text, channel_type == "im")
        if not command_text:
            return

        self._handle_incoming_text(channel_id, user_id, message_ts, command_text, interactive_available=True)

    def _handle_interaction(self, payload: dict[str, Any]) -> None:
        actions = payload.get("actions", [])
        if not actions:
            return

        action = actions[0]
        pending_id = str(action.get("value", "")).strip()
        action_id = str(action.get("action_id", "")).strip()
        user_id = str(payload.get("user", {}).get("id", "")).strip()
        channel_id = str(payload.get("channel", {}).get("id", "")).strip()

        if action_id == "filflo_confirm":
            self._confirm_pending(pending_id, user_id, channel_id)
        elif action_id == "filflo_cancel":
            self._cancel_pending(pending_id, user_id, channel_id)

    def _poll_loop(self) -> None:
        assert self._web_client is not None
        while not self._stop_event.is_set():
            try:
                for channel_id in self._channels_to_poll():
                    last_ts = self._get_last_ts(channel_id)
                    commands, newest_ts = self._poll_channel_once(channel_id, last_ts)
                    if newest_ts:
                        self._set_last_ts(channel_id, newest_ts)
                    for item in commands:
                        self._handle_incoming_text(
                            item["channel_id"],
                            item["user_id"],
                            item["message_ts"],
                            item["command_text"],
                            interactive_available=False,
                        )
            except Exception as exc:
                self.logger.exception("[FilfloSlackBridge] Slack polling failed: %s", exc)
            self._stop_event.wait(max(5, self.settings.poll_seconds))

    def _channels_to_poll(self) -> list[str]:
        assert self._web_client is not None
        if self.settings.allowed_channel_ids:
            return list(self.settings.allowed_channel_ids)

        channels: list[str] = []
        cursor: str | None = None
        allowed_users = set(self.settings.allowed_user_ids)
        while True:
            response = self._web_client.conversations_list(types="im", exclude_archived=True, limit=200, cursor=cursor)
            for channel in response.get("channels", []):
                if str(channel.get("user", "")).strip() in allowed_users:
                    channel_id = str(channel.get("id", "")).strip()
                    if channel_id:
                        channels.append(channel_id)
            cursor = response.get("response_metadata", {}).get("next_cursor") or None
            if not cursor:
                break
        return channels

    def _poll_channel_once(self, channel_id: str, last_ts: str | None) -> tuple[list[dict[str, str]], str | None]:
        assert self._web_client is not None
        response = self._web_client.conversations_history(
            channel=channel_id,
            oldest=last_ts or "0",
            inclusive=False,
            limit=50,
        )
        messages = response.get("messages", [])
        if not messages:
            return [], last_ts

        sorted_messages = sorted(messages, key=lambda item: float(item.get("ts", "0")))
        newest_ts = str(sorted_messages[-1].get("ts", "") or "")
        if last_ts is None:
            return [], newest_ts

        commands: list[dict[str, str]] = []
        for payload in sorted_messages:
            if payload.get("bot_id") or payload.get("subtype"):
                continue
            user_id = str(payload.get("user", "")).strip()
            if user_id not in set(self.settings.allowed_user_ids):
                continue
            text = str(payload.get("text", "") or "").strip()
            command_text = self._extract_command_text(text, is_dm=True)
            if not command_text:
                continue
            commands.append(
                {
                    "channel_id": channel_id,
                    "user_id": user_id,
                    "message_ts": str(payload.get("ts", "") or ""),
                    "command_text": command_text,
                }
            )
        return commands, newest_ts

    def _is_allowed_message(self, channel_id: str, user_id: str, channel_type: str) -> bool:
        if self.settings.allowed_channel_ids and channel_id in self.settings.allowed_channel_ids:
            return user_id in set(self.settings.allowed_user_ids)
        return channel_type == "im" and user_id in set(self.settings.allowed_user_ids)

    def _extract_command_text(self, text: str, is_dm: bool) -> str | None:
        normalized = text.strip()
        if not normalized:
            return None
        prefix = self.settings.command_prefix
        if prefix and normalized.casefold().startswith(prefix.casefold()):
            return normalized[len(prefix) :].strip()
        if is_dm:
            return normalized
        return None

    def _handle_incoming_text(
        self,
        channel_id: str,
        user_id: str,
        message_ts: str,
        text: str,
        *,
        interactive_available: bool,
    ) -> None:
        otp = self._parse_instamart_otp(text)
        if otp:
            self._handle_instamart_otp(channel_id, user_id, message_ts, otp)
            return

        confirm_op = self._parse_text_confirmation(text)
        if confirm_op:
            action, pending_id = confirm_op
            if action == "confirm":
                emit_monitor_event(
                    "slack",
                    f"Slack confirmation received for request {pending_id}",
                    event_type="slack_confirm",
                    data={"pending_id": pending_id, "channel_id": channel_id, "user_id": user_id},
                )
                self._confirm_pending(pending_id, user_id, channel_id)
            else:
                emit_monitor_event(
                    "slack",
                    f"Slack cancellation received for request {pending_id}",
                    level="WARNING",
                    event_type="slack_cancel",
                    data={"pending_id": pending_id, "channel_id": channel_id, "user_id": user_id},
                )
                self._cancel_pending(pending_id, user_id, channel_id)
            return

        emit_monitor_event(
            "slack",
            f"Slack command received: {text}",
            event_type="slack_command",
            data={"channel_id": channel_id, "user_id": user_id, "message_ts": message_ts},
        )
        plan, direct_reply = self.chat.plan_message(text)
        if direct_reply:
            self._send_reply(channel_id, message_ts, direct_reply)
            return
        if not plan:
            self._send_reply(channel_id, message_ts, "Command plan nahi ban paya.")
            return

        issues = self.chat._validate_batch_plan(plan)
        if issues:
            issue_text = "\n".join(f"- {item}" for item in issues)
            self._send_reply(channel_id, message_ts, f"Batch reject kiya gaya:\n{issue_text}")
            return

        pending = PendingSlackExecution(
            pending_id=uuid4().hex,
            channel_id=channel_id,
            user_id=user_id,
            thread_ts=message_ts,
            command_text=text,
            created_at=time.time(),
            plan=plan,
        )
        with self._pending_lock:
            self._pending[pending.pending_id] = pending

        emit_monitor_event(
            "slack",
            f"Slack plan queued for confirmation: {text}",
            event_type="slack_plan_ready",
            data={"pending_id": pending.pending_id, "step_count": len(plan)},
        )
        plan_text = self.chat.describe_plan(plan)
        if interactive_available and self.settings.socket_mode_enabled:
            self._send_confirmation_buttons(pending, plan_text)
            return

        self._send_reply(
            channel_id,
            message_ts,
            (
                f"{plan_text}\n\n"
                f"Buttons ke bina fallback mode chal raha hai.\n"
                f"Run karne ke liye reply karo: `confirm {pending.pending_id}`\n"
                f"Cancel karne ke liye reply karo: `cancel {pending.pending_id}`"
            ),
        )

    def _parse_instamart_otp(self, text: str) -> str | None:
        match = re.match(
            r"^\s*(?:instamart\s+)?otp(?:\s+is)?\s*[:\-]?\s*(\d{4,8})\s*$",
            text,
            re.IGNORECASE,
        )
        if not match:
            return None
        return match.group(1)

    def _handle_instamart_otp(
        self,
        channel_id: str,
        user_id: str,
        message_ts: str,
        otp: str,
    ) -> None:
        try:
            result = submit_instamart_otp(otp)
        except Exception as exc:
            emit_monitor_event(
                "slack",
                f"Slack OTP rejected: {exc}",
                level="WARNING",
                event_type="slack_instamart_otp_rejected",
                data={"channel_id": channel_id, "user_id": user_id},
            )
            self._send_reply(channel_id, message_ts, f"Instamart OTP accept nahi hua: {exc}")
            return

        emit_monitor_event(
            "slack",
            "Slack OTP accepted for Instamart login",
            event_type="slack_instamart_otp_received",
            data={
                "channel_id": channel_id,
                "user_id": user_id,
                "otp_file": result.get("otp_file", ""),
            },
        )
        self._send_reply(
            channel_id,
            message_ts,
            "Instamart OTP mil gaya. Login flow abhi continue kar raha hai.",
        )

    def _parse_text_confirmation(self, text: str) -> tuple[str, str] | None:
        normalized = text.strip().lower()
        for prefix, action in (("confirm ", "confirm"), ("yes ", "confirm"), ("cancel ", "cancel"), ("no ", "cancel")):
            if normalized.startswith(prefix):
                pending_id = normalized[len(prefix) :].strip().split()[0]
                if pending_id:
                    return action, pending_id
        return None

    def _confirm_pending(self, pending_id: str, user_id: str, channel_id: str) -> None:
        with self._pending_lock:
            pending = self._pending.pop(pending_id, None)
        if not pending:
            self._send_reply(channel_id, "", "Ye request expire ho chuki hai ya mil nahi rahi.")
            return
        if pending.user_id != user_id:
            self._send_reply(channel_id, pending.thread_ts, "Ye confirmation sirf original requester hi kar sakta hai.")
            with self._pending_lock:
                self._pending[pending_id] = pending
            return

        emit_monitor_event(
            "slack",
            f"Slack request confirmed: {pending.command_text}",
            event_type="slack_execution_started",
            data={"pending_id": pending.pending_id, "channel_id": channel_id, "user_id": user_id},
        )
        self._send_reply(channel_id, pending.thread_ts, "Execution started.")
        worker = threading.Thread(target=self._run_pending, args=(pending,), name=f"slack-job-{pending_id[:8]}", daemon=True)
        worker.start()

    def _cancel_pending(self, pending_id: str, user_id: str, channel_id: str) -> None:
        with self._pending_lock:
            pending = self._pending.get(pending_id)
            if not pending:
                self._send_reply(channel_id, "", "Ye request expire ho chuki hai ya mil nahi rahi.")
                return
            if pending.user_id != user_id:
                self._send_reply(channel_id, pending.thread_ts, "Ye cancel sirf original requester hi kar sakta hai.")
                return
            self._pending.pop(pending_id, None)
        emit_monitor_event(
            "slack",
            f"Slack request cancelled: {pending.command_text}",
            level="WARNING",
            event_type="slack_execution_cancelled",
            data={"pending_id": pending.pending_id, "channel_id": channel_id, "user_id": user_id},
        )
        self._send_reply(channel_id, pending.thread_ts, "Request cancelled.")

    def _run_pending(self, pending: PendingSlackExecution) -> None:
        try:
            result = self.chat.execute_plan(
                pending.plan,
                progress_callback=lambda message: self._send_reply(pending.channel_id, pending.thread_ts, message),
            )
            self._send_reply(pending.channel_id, pending.thread_ts, result)
        except Exception as exc:
            self.logger.exception("[FilfloSlackBridge] Pending execution failed: %s", exc)
            self._send_reply(pending.channel_id, pending.thread_ts, f"Execution failed: {exc}")

    def _send_confirmation_buttons(self, pending: PendingSlackExecution, plan_text: str) -> None:
        assert self._web_client is not None
        blocks = [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*Filflo execution plan*\n```{plan_text}```",
                },
            },
            {
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "Confirm"},
                        "style": "primary",
                        "action_id": "filflo_confirm",
                        "value": pending.pending_id,
                    },
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "Cancel"},
                        "style": "danger",
                        "action_id": "filflo_cancel",
                        "value": pending.pending_id,
                    },
                ],
            },
        ]
        payload: dict[str, Any] = {"channel": pending.channel_id, "blocks": blocks, "text": plan_text}
        if self.settings.reply_in_thread and pending.thread_ts:
            payload["thread_ts"] = pending.thread_ts
        self._web_client.chat_postMessage(**payload)

    def _send_reply(self, channel_id: str, message_ts: str, text: str) -> None:
        if not self._web_client:
            return
        payload: dict[str, Any] = {"channel": channel_id, "text": text[:3900]}
        if self.settings.reply_in_thread and message_ts:
            payload["thread_ts"] = message_ts
        self._web_client.chat_postMessage(**payload)
