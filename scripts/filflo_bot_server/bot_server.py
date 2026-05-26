"""
Filflo Bot Runner — local control server for the Anveshan Command Center.
=========================================================================
These bots are Python/Selenium/Playwright automations: they drive a real
browser, so they CANNOT be triggered by a plain URL on their own. This tiny
server runs ON THE MACHINE WHERE THE BOTS LIVE and exposes each bot as an HTTP
endpoint the Command Center can call with one click — capturing live logs and
success/failure so errors surface for rework.

SETUP (one time, on the bot machine):
  1. Copy this file (bot_server.py) into your Filflo_Bot folder (next to
     filflo_combined_bot_v3.py etc.).
  2. Start it:   python bot_server.py        (or double-click START_BOT_SERVER.bat)
     No extra packages needed — it uses only the Python standard library.
     It listens on http://127.0.0.1:8765
  3. In the Command Center → Add Bot, for each bot below:
        Run URL : http://127.0.0.1:8765/run        (if panel runs on THIS machine)
        Method  : POST
        Payload : {"bot":"filflo_pod"}             (the id from BOTS, one per bot)
     To use the panel from another device, expose this server with a tunnel
     (cloudflared/ngrok) and use that https URL instead of 127.0.0.1.

The server runs jobs asynchronously and returns a job id + statusUrl; the
Command Center polls it until the bot finishes, then shows exit status + logs.
Add `?wait=1` (or payload {"wait":true}) to run synchronously instead.
"""
import os
import sys
import json
import uuid
import time
import threading
import subprocess
import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

BASE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable or "python"
PORT = int(os.environ.get("BOT_SERVER_PORT", "8765"))

