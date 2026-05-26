"""
╔══════════════════════════════════════════════════════════════════╗
║  Scootsy DN Updation — Purchase Return Email Processor          ║
║                                                                  ║
║  Automates the "Scootsy DN" workflow:                           ║
║    1. Connects to Gmail via IMAP                                ║
║    2. Fetches UNREAD Purchase Return emails                     ║
║    3. Downloads Discrepancy Note (PDF) attachments              ║
║    4. Extracts DN No. and Amount from the PDF                   ║
║    5. Appends [Date, Subject, Amount, DN No.] to Google Sheet   ║
║    6. Marks email as READ and cleans up temp PDF                ║
║                                                                  ║
║  Part of the Filflo Bot ecosystem. More platform modules        ║
║  can be added alongside this one.                               ║
║                                                                  ║
║  Usage:                                                          ║
║    python scootsy_DN_updation.py                                ║
║    python scootsy_DN_updation.py --dry-run  (preview, no push)  ║
║    python scootsy_DN_updation.py --dry-run --limit 5            ║
╚══════════════════════════════════════════════════════════════════╝
"""

import imaplib
import email
import os
import re
import sys
import json
import logging
import argparse
import tempfile
import smtplib
from datetime import datetime, timedelta
from email.header import decode_header
from email.message import EmailMessage
from pathlib import Path
from typing import Optional
from filflo_monitor_bus import attach_monitor_handler

try:
    from dotenv import load_dotenv
except ImportError:
    def load_dotenv(*_args, **_kwargs):
        return False

try:
    from pypdf import PdfReader
except ImportError:
    PdfReader = None

try:
    import gspread
    from gspread.exceptions import SpreadsheetNotFound
except ImportError:
    gspread = None

    class SpreadsheetNotFound(Exception):
        pass


# ═══════════════════════════════════════════════════════════════════════
#  CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════

BOT_FOLDER = Path(os.environ.get("FILFLO_BOT_FOLDER", Path(__file__).resolve().parent))
LOG_DIR    = BOT_FOLDER / "logs"

load_dotenv(BOT_FOLDER / ".env")

# Gmail IMAP settings
IMAP_HOST = "imap.gmail.com"
IMAP_PORT = 993
SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587

# Gmail credentials (from environment variables)
GMAIL_USER         = os.environ.get("SCOOTSY_GMAIL_USER", "marketplace@anveshan.farm").strip()
GMAIL_APP_PASSWORD = os.environ.get("SCOOTSY_GMAIL_APP_PASSWORD", "").strip()
FORWARD_RECIPIENT = os.environ.get("SCOOTSY_FORWARD_RECIPIENT", "nandlal@anveshan.farm").strip()
# ^ Your 16-char Gmail App Password (spaces removed)
# Google OAuth2 — reuse existing Filflo Bot credentials (no new login needed)
GOOGLE_CLIENT_SECRET = BOT_FOLDER / "client_secret.json"
GOOGLE_AUTH_TOKEN    = BOT_FOLDER / "authorized_user.json"

# Google Sheet settings
SPREADSHEET_ID   = os.environ.get("SCOOTSY_SPREADSHEET_ID", "1R5IM18UjnF5hB1gPz8Si3oLp6-Et58y5gIEeJS29tyU").strip()
WORKSHEET_GID_RAW = os.environ.get("SCOOTSY_WORKSHEET_GID", "1067521138").strip()
WORKSHEET_GID    = int(WORKSHEET_GID_RAW) if WORKSHEET_GID_RAW else None
WORKSHEET_NAME   = os.environ.get("SCOOTSY_WORKSHEET_NAME", "").strip()
LOOKBACK_DAYS    = int(os.environ.get("SCOOTSY_LOOKBACK_DAYS", "30").strip() or "30")
SEEN_REGISTER_PATH = Path(
    os.environ.get(
        "SCOOTSY_SEEN_REGISTER_PATH",
        str(BOT_FOLDER / "state" / "scootsy_seen_register.json"),
    )
)

# Email filter (subject-only — emails come from multiple senders)
# Note: we search for "Purchase Return" to avoid IMAP issues with "&"
SUBJECT_PATTERN = os.environ.get("SCOOTSY_SUBJECT_PATTERN", "Purchase Return").strip() or "Purchase Return"

# Temporary directory for downloaded PDFs
TEMP_DIR = tempfile.gettempdir()


