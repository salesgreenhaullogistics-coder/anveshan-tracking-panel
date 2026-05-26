"""
╔══════════════════════════════════════════════════════════════════╗
║  Multi-Agent Parallel Runner — Filflo Bot v4                     ║
║                                                                  ║
║  Pre-classifies pending POs into scenario buckets, then spawns   ║
║  multiple Chrome workers to process them in PARALLEL.            ║
║                                                                  ║
║  Architecture:                                                   ║
║    1. READ phase   — Read all pending entries from Excel (once)  ║
║    2. CLASSIFY     — Sort into Scenario A/B/C/D/P buckets       ║
║    3. DISTRIBUTE   — Round-robin assign POs to N workers        ║
║    4. EXECUTE      — Each worker gets its own Chrome browser     ║
║    5. AGGREGATE    — Collect results, print summary              ║
║                                                                  ║
║  Concurrency safety:                                             ║
║    • Excel writes use FileLock (same lock as v3)                 ║
║    • POD files use atomic claim (rename to .claimed) to prevent  ║
║      two workers picking the same file                           ║
║    • Each worker has its own Selenium driver (no sharing)        ║
║                                                                  ║
║  Usage:                                                          ║
║    python multi_agent_runner.py                                  ║
║    python multi_agent_runner.py --workers 4                      ║
║    python multi_agent_runner.py --workers 3 --once               ║
║    python multi_agent_runner.py --dry-run                        ║
╚══════════════════════════════════════════════════════════════════╝
"""

import os
import sys
import time
import logging
import argparse
import threading
import shutil
from pathlib import Path
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import defaultdict

# ── Import v3 functions (UNTOUCHED — we only call them) ──────────────────
import filflo_combined_bot_v3 as v3
from po_status import POStatus, categorize_result
from filflo_monitor_bus import attach_monitor_handler

# ── Re-use v3 config ─────────────────────────────────────────────────────
BOT_FOLDER      = v3.BOT_FOLDER
DEFAULT_EXCEL   = v3.DEFAULT_EXCEL_PATH
POD_FOLDER      = v3.POD_FOLDER
POD_DONE_FOLDER = v3.POD_DONE_FOLDER
LOG_DIR         = v3.LOG_DIR

# Default number of parallel Chrome workers
DEFAULT_WORKERS = 3
MAX_WORKERS     = 6   # safety cap — more than 6 Chrome instances = heavy on RAM

# ═══════════════════════════════════════════════════════════════════════════════
#  LOGGING (per-worker + main)
# ═══════════════════════════════════════════════════════════════════════════════