# Make console output UTF-8 safe on Windows (cp1252 consoles choke on non-ASCII).
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# ---------------------------------------------------------------------------
# Self-contained Command Center UI served at "/" — no separate panel, no tunnel,
# no URL pasting. Talks to this server's own /bots, /run, /status (same origin).
# ---------------------------------------------------------------------------
INDEX_HTML = r"""<!doctype html><html><head><meta charset="utf-8"><title>Filflo Command Center</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;font-family:Segoe UI,Inter,system-ui,sans-serif}
body{margin:0;background:#f1f5f9;color:#0f172a}
.hdr{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;padding:16px 20px}
.hdr h1{margin:0;font-size:18px;display:flex;align-items:center;gap:8px}
.hdr p{margin:4px 0 0;font-size:12px;color:#e0e7ff}
.kpis{display:flex;gap:10px;margin-top:12px;flex-wrap:wrap}
.kpi{background:rgba(255,255,255,.12);border-radius:8px;padding:8px 14px;min-width:90px}
.kpi b{font-size:18px;display:block}.kpi span{font-size:10px;color:#e0e7ff}
.bar{padding:12px 20px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
button{cursor:pointer;border:0;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:700}
.run{background:#4f46e5;color:#fff}.runall{background:#059669;color:#fff}.retry{background:#dc2626;color:#fff}
.ghost{background:#e2e8f0;color:#475569}
.wrap{padding:0 20px 40px}
.cat{font-size:11px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.5px;margin:18px 0 8px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:12px}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px}
.card.ok{border-color:#a7f3d0}.card.err{border-color:#fecaca}.card.run{border-color:#bfdbfe}
.card h3{margin:0;font-size:13px;display:flex;align-items:center;gap:6px}
.dot{width:9px;height:9px;border-radius:50%;background:#cbd5e1;flex:0 0 auto}
.dot.ok{background:#10b981}.dot.err{background:#ef4444}.dot.run{background:#3b82f6;animation:pulse 1s infinite}
@keyframes pulse{50%{opacity:.4}}
.chip{font-size:9px;background:#eef2ff;color:#4f46e5;border-radius:4px;padding:2px 6px;margin-left:auto;font-family:monospace}
.desc{font-size:11px;color:#94a3b8;margin:4px 0}
.meta{font-size:10px;color:#94a3b8;margin:2px 0}
.msg{font-size:11px;border-radius:8px;padding:6px 9px;margin:8px 0}
.msg.ok{background:#ecfdf5;color:#047857}.msg.err{background:#fef2f2;color:#b91c1c;white-space:pre-wrap;max-height:160px;overflow:auto;font-family:monospace;font-size:10px}
.acts{display:flex;gap:6px;margin-top:8px}
.off{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;font-size:12px;padding:10px 14px;border-radius:10px;margin:12px 20px}
</style></head><body>
<div class="hdr"><h1>Filflo Command Center</h1><p>One-click bot orchestration · live status · captured errors for rework</p>
<div class="kpis"><div class="kpi"><b id="k-total">0</b><span>Total</span></div><div class="kpi"><b id="k-run">0</b><span>Running</span></div><div class="kpi"><b id="k-ok">0</b><span>Succeeded</span></div><div class="kpi"><b id="k-err">0</b><span>Failed</span></div></div></div>
<div class="bar"><button class="runall" onclick="runAll()">Run All</button><button class="retry" onclick="retryFailed()">Retry Failed</button><button class="ghost" onclick="loadBots()">Refresh list</button><span id="conn" style="font-size:11px;color:#64748b"></span></div>
<div id="off" class="off" style="display:none"></div>
<div id="wrap" class="wrap"></div>
<script>
const S={}; let BOTS=[];
const el=id=>document.getElementById(id);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function kpis(){let r=0,o=0,e=0;BOTS.forEach(b=>{const s=(S[b.id]||{}).status;if(s==='running')r++;else if(s==='success')o++;else if(s==='error')e++;});el('k-total').textContent=BOTS.length;el('k-run').textContent=r;el('k-ok').textContent=o;el('k-err').textContent=e;}
async function loadBots(){
  try{const r=await fetch('/bots');const j=await r.json();BOTS=j.bots||[];el('off').style.display='none';el('conn').textContent='Connected · '+BOTS.length+' bots';render();}
  catch(e){el('off').style.display='block';el('off').textContent='Cannot reach the bot server. Make sure this page was opened from bot_server.py (http://127.0.0.1:8765).';}
}
function render(){
  const cats={},order=[];
  BOTS.forEach(b=>{const c=b.category||'Other';if(!cats[c]){cats[c]=[];order.push(c);}cats[c].push(b);});
  let h='';
  order.forEach(c=>{h+='<div class="cat">'+c+'</div><div class="grid">';
    cats[c].forEach(b=>{const s=S[b.id]||{};const st=s.status||'idle';
      h+='<div class="card '+st+'" id="card-'+b.id+'"><h3><span class="dot '+st+'"></span>'+esc(b.label)+'<span class="chip">'+esc(b.id)+'</span></h3>';
      if(b.desc)h+='<div class="desc">'+esc(b.desc)+'</div>';
      h+='<div class="meta">'+(s.ranAt?('last run '+timeago(s.ranAt)):'never run')+(s.durationMs?(' · '+(s.durationMs/1000).toFixed(1)+'s'):'')+'</div>';
      if(st==='error')h+='<div class="msg err">'+esc(s.error||s.message||'Failed')+'</div>';
      else if(st==='success')h+='<div class="msg ok">'+esc(s.message||'Completed')+'</div>';
      else if(st==='running')h+='<div class="msg ok">Running…</div>';
      h+='<div class="acts"><button class="'+(st==='error'?'retry':'run')+'" onclick="run(\''+b.id+'\')" '+(st==='running'?'disabled':'')+'>'+(st==='running'?'Running…':st==='error'?'Retry':'Run')+'</button></div></div>';
    });
    h+='</div>';
  });
  el('wrap').innerHTML=h;kpis();
}
function esc(s){return String(s==null?'':s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
function timeago(iso){const t=(Date.now()-new Date(iso))/1000;if(t<60)return Math.floor(t)+'s ago';if(t<3600)return Math.floor(t/60)+'m ago';return Math.floor(t/3600)+'h ago';}
async function run(id){
  S[id]={status:'running',ranAt:new Date().toISOString()};render();
  let j;try{const r=await fetch('/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bot:id})});j=await r.json();}
  catch(e){S[id]={status:'error',error:'Network error: '+e.message};render();return;}
  if(j&&j.job){await poll(id,j.job);}else{S[id]={status:(j&&j.status==='error')?'error':'success',message:j&&j.message,error:j&&j.error,ranAt:new Date().toISOString()};render();}
}
async function poll(id,job){
  for(let i=0;i<600;i++){await sleep(2000);
    let j;try{const r=await fetch('/status?job='+encodeURIComponent(job));j=await r.json();}catch(e){continue;}
    if(j){S[id]={status:j.status==='success'?'success':j.status==='error'?'error':'running',message:j.message,error:j.error||j.message,durationMs:j.durationMs,ranAt:S[id]&&S[id].ranAt||new Date().toISOString()};render();
      if(j.status==='success'||j.status==='error')return;}
  }
}
async function runAll(){for(const b of BOTS){await run(b.id);}}
async function retryFailed(){for(const b of BOTS){if((S[b.id]||{}).status==='error')await run(b.id);}}
loadBots();setInterval(kpis,1000);
</script></body></html>"""