# ═══════════════════════════════════════════════════════════════════════
#  LOGGING  (writes to logs/grn_processor_YYYY-MM-DD.log)
# ═══════════════════════════════════════════════════════════════════════

LOG_DIR.mkdir(exist_ok=True)

# Use a named logger instead of basicConfig to avoid polluting the root logger
# when this module is imported by other parts of the bot (e.g. tool_registry).
log = logging.getLogger("ScootsyDN")


def _setup_scootsy_logging():
    """Configure file + console handlers. Called once from __main__."""
    if log.handlers:
        attach_monitor_handler(log, source="scootsy_dn")
        return  # already configured
    log.setLevel(logging.INFO)
    log_file = LOG_DIR / f"grn_processor_{datetime.now():%Y-%m-%d}.log"
    fh = logging.FileHandler(log_file, encoding="utf-8")
    fh.setFormatter(logging.Formatter(
        "%(asctime)s  %(levelname)-8s  %(message)s", datefmt="%Y-%m-%d %H:%M:%S"))
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(errors="replace")
    except Exception:
        pass
    ch = logging.StreamHandler(sys.stdout)
    ch.setFormatter(logging.Formatter(
        "%(asctime)s  %(levelname)-8s  %(message)s", datefmt="%Y-%m-%d %H:%M:%S"))
    log.addHandler(fh)
    log.addHandler(ch)
    attach_monitor_handler(log, source="scootsy_dn")


def validate_runtime_config() -> None:
    """Fail fast with clear messages when required config is missing."""
    missing = []
    if not GMAIL_USER:
        missing.append("SCOOTSY_GMAIL_USER")
    if not GMAIL_APP_PASSWORD:
        missing.append("SCOOTSY_GMAIL_APP_PASSWORD")
    if not SPREADSHEET_ID:
        missing.append("SCOOTSY_SPREADSHEET_ID")
    if not GOOGLE_CLIENT_SECRET.exists():
        missing.append(f"Missing file: {GOOGLE_CLIENT_SECRET}")
    if not GOOGLE_AUTH_TOKEN.exists():
        missing.append(f"Missing file: {GOOGLE_AUTH_TOKEN}")

    if missing:
        raise RuntimeError("Scootsy config is incomplete: " + ", ".join(missing))


def get_clean_gmail_credentials() -> tuple[str, str]:
    """Return sanitized Gmail credentials for IMAP/SMTP use."""
    clean_user = GMAIL_USER.replace("\xa0", " ").strip()
    clean_password = GMAIL_APP_PASSWORD.replace("\xa0", " ").replace(" ", "").strip()
    return clean_user, clean_password


def _normalize_uid(uid: bytes | str) -> str:
    return uid.decode() if isinstance(uid, bytes) else str(uid)


def normalize_dn(dn_number: Optional[str]) -> str:
    return re.sub(r"\s+", "", (dn_number or "").strip().upper())


def normalize_invoice(invoice_no: Optional[str]) -> str:
    return re.sub(r"\s+", "", (invoice_no or "").strip().upper())


def build_duplicate_key(dn_number: Optional[str], invoice_no: Optional[str]) -> str:
    dn = normalize_dn(dn_number)
    invoice = normalize_invoice(invoice_no)
    return f"{dn}||{invoice}"


def load_seen_register() -> dict[str, dict]:
    """Load the local seen-register used to skip already-inspected mails."""
    if not SEEN_REGISTER_PATH.exists():
        return {}

    try:
        with open(SEEN_REGISTER_PATH, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, dict):
            return {str(k): v for k, v in data.items()}
    except Exception as exc:
        log.warning("Could not load seen-register %s: %s", SEEN_REGISTER_PATH, exc)
    return {}


def save_seen_register(entries: dict[str, dict]) -> None:
    """Persist the local seen-register to disk."""
    SEEN_REGISTER_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(SEEN_REGISTER_PATH, "w", encoding="utf-8") as handle:
        json.dump(entries, handle, indent=2, ensure_ascii=False, sort_keys=True)


def update_seen_register(
    register: dict[str, dict],
    uid: bytes | str,
    status: str,
    subject: str,
    dn_number: Optional[str] = None,
    invoice_no: Optional[str] = None,
) -> None:
    register[_normalize_uid(uid)] = {
        "seen_on": datetime.now().strftime("%Y-%m-%d"),
        "status": status,
        "subject": subject,
        "dn_number": (dn_number or "").strip(),
        "invoice_no": (invoice_no or "").strip(),
    }