def setup_main_logger() -> logging.Logger:
    """Create the main orchestrator logger."""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_file = LOG_DIR / f"multi_agent_{datetime.now():%Y%m%d_%H%M%S}.log"

    logger = logging.getLogger("MultiAgent")
    logger.setLevel(logging.DEBUG)

    # Prevent duplicate handlers on re-import
    if logger.handlers:
        attach_monitor_handler(logger, source="multi_agent")
        return logger

    fh = logging.FileHandler(log_file, encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(logging.Formatter(
        "%(asctime)s | %(levelname)-8s | [MAIN] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    ))

    ch = logging.StreamHandler(sys.stdout)
    ch.setLevel(logging.INFO)
    ch.setFormatter(logging.Formatter(
        "%(asctime)s | %(levelname)-8s | [MAIN] %(message)s",
        datefmt="%H:%M:%S"
    ))

    logger.addHandler(fh)
    logger.addHandler(ch)
    attach_monitor_handler(logger, source="multi_agent")
    return logger


def setup_worker_logger(worker_id: int) -> logging.Logger:
    """Create a per-worker logger with unique name and file."""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_file = LOG_DIR / f"worker_{worker_id}_{datetime.now():%Y%m%d_%H%M%S}.log"

    logger_name = f"Worker-{worker_id}"
    logger = logging.getLogger(logger_name)
    logger.setLevel(logging.DEBUG)

    if logger.handlers:
        attach_monitor_handler(logger, source=f"worker_{worker_id}")
        return logger

    fh = logging.FileHandler(log_file, encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(logging.Formatter(
        f"%(asctime)s | %(levelname)-8s | [W{worker_id}] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    ))

    ch = logging.StreamHandler(sys.stdout)
    ch.setLevel(logging.INFO)
    ch.setFormatter(logging.Formatter(
        f"%(asctime)s | %(levelname)-8s | [W{worker_id}] %(message)s",
        datefmt="%H:%M:%S"
    ))

    logger.addHandler(fh)
    logger.addHandler(ch)
    attach_monitor_handler(logger, source=f"worker_{worker_id}")
    return logger


# ═══════════════════════════════════════════════════════════════════════════════
#  PHASE 1: READ — Read all pending entries from Excel (single read, thread-safe)
# ═══════════════════════════════════════════════════════════════════════════════

def read_all_pending(excel_path: Path, logger) -> list:
    """
    Read all pending entries from Excel using v3's lock-safe function.
    Returns list of entry dicts: {row, po_number, order_type, delivery_date, tracking_id, status}
    """
    v3.ensure_excel_headers(excel_path, logger)
    entries = v3.read_pending_entries(excel_path, logger)
    logger.info(f"Total pending entries from Excel: {len(entries)}")
    return entries


# ═══════════════════════════════════════════════════════════════════════════════
#  PHASE 2: CLASSIFY — Sort entries into scenario buckets
# ═══════════════════════════════════════════════════════════════════════════════

# Scenario definitions (same logic as v3.process_single_po):
#   SCENARIO_A  = Delivery date + Tracking ID + POD file   → Delivery + POD in one form
#   SCENARIO_D  = Delivery date + NO Tracking ID            → Delivery date only
#   SCENARIO_P  = NO delivery date + Tracking ID + POD file → POD-only upload (direct)
#   SCENARIO_B  = Delivery already done + POD pending + POD file → POD-only upload
#   SKIP        = No date, no tracking/POD, or already done

SCENARIO_A = "A_delivery_and_pod"
SCENARIO_D = "D_delivery_only"
SCENARIO_P = "P_pod_direct"
SCENARIO_B = "B_pod_after_delivery"
SKIP       = "SKIP"


def classify_entry(entry: dict, logger) -> str:
    """
    Classify a single entry into a scenario bucket.
    Uses EXACT same logic as v3.process_single_po to ensure 100% accuracy.
    """
    current_status = entry["status"] or ""

    # ── Check what's already done ──────────────────────────────────────────
    delivery_already_done = any(k in current_status for k in (
        "VERIFIED - Delivery", "Delivery Done", "Delivery + POD Done"
    ))
    pod_already_done = any(k in current_status for k in (
        "POD Done", "Delivery + POD Done", "POD Uploaded"
    ))

    # Fully done
    if delivery_already_done and pod_already_done:
        return SKIP

    # Parse delivery date
    delivery_date = None
    if entry["delivery_date"]:
        try:
            delivery_date = v3.parse_delivery_date(entry["delivery_date"])
        except (ValueError, TypeError):
            delivery_date = None

    # Check POD file existence
    has_tracking = bool(entry["tracking_id"])
    pod_file = v3.find_pod_file(POD_FOLDER, entry["tracking_id"], logger) if has_tracking else None

    # ── Scenario P: No date, has tracking + POD file → direct POD upload ──
    if not delivery_date and has_tracking and pod_file:
        return SCENARIO_P

    # ── Scenario B: Delivery done, POD pending + POD file available ───────
    if delivery_already_done and not pod_already_done:
        if pod_file:
            return SCENARIO_B
        else:
            return SKIP  # delivery done, no POD file yet

    # ── Scenario D: Has date, no tracking ID → delivery-only ─────────────
    if delivery_date and not has_tracking:
        return SCENARIO_D

    # ── Scenario A: Has date + tracking → delivery + optional POD ─────────
    if delivery_date:
        return SCENARIO_A

    # ── Nothing actionable ────────────────────────────────────────────────
    return SKIP


def classify_all(entries: list, logger) -> dict:
    """
    Classify all entries and return a dict of {scenario: [entries]}.
    Also logs the distribution.
    """
    buckets = defaultdict(list)

    for entry in entries:
        scenario = classify_entry(entry, logger)
        # Store the scenario tag on the entry itself for later reference
        entry["_scenario"] = scenario
        buckets[scenario].append(entry)

    # Log distribution
    logger.info("=" * 60)
    logger.info("CLASSIFICATION RESULTS")
    logger.info("=" * 60)
    for scenario in [SCENARIO_A, SCENARIO_D, SCENARIO_P, SCENARIO_B, SKIP]:
        count = len(buckets.get(scenario, []))
        if count > 0:
            logger.info(f"  {scenario:<30} : {count} PO(s)")
    logger.info("=" * 60)

    actionable = sum(len(buckets[s]) for s in [SCENARIO_A, SCENARIO_D, SCENARIO_P, SCENARIO_B])
    skipped = len(buckets.get(SKIP, []))
    logger.info(f"  ACTIONABLE: {actionable}  |  SKIPPED: {skipped}")
    logger.info("=" * 60)

    return dict(buckets)


# ═══════════════════════════════════════════════════════════════════════════════
#  POD FILE CLAIM SYSTEM — Prevents two workers from picking the same POD
# ═══════════════════════════════════════════════════════════════════════════════

_pod_claim_lock = threading.Lock()
_claimed_pods = set()  # set of tracking IDs that have been claimed


def claim_pod_file(tracking_id: str, logger) -> bool:
    """
    Atomically claim a POD file for a specific tracking ID.
    Returns True if this worker successfully claimed it, False if already claimed.
    """
    if not tracking_id:
        return True  # no POD to claim

    with _pod_claim_lock:
        if tracking_id in _claimed_pods:
            logger.warning(f"POD for tracking '{tracking_id}' already claimed by another worker.")
            return False
        _claimed_pods.add(tracking_id)
        return True


def release_pod_claim(tracking_id: str):
    """Release a POD claim (e.g., if processing failed and we want to retry)."""
    if not tracking_id:
        return
    with _pod_claim_lock:
        _claimed_pods.discard(tracking_id)


# ═══════════════════════════════════════════════════════════════════════════════
#  PHASE 3: DISTRIBUTE — Assign POs to workers (round-robin, scenario-aware)
# ═══════════════════════════════════════════════════════════════════════════════

def distribute_to_workers(buckets: dict, num_workers: int, logger) -> list:
    """
    Distribute actionable entries across N workers.

    Strategy:
    - Merge all actionable entries into a single ordered list
    - Order: Scenario P first (fastest — just POD upload, no date entry)
             Scenario D second (delivery-only — no POD upload wait)
             Scenario B third (POD-only — delivery already done)
             Scenario A last (most complex — delivery + POD)
    - Round-robin distribute to workers for even load

    Returns: list of lists, where worker_queues[i] = entries for worker i
    """
    # Priority order: fastest tasks first so workers finish sooner and can help
    priority_order = [SCENARIO_P, SCENARIO_D, SCENARIO_B, SCENARIO_A]

    all_actionable = []
    for scenario in priority_order:
        all_actionable.extend(buckets.get(scenario, []))

    if not all_actionable:
        logger.info("No actionable entries to distribute.")
        return [[] for _ in range(num_workers)]

    # Adjust worker count if we have fewer POs than workers
    effective_workers = min(num_workers, len(all_actionable))
    if effective_workers < num_workers:
        logger.info(f"Only {len(all_actionable)} PO(s) — using {effective_workers} worker(s) instead of {num_workers}.")

    worker_queues = [[] for _ in range(effective_workers)]

    # Round-robin assignment
    for idx, entry in enumerate(all_actionable):
        worker_idx = idx % effective_workers
        worker_queues[worker_idx].append(entry)

    # Log distribution
    logger.info("WORKER DISTRIBUTION")
    logger.info("-" * 40)
    for w_idx, queue in enumerate(worker_queues):
        scenarios_in_queue = defaultdict(int)
        for e in queue:
            scenarios_in_queue[e["_scenario"]] += 1
        breakdown = ", ".join(f"{s}: {c}" for s, c in scenarios_in_queue.items())
        logger.info(f"  Worker {w_idx + 1}: {len(queue)} PO(s) [{breakdown}]")
    logger.info("-" * 40)

    return worker_queues


# ═══════════════════════════════════════════════════════════════════════════════
#  PHASE 4: WORKER — Each worker processes its assigned POs sequentially
# ═══════════════════════════════════════════════════════════════════════════════

def worker_process(worker_id: int, entries: list, excel_path: Path) -> dict:
    """
    A single worker thread: opens its own Chrome browser, logs in,
    and processes all assigned POs sequentially.

    Returns a summary dict: {verified, unverified, skipped, failed, results: [(po, result)]}
    """
    logger = setup_worker_logger(worker_id)
    logger.info(f"Worker {worker_id} starting — {len(entries)} PO(s) to process.")

    summary = {
        "worker_id": worker_id,
        "total": len(entries),
        "verified": 0,
        "unverified": 0,
        "skipped": 0,
        "failed": 0,
        "results": [],
    }

    if not entries:
        logger.info(f"Worker {worker_id}: No entries assigned. Exiting.")
        return summary

    driver = None
    try:
        # ── Launch Chrome ──────────────────────────────────────────────────
        driver = v3.create_driver(logger)
        logger.info(f"Worker {worker_id}: Chrome browser launched.")

        # ── Login ──────────────────────────────────────────────────────────
        if not v3.login(driver, logger):
            logger.error(f"Worker {worker_id}: Login FAILED. Aborting.")
            summary["failed"] = len(entries)
            return summary

        # ── Apply 'All Time' filter ────────────────────────────────────────
        v3.apply_all_time_filter(driver, logger)

        # ── Process each PO ────────────────────────────────────────────────
        for i, entry in enumerate(entries, 1):
            po = entry["po_number"]
            scenario = entry.get("_scenario", "unknown")
            tracking_id = entry.get("tracking_id", "")

            logger.info(f"\n{'=' * 55}")
            logger.info(f"Worker {worker_id} | PO {i}/{len(entries)}: {po} [{scenario}]")
            logger.info(f"{'=' * 55}")

            # ── Browser health check ────────────────────────────────────────
            try:
                _ = driver.title  # throws WebDriverException if browser crashed
            except Exception:
                logger.error(f"Worker {worker_id}: Browser crashed! Relaunching...")
                try:
                    driver.quit()
                except Exception:
                    pass
                try:
                    driver = v3.create_driver(logger)
                    if not v3.login(driver, logger):
                        logger.error(f"Worker {worker_id}: Re-login failed. Aborting remaining POs.")
                        remaining = len(entries) - i + 1
                        summary["failed"] += remaining
                        for j in range(i - 1, len(entries)):
                            summary["results"].append((entries[j]["po_number"], POStatus.FAILED_BROWSER_RELOGIN.value))
                        break
                    v3.apply_all_time_filter(driver, logger)
                except Exception as e2:
                    logger.error(f"Worker {worker_id}: Could not relaunch browser: {e2}")
                    remaining = len(entries) - i + 1
                    summary["failed"] += remaining
                    for j in range(i - 1, len(entries)):
                        summary["results"].append((entries[j]["po_number"], POStatus.FAILED_BROWSER_CRASH.value))
                    driver = None
                    break

            # ── Claim POD file (if applicable) ─────────────────────────────
            needs_pod = scenario in (SCENARIO_A, SCENARIO_B, SCENARIO_P)
            if needs_pod and tracking_id:
                if not claim_pod_file(tracking_id, logger):
                    logger.warning(f"PO {po}: POD already claimed. Skipping.")
                    summary["skipped"] += 1
                    summary["results"].append((po, POStatus.SKIPPED_POD_CLAIMED.value))
                    continue

            # ── Process using v3's existing function (with retry) ──────────
            try:
                result = v3.process_single_po_with_retry(driver, entry, excel_path, logger)
            except Exception as e:
                logger.error(f"PO {po}: Unhandled exception: {e}", exc_info=True)
                result = f"FAILED - Exception: {e}"

            # ── Categorize result ──────────────────────────────────────────
            category = categorize_result(result)
            if category == "verified":
                summary["verified"] += 1
            elif category == "unverified":
                summary["unverified"] += 1
            elif category == "skipped":
                summary["skipped"] += 1
            else:
                summary["failed"] += 1

            summary["results"].append((po, result))

            # Always release POD claim after processing (success or failure)
            if needs_pod and tracking_id:
                release_pod_claim(tracking_id)

            # Small delay between POs (per worker)
            if i < len(entries):
                time.sleep(1)

    except Exception as e:
        logger.error(f"Worker {worker_id}: Critical error: {e}", exc_info=True)
    finally:
        if driver:
            try:
                driver.quit()
                logger.info(f"Worker {worker_id}: Chrome browser closed.")
            except Exception:
                pass

    logger.info(f"Worker {worker_id} DONE — V:{summary['verified']} "
                f"U:{summary['unverified']} S:{summary['skipped']} F:{summary['failed']}")
    return summary


# ═══════════════════════════════════════════════════════════════════════════════
#  PHASE 5: ORCHESTRATOR — Run the full pipeline
# ═══════════════════════════════════════════════════════════════════════════════

def run_multi_agent(
    excel_path: Path = None,
    num_workers: int = DEFAULT_WORKERS,
    dry_run: bool = False,
) -> dict:
    """
    Main orchestrator:
      1. Read pending entries from Excel
      2. Classify into scenario buckets
      3. Distribute across workers
      4. Launch parallel Chrome workers
      5. Aggregate and report results
    """
    if excel_path is None:
        excel_path = DEFAULT_EXCEL

    logger = setup_main_logger()

    # Clamp worker count
    num_workers = max(1, min(num_workers, MAX_WORKERS))

    logger.info("╔════════════════════════════════════════════════════════╗")
    logger.info("║     FILFLO MULTI-AGENT PARALLEL RUNNER                ║")
    logger.info("╚════════════════════════════════════════════════════════╝")
    logger.info(f"Workers requested: {num_workers}")
    logger.info(f"Excel: {excel_path}")
    logger.info(f"POD folder: {POD_FOLDER}")
    logger.info(f"Time: {datetime.now():%Y-%m-%d %H:%M:%S}")
    logger.info("")

    start_time = time.time()

    # ── Phase 1: Read ─────────────────────────────────────────────────────
    logger.info("PHASE 1: Reading pending entries from Excel...")
    entries = read_all_pending(excel_path, logger)

    if not entries:
        logger.info("No pending entries found. Nothing to do.")
        return {"total": 0, "verified": 0, "unverified": 0, "skipped": 0, "failed": 0}

    # ── Phase 2: Classify ─────────────────────────────────────────────────
    logger.info("PHASE 2: Classifying entries into scenario buckets...")
    buckets = classify_all(entries, logger)

    # ── Phase 3: Distribute ───────────────────────────────────────────────
    logger.info(f"PHASE 3: Distributing POs across {num_workers} worker(s)...")
    worker_queues = distribute_to_workers(buckets, num_workers, logger)

    # Filter out empty queues
    active_queues = [(i, q) for i, q in enumerate(worker_queues) if q]

    if not active_queues:
        logger.info("No actionable POs after distribution. All skipped or done.")
        return {"total": len(entries), "verified": 0, "unverified": 0, "skipped": len(entries), "failed": 0}

    # ── Dry run: just show what would happen ──────────────────────────────
    if dry_run:
        logger.info("DRY RUN — No browsers will be launched.")
        logger.info("")
        for w_idx, queue in active_queues:
            logger.info(f"Worker {w_idx + 1} would process:")
            for e in queue:
                logger.info(f"  PO: {e['po_number']:<35} [{e['_scenario']}]")
        return {"total": len(entries), "dry_run": True}

    # ── Phase 4: Execute in parallel ──────────────────────────────────────
    logger.info(f"PHASE 4: Launching {len(active_queues)} worker(s) in parallel...")
    logger.info("=" * 60)

    all_summaries = []

    with ThreadPoolExecutor(max_workers=len(active_queues)) as executor:
        futures = {}
        for w_idx, queue in active_queues:
            worker_id = w_idx + 1  # 1-indexed for display
            future = executor.submit(worker_process, worker_id, queue, excel_path)
            futures[future] = worker_id

        for future in as_completed(futures):
            worker_id = futures[future]
            try:
                summary = future.result()
                all_summaries.append(summary)
                logger.info(f"Worker {worker_id} completed: V:{summary['verified']} "
                            f"U:{summary['unverified']} S:{summary['skipped']} F:{summary['failed']}")
            except Exception as e:
                logger.error(f"Worker {worker_id} raised exception: {e}", exc_info=True)
                all_summaries.append({
                    "worker_id": worker_id,
                    "total": 0,
                    "verified": 0,
                    "unverified": 0,
                    "skipped": 0,
                    "failed": 0,
                    "results": [],
                })

    # ── Phase 5: Aggregate ────────────────────────────────────────────────
    elapsed = time.time() - start_time
    total_summary = {
        "total": len(entries),
        "verified": sum(s["verified"] for s in all_summaries),
        "unverified": sum(s["unverified"] for s in all_summaries),
        "skipped": sum(s["skipped"] for s in all_summaries) + len(buckets.get(SKIP, [])),
        "failed": sum(s["failed"] for s in all_summaries),
        "elapsed_seconds": round(elapsed, 1),
        "workers_used": len(active_queues),
    }

    # Print final report
    logger.info("")
    logger.info("╔════════════════════════════════════════════════════════╗")
    logger.info("║               FINAL RESULTS                           ║")
    logger.info("╚════════════════════════════════════════════════════════╝")

    # Per-worker breakdown
    for s in sorted(all_summaries, key=lambda x: x["worker_id"]):
        logger.info(f"  Worker {s['worker_id']}:")
        for po, result in s["results"]:
            logger.info(f"    {po:<40} → {result}")

    logger.info("")
    logger.info("─" * 55)
    logger.info(f"  Total POs:    {total_summary['total']}")
    logger.info(f"  Verified:     {total_summary['verified']}")
    logger.info(f"  Unverified:   {total_summary['unverified']}")
    logger.info(f"  Skipped:      {total_summary['skipped']}")
    logger.info(f"  Failed:       {total_summary['failed']}")
    logger.info(f"  Workers used: {total_summary['workers_used']}")
    logger.info(f"  Time elapsed: {elapsed:.1f}s ({elapsed/60:.1f} min)")
    logger.info("─" * 55)

    # Comparison estimate
    actionable_count = total_summary['verified'] + total_summary['unverified'] + total_summary['failed']
    if actionable_count > 0 and total_summary['workers_used'] > 1:
        est_serial = actionable_count * 45  # ~45s per PO in serial mode (conservative)
        speedup = est_serial / elapsed if elapsed > 0 else 1
        logger.info(f"  Estimated serial time: ~{est_serial/60:.1f} min")
        logger.info(f"  Speedup:              ~{speedup:.1f}x faster")
        logger.info("─" * 55)

    return total_summary


# ═══════════════════════════════════════════════════════════════════════════════
#  CLI ENTRY POINT
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="Filflo Multi-Agent Parallel Runner — Process POs with multiple Chrome workers"
    )
    parser.add_argument(
        "--workers", "-w",
        type=int,
        default=DEFAULT_WORKERS,
        help=f"Number of parallel Chrome workers (default: {DEFAULT_WORKERS}, max: {MAX_WORKERS})"
    )
    parser.add_argument(
        "--excel",
        type=str,
        default=str(DEFAULT_EXCEL),
        help="Path to Filflo_Tasks.xlsx"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview classification & distribution without launching browsers"
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run once and exit (no polling loop)"
    )

    args = parser.parse_args()

    summary = run_multi_agent(
        excel_path=Path(args.excel),
        num_workers=args.workers,
        dry_run=args.dry_run,
    )

    # Print summary for non-logging consumers
    print(f"\n{'═' * 55}")
    print(f"  Multi-Agent Run Complete")
    print(f"  Total: {summary.get('total', 0)}  |  Verified: {summary.get('verified', 0)}  "
          f"|  Failed: {summary.get('failed', 0)}")
    if 'elapsed_seconds' in summary:
        print(f"  Time: {summary['elapsed_seconds']}s  "
              f"|  Workers: {summary.get('workers_used', 1)}")
    print(f"{'═' * 55}\n")


if __name__ == "__main__":
    main()