# ---------------------------------------------------------------------------
# BOT REGISTRY — edit freely. id -> {label, cmd, category, desc}
# `cmd` is the argument list passed to subprocess (relative to this folder).
# Add args if a bot needs them, e.g. [PY, "instamart_booking_runner.py", "--today"].
# ---------------------------------------------------------------------------
BOTS = {
    "filflo_pod":          {"label": "Filflo POD Bot",            "cmd": [PY, "filflo_combined_bot_v3.py"], "category": "POD",       "desc": "Selenium POD download / automation"},
    "blinkit_appt":        {"label": "Blinkit Appointment Booker","cmd": [PY, "blinkit_appointment_booker.py"], "category": "Booking", "desc": "Books Blinkit appointments"},
    "instamart_booking":   {"label": "Instamart Booking Runner",  "cmd": [PY, "instamart_booking_runner.py"], "category": "Booking", "desc": "Instamart appointment booking"},
    "instamart_feeder":    {"label": "Instamart Data Feeder",     "cmd": [PY, "instamart_data_feeder.py"], "category": "Feeder",    "desc": "Feed Instamart data"},
    "instamart_gsheet":    {"label": "Instamart → Google Sheet",  "cmd": [PY, "instamart_push_to_gsheet.py"], "category": "Sheets", "desc": "Push Instamart data to sheet"},
    "scootsy_dn":          {"label": "Scootsy DN Updation",       "cmd": [PY, "scootsy_DN_updation.py"], "category": "Booking",   "desc": "Scootsy delivery-note updation"},
    "data_feeder":         {"label": "Data Feeder",               "cmd": [PY, "data_feeder.py"], "category": "Feeder",            "desc": "Feed source data"},
    "pod_feeder":          {"label": "POD Feeder",                "cmd": [PY, "pod_feeder.py"], "category": "Feeder",             "desc": "Feed POD data"},
    "push_to_gsheet":      {"label": "Push to Google Sheet",      "cmd": [PY, "push_to_gsheet.py"], "category": "Sheets",        "desc": "Push data to Google Sheet"},
    "cleanup_sheet":       {"label": "Cleanup Sheet",             "cmd": [PY, "cleanup_sheet.py"], "category": "Sheets",         "desc": "Clean up sheet rows"},
    "multi_agent":         {"label": "Multi-Agent Runner",        "cmd": [PY, "multi_agent_runner.py"], "category": "Orchestration", "desc": "Runs multiple agents"},
    # Long-running / interactive ones are left out of one-click on purpose:
    # "filflo_monitor": {...}  (daemon)   "filflo_chat": {...} (interactive stdin)
}

JOBS = {}          # job_id -> job dict
LAST_BY_BOT = {}   # bot_id -> last job_id
LOCK = threading.Lock()
MAX_LOG_LINES = 800


def _now():
    return datetime.datetime.now().isoformat()


def _summary(job):
    raw = job.get("status", "running")
    status = raw if raw in ("success", "error") else "running"
    return {
        "status": status,
        "message": job.get("message", ""),
        "error": job.get("error"),
        "response": "\n".join(job.get("log", [])[-400:]),
        "returncode": job.get("returncode"),
        "durationMs": job.get("durationMs"),
        "job": job["id"],
        "bot": job["bot"],
        "ranAt": job["ranAt"],
    }