# ═══════════════════════════════════════════════════════════════════════
#  1. EMAIL FETCHING (IMAP)
# ═══════════════════════════════════════════════════════════════════════

def connect_to_gmail() -> imaplib.IMAP4_SSL:
    """Establish an authenticated IMAP connection to Gmail."""
    validate_runtime_config()
    clean_user, clean_password = get_clean_gmail_credentials()
    log.info("Connecting to Gmail IMAP (%s)...", IMAP_HOST)
    conn = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT)
    conn.login(clean_user, clean_password)
    log.info("Authenticated as %s", clean_user)
    return conn


def _decode_subject(msg: email.message.Message) -> str:
    """Decode a potentially MIME-encoded Subject header into a plain string."""
    raw = msg.get("Subject", "")
    parts = decode_header(raw)
    decoded_parts = []
    
    for fragment, charset in parts:
        if isinstance(fragment, bytes):
            decoded_parts.append(fragment.decode(charset or "utf-8", errors="replace"))
        else:
            decoded_parts.append(str(fragment))
            
    subject = " ".join(decoded_parts)
    
    # Remove all hidden line breaks and collapse multiple spaces to stop fragmentation
    subject = subject.replace('\r', '').replace('\n', '')
    subject = re.sub(r'\s+', ' ', subject).strip()
    
    # Strip Re:/Fwd:/Fw: prefixes (can be nested like "Re: Re: Fwd:")
    # This automatically gives us the "base subject" for thread grouping later
    subject = re.sub(r'^(":\s*(":Re|Fwd|Fw)\s*:\s*)+', '', subject, flags=re.IGNORECASE).strip()
    return subject


def _save_pdf_attachment(
    msg: email.message.Message, uid: bytes
) -> Optional[str]:
    """
    Walk the MIME tree of *msg* and save the Discrepancy Note PDF
    attachment to TEMP_DIR. Prefers filenames containing "Discrepancy"
    or "DN". Falls back to the first PDF if no match is found.
    Returns the file path, or None if no PDF was found.
    """
    all_pdfs = []  # collect all PDF parts: (filename, payload)

    for part in msg.walk():
        content_type = part.get_content_type()
        content_disposition = str(part.get("Content-Disposition", ""))

        if content_type == "application/pdf" or (
            "attachment" in content_disposition
            and part.get_filename("").lower().endswith(".pdf")
        ):
            filename = part.get_filename() or f"dn_{uid.decode()}.pdf"
            payload = part.get_payload(decode=True)
            all_pdfs.append((filename, payload))

    if not all_pdfs:
        return None

    # Prefer the Discrepancy Note PDF over GRN or other attachments
    chosen = None
    for filename, payload in all_pdfs:
        name_lower = filename.lower()
        if "discrepancy" in name_lower or "dn" in name_lower:
            chosen = (filename, payload)
            break

    # Fallback to first PDF if no Discrepancy Note found
    if chosen is None:
        chosen = all_pdfs[0]

    filename, payload = chosen
    filename = re.sub(r'[^\w.\-]', '_', filename)  # sanitise
    filepath = os.path.join(TEMP_DIR, f"{_normalize_uid(uid)}_{filename}")

    with open(filepath, "wb") as f:
        f.write(payload)

    log.info("  Saved PDF → %s (picked from %d attachment(s))", filepath, len(all_pdfs))
    return filepath


def _extract_message_body(msg: email.message.Message) -> str:
    """Extract a readable plain-text body for forwarded emails."""
    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            content_disposition = str(part.get("Content-Disposition", ""))
            if "attachment" in content_disposition.lower():
                continue
            if content_type == "text/plain":
                payload = part.get_payload(decode=True)
                if payload is None:
                    continue
                charset = part.get_content_charset() or "utf-8"
                return payload.decode(charset, errors="replace").strip()
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            charset = msg.get_content_charset() or "utf-8"
            return payload.decode(charset, errors="replace").strip()
    return ""


