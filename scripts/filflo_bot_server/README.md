# Filflo Bot

Automated logistics management for the Filflo B2B portal — handles PO delivery verification, POD uploads, status tracking, and report generation via Selenium browser automation.

## What It Does

Filflo Bot reads a task list from an Excel workbook (`Filflo_Tasks.xlsx`), logs into the Filflo B2B portal, and processes each Purchase Order: verifying deliveries, entering dates, uploading Proof of Delivery files, and writing results back to Excel. It can run in batch mode (process all pending POs), single-PO mode, or through a conversational chat interface powered by an LLM.

## Project Structure

```
Filflo_Bot/
├── filflo_combined_bot_v3.py   # Core Selenium automation (login, search, forms, POD upload)
├── filflo_chat.py              # Conversational interface (LLM + tool calling)
├── filflo_config.py            # Centralized configuration & env var loading
├── po_status.py                # POStatus enum — single source of truth for all statuses
├── excel_utils.py              # Excel read/write helpers with FileLock
├── multi_agent_runner.py       # Parallel PO processing with ThreadPoolExecutor
├── bot_monitor.py              # Monitoring dashboard & email alerting
├── retry_utils.py              # Exponential backoff decorator & helpers
├── llm_engine.py               # LLM API integration (Groq / OpenAI)
├── tool_registry.py            # Wraps bot functions as LLM-callable tools
├── data_feeder.py              # Imports delivery dates from Google Sheet → Excel
├── pod_feeder.py               # Matches POD files to tracking IDs in Excel
├── patch_bot_v3.py             # Unicode encoding fix for Windows terminals
├── push_to_gsheet.py           # Pushes results back to Google Sheets
├── tests/                      # pytest test suite (190+ tests)
│   ├── test_po_status.py       # Status enum, is_row_done, categorize_result
│   ├── test_excel_utils.py     # PO normalization, date parsing, POD file matching
│   ├── test_validators.py      # Input validation (PO number, tracking ID, POD file)
│   ├── test_bot_monitor.py     # Monitoring & alerting
│   ├── test_retry_utils.py     # Exponential backoff
│   └── test_smoke.py           # Compilation, imports, config validation
├── .env.example                # Template for environment variables
├── .gitignore                  # Excludes .env, credentials, logs, POD_FILES
└── ARCHITECTURE.md             # NLP chat bridge architecture guide
```

## Setup

### 1. Install Python Dependencies

```cmd
pip install -r requirements.txt
```

Key dependencies: `selenium`, `openpyxl`, `filelock`, `python-dotenv`, `groq` (for chat interface).

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```cmd
copy .env.example .env
```

Required variables:

| Variable | Description |
|----------|-------------|
| `FILFLO_LOGIN_EMAIL` | Your Filflo portal login email |
| `FILFLO_LOGIN_PASSWORD` | Your Filflo portal password |

Optional variables:

| Variable | Description |
|----------|-------------|
| `FILFLO_GMAIL_SENDER` | Gmail address for sending reports/alerts |
| `FILFLO_GMAIL_APP_PASSWORD` | Gmail App Password (not your regular password) |
| `FILFLO_EMAIL_RECIPIENT` | Email to receive reports and failure alerts |
| `GROQ_API_KEY` | Free API key from console.groq.com (for chat) |
| `OPENAI_API_KEY` | OpenAI key (alternative to Groq) |

### 3. Chrome WebDriver

The bot uses Selenium with Chrome. Ensure Chrome is installed and `chromedriver` is on your PATH or in the bot folder.

### 4. Prepare the Excel File

Place `Filflo_Tasks.xlsx` in the bot folder with these columns:

| Column | Content |
|--------|---------|
| A | PO Number |
| B | Order Type |
| C | Delivery Date |
| D | Tracking ID (for POD matching) |
| E | Status (written by bot) |

### 5. POD Files

Place Proof of Delivery files in the `POD_FILES/` folder, named by tracking ID (e.g., `6001029489.jpg`). Supported formats: JPG, JPEG, PNG, PDF, TIFF, BMP, GIF.

## Usage

### Batch Mode (process all pending POs)

```cmd
python filflo_combined_bot_v3.py
```

### Parallel Processing (multiple browser workers)

```cmd
python multi_agent_runner.py
```

### Chat Interface (natural language)

```cmd
python filflo_chat.py
```

Supports Hindi and English. Quick commands: `status`, `pending`, `logs`, `pods`, `help`. Or talk naturally — the LLM will figure out which tool to call.

### Data Feeders

```cmd
python data_feeder.py          # Import delivery dates from Google Sheet
python pod_feeder.py           # Match POD files to tracking IDs
python instamart_data_feeder.py
python instamart_push_to_gsheet.py
```

### Instamart PO Booking

The Instamart booking browser automation remains isolated in [instamart-playwright-bot/README.md](/C:/Users/lenovo/Desktop/Filflo_Bot/instamart-playwright-bot/README.md).
The current flow is:

1. `python instamart_data_feeder.py`
2. `npm.cmd run book-instamart`
3. `python instamart_push_to_gsheet.py`

## Running Tests

```cmd
pytest tests/ -v
```

The test suite covers PO status logic, Excel utilities (normalization, date parsing, POD file matching), input validators, monitoring, retry logic, and smoke tests (compilation, imports, config).

## Monitoring & Alerts

The `BotMonitor` class tracks PO processing metrics and sends email alerts when consecutive failures reach a threshold (default: 3). Use it in your processing loop:

```python
from bot_monitor import BotMonitor
monitor = BotMonitor(logger=logger, alert_threshold=3)

# After each PO:
monitor.record("PO-123", success=True, duration_sec=12.5)

# View dashboard:
print(monitor.dashboard())
```

## Retry Resilience

Use `retry_with_backoff` for flaky portal interactions:

```python
from retry_utils import retry_with_backoff

@retry_with_backoff(max_retries=3, base_delay=2.0, exceptions=(TimeoutError,))
def click_save_button(driver):
    ...
```

## Other Bot Variants

The repository also contains automation for other portals:

| File | Portal | Purpose |
|------|--------|---------|
| `blinkit_appointment_booker.py` | Blinkit | Appointment booking automation |
| `instamart_data_feeder.py` | Instamart | Python fetch from trackers into `Data.xlsx` |
| `instamart-playwright-bot/` | Instamart | Isolated Playwright-based PO booking bot |
| `instamart_push_to_gsheet.py` | Instamart | Python push from `Data.xlsx` back to trackers |
| `scootsy_DN_updation.py` | Scootsy | Delivery note updates |
| `cleanup_sheet.py` | — | Excel cleanup utility |

## Key Design Decisions

1. **Zero changes to v3** — The NLP chat bridge imports and calls v3's existing functions without modifying the core bot.
2. **POStatus enum** — All 20+ status strings centralized in `po_status.py` to prevent typos and enable property-based checks (`is_verified`, `is_terminal`, etc.).
3. **FileLock for Excel** — Prevents data corruption when multiple workers write to the same workbook.
4. **Exponential backoff** — Prevents hammering the portal during transient failures.
5. **Email alerts** — Automatic notification on consecutive failures with cooldown to prevent spam.