def run_job(bot_id, job):
    bot = BOTS[bot_id]
    job["status"] = "running"
    started = time.time()
    try:
        proc = subprocess.Popen(
            bot["cmd"], cwd=BASE,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace", bufsize=1,
        )
        job["pid"] = proc.pid
        for line in iter(proc.stdout.readline, ""):
            if line == "" and proc.poll() is not None:
                break
            job["log"].append(line.rstrip("\n"))
            if len(job["log"]) > MAX_LOG_LINES:
                del job["log"][: len(job["log"]) - MAX_LOG_LINES]
        proc.stdout.close()
        rc = proc.wait()
        job["returncode"] = rc
        job["durationMs"] = int((time.time() - started) * 1000)
        if rc == 0:
            job["status"] = "success"
            job["message"] = f"Completed (exit 0) in {job['durationMs']//1000}s"
        else:
            job["status"] = "error"
            tail = "\n".join(job["log"][-25:]).strip()
            job["message"] = f"Exited with code {rc}"
            job["error"] = tail or job["message"]
    except FileNotFoundError as e:
        job["status"] = "error"
        job["message"] = f"Script not found: {e}"
        job["error"] = str(e)
        job["durationMs"] = int((time.time() - started) * 1000)
    except Exception as e:  # noqa: BLE001 — surface any failure to the panel
        job["status"] = "error"
        job["message"] = str(e)
        job["error"] = str(e)
        job["durationMs"] = int((time.time() - started) * 1000)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quieter console
        pass

    def _send(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204, {})

    def _base_url(self):
        host = self.headers.get("Host") or f"127.0.0.1:{PORT}"
        # Honor the tunnel's forwarded scheme (cloudflared sets https) so the
        # statusUrl we hand back is reachable.
        proto = self.headers.get("X-Forwarded-Proto") or "http"
        return f"{proto}://{host}"

    def _send_html(self, html):
        body = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path in ("/", "/index.html"):
            return self._send_html(INDEX_HTML)
        if u.path == "/health":
            return self._send(200, {"status": "success", "message": "Bot server up", "bots": len(BOTS)})
        if u.path == "/bots":
            return self._send(200, {"bots": [{"id": k, "label": v["label"], "category": v.get("category", ""), "desc": v.get("desc", "")} for k, v in BOTS.items()]})
        if u.path in ("/status", "/logs"):
            job_id = (q.get("job") or [None])[0]
            if not job_id:
                bot_id = (q.get("bot") or [None])[0]
                job_id = LAST_BY_BOT.get(bot_id)
            job = JOBS.get(job_id)
            if not job:
                return self._send(404, {"status": "error", "message": "No such job"})
            return self._send(200, _summary(job))
        return self._send(404, {"status": "error", "message": "Not found"})

    def do_POST(self):
        u = urlparse(self.path)
        if u.path != "/run":
            return self._send(404, {"status": "error", "message": "Not found"})
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
            raw = self.rfile.read(length).decode("utf-8") if length else ""
            body = json.loads(raw) if raw else {}
        except Exception:
            body = {}
        q = parse_qs(u.query)
        bot_id = (body.get("bot") or (q.get("bot") or [""])[0] or "").strip()
        wait = bool(body.get("wait")) or (q.get("wait") or [""])[0] in ("1", "true")
        if bot_id not in BOTS:
            return self._send(400, {"status": "error", "message": f"Unknown bot '{bot_id}'. Known: {', '.join(BOTS)}"})
        job_id = uuid.uuid4().hex[:10]
        job = {"id": job_id, "bot": bot_id, "status": "queued", "log": [], "ranAt": _now()}
        with LOCK:
            JOBS[job_id] = job
            LAST_BY_BOT[bot_id] = job_id
        if wait:
            run_job(bot_id, job)
            return self._send(200, _summary(job))
        t = threading.Thread(target=run_job, args=(bot_id, job), daemon=True)
        t.start()
        return self._send(200, {
            "status": "running",
            "message": f"Started {BOTS[bot_id]['label']}",
            "job": job_id,
            "bot": bot_id,
            "statusUrl": f"{self._base_url()}/status",
            "ranAt": job["ranAt"],
        })


def main():
    print("=" * 60)
    print(f"  FILFLO COMMAND CENTER is running  ({len(BOTS)} bots)")
    print(f"  Open this in your browser:  http://127.0.0.1:{PORT}")
    print("  (Keep this window open. Press Ctrl+C to stop.)")
    print("=" * 60)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