def build_forward_message(
    source_msg: email.message.Message,
    recipient: str,
    *,
    dn_number: str = "",
    invoice_no: str = "",
    reason_text: str = "",
    amount: str = "",
) -> EmailMessage:
    """Build a forwarded email with original attachments preserved."""
    clean_user, _ = get_clean_gmail_credentials()
    subject = _decode_subject(source_msg)
    forwarded = EmailMessage()
    forwarded["From"] = clean_user
    forwarded["To"] = recipient
    forwarded["Subject"] = f"Fwd: {subject}"

    summary_lines = [
        "Forwarded by Scootsy DN Bot",
        "",
        f"Original From: {source_msg.get('From', '')}",
        f"Original Date: {source_msg.get('Date', '')}",
        f"Original Subject: {subject}",
    ]
    if dn_number:
        summary_lines.append(f"DN No: {dn_number}")
    if invoice_no:
        summary_lines.append(f"Invoice No: {invoice_no}")
    if reason_text:
        summary_lines.append(f"Reason/Remarks: {reason_text}")
    if amount:
        summary_lines.append(f"Amount: {amount}")

    original_body = _extract_message_body(source_msg)
    if original_body:
        summary_lines.extend(["", "Original email body:", original_body])

    forwarded.set_content("\n".join(summary_lines))

    for part in source_msg.walk():
        if part.is_multipart():
            continue
        filename = part.get_filename()
        content_disposition = str(part.get("Content-Disposition", ""))
        if not filename and "attachment" not in content_disposition.lower():
            continue
        payload = part.get_payload(decode=True)
        if payload is None:
            continue
        content_type = part.get_content_type()
        if "/" in content_type:
            maintype, subtype = content_type.split("/", 1)
        else:
            maintype, subtype = "application", "octet-stream"
        forwarded.add_attachment(
            payload,
            maintype=maintype,
            subtype=subtype,
            filename=filename or "attachment.bin",
        )

    return forwarded


def forward_emails_with_attachments(
    items: list[dict],
    recipient: Optional[str] = None,
) -> int:
    """Forward selected source emails, preserving their attachments."""
    if not items:
        return 0

    target_recipient = (recipient or FORWARD_RECIPIENT).strip()
    if not target_recipient:
        log.info("No Scootsy forward recipient configured. Skipping email forwarding.")
        return 0

    clean_user, clean_password = get_clean_gmail_credentials()
    forwarded_count = 0

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
        server.starttls()
        server.login(clean_user, clean_password)

        for item in items:
            source_msg = item["message"]
            forward_msg = build_forward_message(
                source_msg,
                target_recipient,
                dn_number=item.get("dn_number", ""),
                invoice_no=item.get("invoice_no", ""),
                reason_text=item.get("reason_text", ""),
                amount=item.get("amount", ""),
            )
            server.send_message(forward_msg, from_addr=clean_user, to_addrs=[target_recipient])
            forwarded_count += 1
            log.info(
                "  Forwarded UID %s to %s with %s attachment(s).",
                item.get("uid_str", ""),
                target_recipient,
                len(list(forward_msg.iter_attachments())),
            )

    return forwarded_count


def forward_email_uids(uids: list[str], recipient: Optional[str] = None) -> int:
    """Forward specific source UIDs with all attachments to the recipient."""
    conn: Optional[imaplib.IMAP4_SSL] = None
    items: list[dict] = []
    try:
        conn = connect_to_gmail()
        conn.select("INBOX")
        for uid in uids:
            uid_str = _normalize_uid(uid)
            status, msg_data = conn.uid("fetch", uid_str, "(BODY.PEEK[])")
            if status != "OK" or not msg_data or not msg_data[0]:
                log.warning("Could not fetch UID %s for forwarding.", uid_str)
                continue
            raw_email = msg_data[0][1]
            msg = email.message_from_bytes(raw_email)
            items.append(
                {
                    "uid": uid_str,
                    "uid_str": uid_str,
                    "message": msg,
                    "subject": _decode_subject(msg),
                }
            )
        return forward_emails_with_attachments(items, recipient=recipient)
    finally:
        if conn:
            try:
                conn.logout()
            except Exception:
                pass


