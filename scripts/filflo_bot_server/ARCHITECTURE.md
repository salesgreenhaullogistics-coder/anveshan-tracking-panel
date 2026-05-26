# Filflo Bot — NLP Bridge Architecture Guide

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                   filflo_chat.py                        │
│              (Main Conversational Loop)                  │
│                                                         │
│   User Input ──→ Quick Commands? ──→ Direct Response    │
│        │                                                │
│        ▼ (if not quick command)                         │
│   ┌─────────────┐    ┌──────────────────┐              │
│   │ LLM Engine  │───→│  Tool Registry   │              │
│   │(llm_engine) │    │(tool_registry.py)│              │
│   │             │    │                  │              │
│   │ Groq/OpenAI │    │ 9 Registered     │              │
│   │ Tool Calling│    │ Tools wrapping   │              │
│   │             │    │ v3 functions     │              │
│   └──────┬──────┘    └────────┬─────────┘              │
│          │                    │                         │
│          │    ┌───────────────┘                         │
│          │    ▼                                         │
│          │  ┌──────────────────────────────┐           │
│          │  │ filflo_combined_bot_v3.py    │           │
│          │  │ (UNTOUCHED — all 2347 lines) │           │
│          │  │                              │           │
│          │  │ • Selenium automation        │           │
│          │  │ • Excel read/write           │           │
│          │  │ • POD file matching          │           │
│          │  │ • Login, search, forms       │           │
│          │  │ • Download + email           │           │
│          │  └──────────────────────────────┘           │
│          │                                              │
└─────────────────────────────────────────────────────────┘
```

## File Structure (New Files Only)

```
Filflo_Bot/
├── filflo_combined_bot_v3.py    ← UNTOUCHED (your original)
├── filflo_chat.py               ← NEW: Main entry point
├── llm_engine.py                ← NEW: LLM API + intent classification
├── tool_registry.py             ← NEW: Wraps v3 functions as tools
├── requirements_chat.txt        ← NEW: Additional pip dependencies
├── setup_chat.bat               ← NEW: One-click setup
├── START_CHAT.bat               ← NEW: One-click launcher
└── .env                         ← YOU CREATE: API keys
```

## Setup (3 Steps)

### Step 1: Install dependencies
```cmd
pip install groq openai
```

### Step 2: Get FREE Groq API Key
1. Go to https://console.groq.com/keys
2. Sign up (free, no credit card)
3. Create an API key (starts with `gsk_`)

### Step 3: Set environment variable
```cmd
:: Windows CMD (temporary)
set GROQ_API_KEY=gsk_your_key_here

:: Windows CMD (permanent)
setx GROQ_API_KEY "gsk_your_key_here"

:: PowerShell
$env:GROQ_API_KEY="gsk_your_key_here"
```

### Alternative: OpenAI Backend
```cmd
set OPENAI_API_KEY=sk-your_key_here
set FILFLO_LLM_BACKEND=openai
```

## Usage

```cmd
python filflo_chat.py
```

Or double-click `START_CHAT.bat`.

## Registered Tools (9 Total)

| # | Tool Name | Type | What It Does |
|---|-----------|------|-------------|
| 1 | process_pending | ACTION | Run bot on all pending POs |
| 2 | process_single_po | ACTION | Process one specific PO |
| 3 | download_report | ACTION | Download CSV + email to Nandlal |
| 4 | get_status_summary | READ | Excel summary (verified/failed/pending) |
| 5 | get_po_status | READ | Status of one specific PO |
| 6 | get_pending_count | READ | How many POs ready to process |
| 7 | get_todays_log_summary | READ | Parse log file for activity stats |
| 8 | list_pod_files | READ | Count POD files waiting + uploaded |
| 9 | reset_statuses | ACTION | Clear status column (all or filtered) |

ACTION tools require user confirmation before executing.

## How Intent Classification Works

The LLM receives all 9 tool schemas as OpenAI-compatible function definitions.
When you type a message, the LLM decides:
- Is this a tool call? → Execute the tool, feed result back, get natural summary
- Is this just conversation? → Reply directly

### Example Flow

```
You > "Nandlal ko last year ka report mail kar do"
   ↓
LLM sees: Hindi text about report + email + Nandlal
LLM decides: tool_call → download_report(recipient_email="nandlal@anveshan.farm")
   ↓
Chat asks: "Confirm? (y/n)"
You > y
   ↓
tool_registry executes: v3.do_download_order_dump(logger)
   ↓
Result fed back to LLM
   ↓
LLM replies: "Report download ho gaya aur nandlal@anveshan.farm ko mail bhi ho gayi!"
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| GROQ_API_KEY | Yes* | — | Groq API key (free) |
| OPENAI_API_KEY | Yes* | — | OpenAI key (alternative) |
| FILFLO_LLM_BACKEND | No | groq | "groq" or "openai" |
| GROQ_MODEL | No | llama-3.3-70b-versatile | Groq model name |
| OPENAI_MODEL | No | gpt-4o-mini | OpenAI model name |

*One of GROQ_API_KEY or OPENAI_API_KEY is required.

## Key Design Decisions

1. **ZERO changes to v3** — All 2347 lines untouched. The NLP bridge imports and calls v3's functions.

2. **Groq as default** — Free tier, fast inference, supports tool calling with Llama 3.3 70B.

3. **Confirmation for destructive actions** — process_pending, process_single_po, download_report, and reset_statuses all require explicit "y" before executing.

4. **Quick commands bypass LLM** — Typing "status", "pending", "logs", "pods" gets instant results without an API call.

5. **Conversation history** — The LLM remembers context (trimmed to last 25 turns) so you can have follow-up conversations.