def fetch_recent_emails(
    conn: imaplib.IMAP4_SSL,
    limit: int = 0,
    seen_uids: Optional[set[str]] = None,
) -> list[dict]:
    """
    Search for Purchase Return emails from the last N days, regardless of
    read/unread state, and skip any UIDs already present in the local seen-register.

    Returns a list of dicts:
        uid      – IMAP UID (bytes)
        subject  – decoded subject line
        pdf_path – local path to saved PDF (or None)
    """
    conn.select("INBOX")

    since_date = (datetime.now() - timedelta(days=LOOKBACK_DAYS)).strftime("%d-%b-%Y")
    search_criteria = f'(SINCE "{since_date}" SUBJECT "{SUBJECT_PATTERN}")'
    log.info("Searching: %s", search_criteria)
    status, data = conn.uid("search", None, search_criteria)

    if status != "OK" or not data[0]:
        log.info("No matching recent emails found.")
        return []

    uids = data[0].split()
    log.info("Found %d matching email(s) in last %d day(s).", len(uids), LOOKBACK_DAYS)

    seen_uids = seen_uids or set()
    if seen_uids:
        before = len(uids)
        uids = [uid for uid in uids if _normalize_uid(uid) not in seen_uids]
        skipped = before - len(uids)
        if skipped:
            log.info("Skipping %d email(s) already present in local seen-register.", skipped)

    # Apply limit at fetch stage to avoid downloading all emails
    if limit > 0 and len(uids) > limit:
        log.info("Limiting fetch to latest %d email(s).", limit)
        uids = uids[-limit:]  # take the most recent ones

    results = []
    for uid in uids:
        status, msg_data = conn.uid("fetch", uid, "(BODY.PEEK[])")
        if status != "OK":
            log.warning("Failed to fetch UID %s — skipping.", uid)
            continue

        raw_email = msg_data[0][1]
        msg = email.message_from_bytes(raw_email)
        subject = _decode_subject(msg)
        pdf_path = _save_pdf_attachment(msg, uid)

        results.append({
            "uid": uid,
            "uid_str": _normalize_uid(uid),
            "subject": subject,
            "pdf_path": pdf_path,
            "message": msg,
        })

    return results


def mark_as_read(conn: imaplib.IMAP4_SSL, uid: bytes) -> None:
    """Flag the email as SEEN (read)."""
    conn.uid("store", uid, "+FLAGS", "(\\Seen)")
    log.info("  Marked UID %s as READ.", uid.decode())


# ═══════════════════════════════════════════════════════════════════════
#  2. PDF PARSING & DATA EXTRACTION
# ═══════════════════════════════════════════════════════════════════════

def extract_reason_text(full_text: str) -> str:
    """Extract the free-text reason/remarks block from line-item rows."""
    lines = [line.strip() for line in full_text.splitlines() if line.strip()]
    reasons = []
    item_start_re = re.compile(r"^\d+\s+\d{3,}-\d+")
    unit_line_re = re.compile(r"\b(?:ltr|ml|g|kg)\b\.?$", re.IGNORECASE)
    numeric_tail_re = re.compile(
        r"^(?P<reason>[A-Za-z][A-Za-z0-9&(),./'`+\- ]*?)\s+(?:\d+(?:\.\d+)?\s+){3,}.*$"
    )
    numeric_only_re = re.compile(r"^\d+(?:\.\d+)?(?:\s+\d+(?:\.\d+)?){2,}.*$")

    i = 0
    while i < len(lines):
        if not item_start_re.match(lines[i]):
            i += 1
            continue

        j = i + 1
        while j < len(lines) and lines[j].startswith("HSN:"):
            j += 1

        while j < len(lines):
            if unit_line_re.search(lines[j]):
                j += 1
                break
            if item_start_re.match(lines[j]) or lines[j].startswith("Total:"):
                break
            j += 1

        reason_lines = []
        while j < len(lines):
            current = lines[j]
            if current.startswith("Total:") or item_start_re.match(current):
                break

            inline_reason = numeric_tail_re.match(current)
            if inline_reason:
                reason_lines.append(inline_reason.group("reason"))
                break

            if numeric_only_re.match(current):
                break

            reason_lines.append(current)
            next_line = lines[j + 1] if j + 1 < len(lines) else ""
            if numeric_only_re.match(next_line):
                break
            j += 1

        if reason_lines:
            reason_text = re.sub(r"\s+", " ", " ".join(reason_lines)).strip(" -:")
            if reason_text and reason_text.lower() not in {"total", "amount"}:
                reasons.append(reason_text)

        i = j + 1

    ordered = []
    seen = set()
    for item in reasons:
        key = item.casefold()
        if key in seen:
            continue
        seen.add(key)
        ordered.append(item)
    return " | ".join(ordered)


def extract_data_from_pdf(pdf_path: str) -> dict[str, Optional[str]]:
    """
    Read the PDF and extract DN Number, Amount, Invoice No., and Reason text.
    """
    log.info("  Parsing PDF: %s", pdf_path)
    if PdfReader is None:
        raise RuntimeError("pypdf is not installed. Install it to parse DN PDFs.")

    full_text = ""
    try:
        reader = PdfReader(pdf_path)
        for page in reader.pages:
            page_text = page.extract_text()
            if page_text:
                full_text += page_text + "\n"
    except Exception as exc:
        log.error("  Failed to read PDF: %s", exc)
        return {"dn_number": None, "amount": None, "invoice_no": None, "reason_text": None}

    if not full_text.strip():
        log.warning("  PDF text extraction returned empty content.")
        return {"dn_number": None, "amount": None, "invoice_no": None, "reason_text": None}

    dn_number = None
    dn_label_match = re.search(r"DN\s*No\s*[:\-]+\s*([A-Z]{2,5}-DN\d{4,10})", full_text, re.IGNORECASE)
    if dn_label_match:
        dn_number = normalize_dn(dn_label_match.group(1))

    if not dn_number:
        dn_match = re.search(r"\b([A-Z]{2,5}-DN\d{4,10})\b", full_text)
        if dn_match:
            dn_number = normalize_dn(dn_match.group(1))

    if not dn_number:
        filename_match = re.search(r"([A-Z]{2,5}-DN\d{4,10})", Path(pdf_path).name, re.IGNORECASE)
        if filename_match:
            dn_number = normalize_dn(filename_match.group(1))

    amount = None
    dn_amt_match = re.search(r"DN\s*Amt\s*[:\-]?\s*([\d,]+\.\d{2})", full_text, re.IGNORECASE)
    if dn_amt_match:
        amount = dn_amt_match.group(1).replace(",", "").strip()

    if not amount:
        total_matches = re.findall(
            r"\b(?:Grand\s*Total|Net\s*Amount|Total\s*Amount|Total\s*Value|Total)\b[^\d]*([\d,]+\.\d{2})",
            full_text,
            re.IGNORECASE,
        )
        if total_matches:
            amount = total_matches[-1].replace(",", "").strip()

    if not amount:
        all_amounts = re.findall(r"[\d,]+\.\d{2}", full_text)
        if all_amounts:
            amount = all_amounts[-1].replace(",", "").strip()

    invoice_no = None
    invoice_match = re.search(
        r"Invoice\s*No\s*[:\-]+\s*([A-Z0-9][A-Z0-9\-/]+)",
        full_text,
        re.IGNORECASE,
    )
    if invoice_match:
        invoice_no = invoice_match.group(1).strip().upper()

    if not invoice_no:
        filename_invoice_match = re.search(r"\b(AFT-[A-Z0-9/\-]+)\b", Path(pdf_path).name, re.IGNORECASE)
        if filename_invoice_match:
            invoice_no = filename_invoice_match.group(1).strip().upper()

    reason_text = extract_reason_text(full_text) or None

    log.info(
        "  Extracted -> DN No: %s | Amount: %s | Invoice No: %s | Reason: %s",
        dn_number,
        amount,
        invoice_no,
        reason_text,
    )
    return {
        "dn_number": dn_number,
        "amount": amount,
        "invoice_no": invoice_no,
        "reason_text": reason_text,
    }

# ======================================================================
#  3. GOOGLE SHEETS INTEGRATION (OAuth2 - reuses Filflo Bot creds)
# ═══════════════════════════════════════════════════════════════════════

def get_gspread_client() -> gspread.Client:
    """
    Authenticate with Google Sheets using the same OAuth2 credentials
    as the rest of the Filflo Bot (client_secret.json + authorized_user.json).
    No new browser login required.
    """
    validate_runtime_config()
    if gspread is None:
        raise RuntimeError("gspread is not installed. Install it to use Google Sheets sync.")
    gc = gspread.oauth(
        credentials_filename=str(GOOGLE_CLIENT_SECRET),
        authorized_user_filename=str(GOOGLE_AUTH_TOKEN),
    )
    log.info("Google Sheets client authorised (OAuth2 via Filflo Bot creds).")
    return gc


def _open_worksheet(client: gspread.Client):
    """Open the target spreadsheet by ID and find the worksheet by gid."""
    spreadsheet = client.open_by_key(SPREADSHEET_ID)
    if WORKSHEET_NAME:
        try:
            ws = spreadsheet.worksheet(WORKSHEET_NAME)
            log.info("Opened worksheet by name: %s", WORKSHEET_NAME)
            return ws
        except Exception:
            log.warning("Worksheet name '%s' not found. Falling back to gid lookup.", WORKSHEET_NAME)

    for ws in spreadsheet.worksheets():
        if WORKSHEET_GID is not None and ws.id == WORKSHEET_GID:
            log.info("Opened worksheet by gid: %s", WORKSHEET_GID)
            return ws
    # Fallback to first sheet if gid not found
    log.warning("Configured worksheet not found. Falling back to first worksheet: %s", spreadsheet.sheet1.title)
    return spreadsheet.sheet1


def load_sheet_data(sheet) -> tuple[set[str], set[str]]:
    """Read the sheet and return existing DN+Invoice keys plus DN-only keys."""
    all_rows = sheet.get_all_values()

    existing_keys: set[str] = set()
    existing_dns: set[str] = set()

    for i, row in enumerate(all_rows):
        if i == 0:
            continue

        dn_no = row[3].strip() if len(row) > 3 else ""
        invoice_no = row[7].strip() if len(row) > 7 else ""
        if dn_no:
            existing_keys.add(build_duplicate_key(dn_no, invoice_no))
            existing_dns.add(normalize_dn(dn_no))

    log.info(
        "Sheet loaded: %d existing DN+Invoice combination(s), %d DN(s).",
        len(existing_keys),
        len(existing_dns),
    )
    return existing_keys, existing_dns


def append_row_to_sheet(
    sheet,
    date: str,
    subject_line: str,
    amount: str,
    dn_number: str,
    reason_text: str,
    invoice_no: str,
) -> None:
    """
    Append a new row to the sheet:
    [Date, Email SL, Amount, DN No., Action taken, CN no, Remarks on DN, Invoice No.]
    """
    row = [date, subject_line, amount or "", dn_number or "", "", "", reason_text or "", invoice_no or ""]
    all_rows = sheet.get_all_values()
    last_non_empty = 0
    for idx, existing in enumerate(all_rows, start=1):
        if any((cell or "").strip() for cell in existing[:8]):
            last_non_empty = idx

    target_row = last_non_empty + 1
    sheet.update(range_name=f"A{target_row}:H{target_row}", values=[row], value_input_option="USER_ENTERED")
    log.info("  Appended row at %d -> %s", target_row, row)



# ═══════════════════════════════════════════════════════════════════════
#  4. WORKFLOW & CLEANUP
# ═══════════════════════════════════════════════════════════════════════

def cleanup_pdf(pdf_path: Optional[str]) -> None:
    """Delete the temporary PDF file if it exists."""
    if pdf_path and os.path.isfile(pdf_path):
        os.remove(pdf_path)
        log.info("  Deleted temp PDF: %s", pdf_path)


def process_emails(dry_run: bool = False, limit: int = 0) -> int:
    """
    Main workflow loop.

    Args:
        dry_run: If True, extract and display data but don't push to
                 Google Sheets or update the local seen-register.
        limit:   Max emails to process (0 = all).

    Returns:
        Number of emails successfully processed.
    """
    processed = 0
    forwarded = 0
    conn: Optional[imaplib.IMAP4_SSL] = None
    seen_register = load_seen_register()
    seen_uid_set = set(seen_register)

    try:
        # --- Google Sheets client (fail fast if creds are missing) ---
        if not dry_run:
            gs_client = get_gspread_client()
            sheet = _open_worksheet(gs_client)
            existing_keys, existing_dns = load_sheet_data(sheet)
        else:
            gs_client = None
            sheet = None
            existing_keys = set()
            existing_dns = set()
            log.info("DRY RUN mode - will not push to Sheets or update local seen-register.")

        # --- Gmail connection ---
        conn = connect_to_gmail()
        emails = fetch_recent_emails(conn, limit=limit, seen_uids=seen_uid_set)

        if not emails:
            log.info("Nothing to process. Exiting.")
            return 0

        today = datetime.now().strftime("%d-%b-%y")
        skipped_no_dn = 0
        skipped_dupes = 0
        batch_keys = set()
        batch_dns = set()
        appended_items: list[dict] = []

        for item in emails:
            uid_str = item["uid_str"]
            subject = item["subject"]
            pdf_path = item["pdf_path"]

            log.info("Processing UID %s - Subject: %s", uid_str, subject)

            if pdf_path is None:
                log.info("  No DN attachment found. Skipping append and keeping mail unread.")
                skipped_no_dn += 1
                if not dry_run:
                    update_seen_register(seen_register, uid_str, "skipped_no_attachment", subject)
                continue

            try:
                extracted = extract_data_from_pdf(pdf_path)
            except Exception as exc:
                log.error("  PDF parsing failed: %s", exc)
                extracted = {"dn_number": None, "amount": None, "invoice_no": None, "reason_text": None}
            finally:
                cleanup_pdf(pdf_path)

            dn_number = extracted.get("dn_number")
            amount = extracted.get("amount")
            invoice_no = extracted.get("invoice_no")
            reason_text = extracted.get("reason_text")

            if not dn_number:
                log.info("  DN number not found. Skipping append and keeping mail unread.")
                skipped_no_dn += 1
                if not dry_run:
                    update_seen_register(seen_register, uid_str, "skipped_no_dn", subject)
                continue

            duplicate_key = build_duplicate_key(dn_number, invoice_no)
            normalized_dn = normalize_dn(dn_number)
            if (
                normalized_dn in existing_dns
                or normalized_dn in batch_dns
                or duplicate_key in existing_keys
                or duplicate_key in batch_keys
            ):
                log.info(
                    "  Duplicate DN detected (%s / %s). Skipping append.",
                    dn_number,
                    invoice_no or "",
                )
                skipped_dupes += 1
                if not dry_run:
                    update_seen_register(seen_register, uid_str, "skipped_duplicate", subject, dn_number, invoice_no)
                continue

            if not dry_run:
                try:
                    append_row_to_sheet(
                        sheet,
                        today,
                        subject,
                        amount or "",
                        dn_number,
                        reason_text or "",
                        invoice_no or "",
                    )
                except Exception as exc:
                    log.error("  Sheets write failed: %s - skipping.", exc)
                    continue

                existing_keys.add(duplicate_key)
                existing_dns.add(normalized_dn)
                batch_keys.add(duplicate_key)
                batch_dns.add(normalized_dn)
                update_seen_register(seen_register, uid_str, "appended", subject, dn_number, invoice_no)
                appended_items.append(
                    {
                        "uid": item["uid"],
                        "uid_str": uid_str,
                        "subject": subject,
                        "message": item.get("message"),
                        "dn_number": dn_number or "",
                        "invoice_no": invoice_no or "",
                        "reason_text": reason_text or "",
                        "amount": amount or "",
                    }
                )
            else:
                log.info(
                    "  [DRY RUN] Would APPEND: [%s, %s, %s, %s, '', '', %s, %s]",
                    today,
                    subject,
                    amount or "",
                    dn_number,
                    reason_text or "",
                    invoice_no or "",
                )

            processed += 1
            log.info("  OK Email UID %s processed successfully.", uid_str)

        if not dry_run:
            save_seen_register(seen_register)
            try:
                forwarded = forward_emails_with_attachments(appended_items)
            except Exception as exc:
                log.error("Forwarding appended emails failed: %s", exc)

        log.info(
            "Summary: %d appended, %d no-DN skipped, %d duplicates skipped, %d forwarded.",
            processed,
            skipped_no_dn,
            skipped_dupes,
            forwarded,
        )

    except imaplib.IMAP4.error as exc:
        log.critical("IMAP error: %s", exc)
    except FileNotFoundError as exc:
        log.critical("File not found: %s", exc)
    except SpreadsheetNotFound:
        log.critical(
            "Spreadsheet ID '%s' not found in your Google Drive. "
            "Check the ID or share it with your account.",
            SPREADSHEET_ID,
        )
    except Exception as exc:
        log.critical("Unexpected error: %s", exc, exc_info=True)
    finally:
        if conn:
            try:
                conn.logout()
                log.info("IMAP connection closed.")
            except Exception:
                pass

    return processed


if __name__ == "__main__":
    _setup_scootsy_logging()

    parser = argparse.ArgumentParser(
        description="GRN & Purchase Return Email Processor"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview extracted data without pushing to Sheets or marking as read.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Max number of emails to process (0 = all). Useful for testing.",
    )
    args = parser.parse_args()

    log.info("=== GRN Email Processor started ===")
    count = process_emails(dry_run=args.dry_run, limit=args.limit)
    log.info("=== Done. %d email(s) processed. ===", count)
    sys.exit(0 if count >= 0 else 1)
