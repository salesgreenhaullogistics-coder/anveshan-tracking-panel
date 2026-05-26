import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot, Play, RotateCw, Plus, Trash2, Pencil, ExternalLink, CheckCircle2, XCircle,
  Loader2, AlertTriangle, Search, X, FolderOpen, Zap, ListChecks, History,
  Download, Upload, ChevronDown, ChevronRight, Clock,
} from 'lucide-react';

const DRIVE_FOLDER_URL = 'https://drive.google.com/drive/u/2/folders/1QPTHbX-IROwOOX31b3DFuyECPfo2Bliu';
const BOTS_KEY = 'anveshan-command-center-bots';
const RESULTS_KEY = 'anveshan-command-center-results';
const HISTORY_KEY = 'anveshan-command-center-history';
const SERVER_KEY = 'anveshan-command-center-server';
const DEFAULT_SERVER = 'http://127.0.0.1:8765';
const trimSlash = (s) => String(s || '').replace(/\/+$/, '');
const isHttp = (s) => /^https?:\/\//i.test(String(s || ''));
/* Forgiving: trims, strips trailing slash, and adds https:// if the user omitted it. */
const normalizeServer = (s) => {
  let v = String(s || '').trim().replace(/\/+$/, '');
  if (v && !/^https?:\/\//i.test(v)) v = 'https://' + v;
  return v;
};
const looksLikeHost = (s) => /^https?:\/\/[^/]+\.[^/]+/i.test(normalizeServer(s));
const MAX_CONCURRENCY = 3;
const HISTORY_CAP = 250;

const uid = () => Math.random().toString(36).slice(2, 10);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const POLL_EVERY = 3000;
const POLL_MAX_MS = 20 * 60 * 1000; // long Selenium bots can take minutes
const load = (k, fb) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? fb : v; } catch { return fb; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota */ } };
const timeAgo = (iso) => {
  if (!iso) return 'never';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const EMPTY_FORM = { id: '', kind: 'command', name: '', command: '', url: '', method: 'POST', category: '', description: '', payload: '' };
const SEEDED_KEY = 'anveshan-command-center-seeded';

/* The real Filflo bots (must match the `BOTS` ids in scripts/filflo_bot_server/bot_server.py).
   Pre-loaded by name so the panel is ready out of the box; they run via the Bot Server. */
const DEFAULT_BOTS = [
  { kind: 'command', command: 'filflo_pod',        name: 'Filflo POD Bot',             category: 'POD',           description: 'Selenium POD download / automation' },
  { kind: 'command', command: 'blinkit_appt',      name: 'Blinkit Appointment Booker', category: 'Booking',       description: 'Books Blinkit appointments' },
  { kind: 'command', command: 'instamart_booking', name: 'Instamart Booking Runner',   category: 'Booking',       description: 'Instamart appointment booking' },
  { kind: 'command', command: 'scootsy_dn',        name: 'Scootsy DN Updation',        category: 'Booking',       description: 'Scootsy delivery-note updation' },
  { kind: 'command', command: 'instamart_feeder',  name: 'Instamart Data Feeder',      category: 'Feeder',        description: 'Feed Instamart data' },
  { kind: 'command', command: 'data_feeder',       name: 'Data Feeder',                category: 'Feeder',        description: 'Feed source data' },
  { kind: 'command', command: 'pod_feeder',        name: 'POD Feeder',                 category: 'Feeder',        description: 'Feed POD data' },
  { kind: 'command', command: 'instamart_gsheet',  name: 'Instamart → Google Sheet',   category: 'Sheets',        description: 'Push Instamart data to sheet' },
  { kind: 'command', command: 'push_to_gsheet',    name: 'Push to Google Sheet',       category: 'Sheets',        description: 'Push data to Google Sheet' },
  { kind: 'command', command: 'cleanup_sheet',     name: 'Cleanup Sheet',              category: 'Sheets',        description: 'Clean up sheet rows' },
  { kind: 'command', command: 'multi_agent',       name: 'Multi-Agent Runner',         category: 'Orchestration', description: 'Runs multiple agents' },
];

/* Keep only valid bots (drops the old junk import); seed defaults on first run. */
function initBots() {
  const raw = load(BOTS_KEY, null);
  let list = Array.isArray(raw) ? raw : [];
  list = list.filter(b => b && (b.kind === 'command' ? !!b.command : isHttp(b.url)));
  const seeded = load(SEEDED_KEY, false);
  if (!seeded && list.length === 0) list = DEFAULT_BOTS.map(b => ({ ...b, id: uid() }));
  return list;
}

export default function CommandCenter() {
  const [bots, setBots] = useState(initBots);
  const [results, setResults] = useState(() => load(RESULTS_KEY, {}));   // { [botId]: {status,...} }
  const [history, setHistory] = useState(() => load(HISTORY_KEY, []));
  const [running, setRunning] = useState({});                            // { [botId]: true }
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [failedOnly, setFailedOnly] = useState(false);
  const [form, setForm] = useState(null);                                // null | EMPTY_FORM (add/edit modal)
  const [logBot, setLogBot] = useState(null);                            // bot whose history is shown
  const [expanded, setExpanded] = useState({});                          // { [botId]: bool } show response
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importErr, setImportErr] = useState('');
  const [serverUrl, setServerUrl] = useState(() => load(SERVER_KEY, DEFAULT_SERVER));
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [serverStatus, setServerStatus] = useState('unknown'); // unknown|checking|online|offline
  const [serverStatusMsg, setServerStatusMsg] = useState('');
  const cancelAll = useRef(false);

  // The hosted (vercel) site's proxy runs in the cloud and cannot reach a bot
  // server on the user's 127.0.0.1 / LAN. Detect that and warn explicitly.
  const hostedRemote = typeof window !== 'undefined' && !/^(localhost|127\.0\.0\.1|\[?::1\]?)$/i.test(window.location.hostname);
  const targetsLocal = /(^https?:\/\/)?(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(serverUrl);
  const unreachableCombo = hostedRemote && targetsLocal;

  useEffect(() => { save(BOTS_KEY, bots); }, [bots]);
  useEffect(() => { save(RESULTS_KEY, results); }, [results]);
  useEffect(() => { save(HISTORY_KEY, history); }, [history]);
  useEffect(() => { save(SERVER_KEY, serverUrl); }, [serverUrl]);
  useEffect(() => { save(SEEDED_KEY, true); }, []); // never auto-reseed after first mount

  const categories = useMemo(() => Array.from(new Set(bots.map(b => b.category).filter(Boolean))).sort(), [bots]);

  const visibleBots = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bots.filter(b => {
      if (catFilter !== 'all' && b.category !== catFilter) return false;
      if (failedOnly && results[b.id]?.status !== 'error') return false;
      if (q && !(`${b.name} ${b.category} ${b.description} ${b.url}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [bots, search, catFilter, failedOnly, results]);

  const groupedVisible = useMemo(() => {
    const order = [];
    const map = {};
    visibleBots.forEach(b => {
      const c = b.category || 'Other';
      if (!map[c]) { map[c] = { category: c, bots: [] }; order.push(c); }
      map[c].bots.push(b);
    });
    return order.map(c => map[c]);
  }, [visibleBots]);

  const stats = useMemo(() => {
    let ok = 0, err = 0, run = 0;
    bots.forEach(b => {
      if (running[b.id]) run++;
      else if (results[b.id]?.status === 'success') ok++;
      else if (results[b.id]?.status === 'error') err++;
    });
    return { total: bots.length, ok, err, run };
  }, [bots, results, running]);

  const pushHistory = (bot, res) => {
    setHistory(h => [{ id: uid(), botId: bot.id, botName: bot.name, at: res.ranAt || new Date().toISOString(), success: !!res.success, message: res.message || res.error || '', durationMs: res.durationMs || 0 }, ...h].slice(0, HISTORY_CAP));
  };

  const callProxy = async (url, method = 'POST', payload = null) => {
    const r = await fetch('/api/run-bot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, method, payload }),
    });
    return r.json();
  };

  const pingServer = async () => {
    const base = normalizeServer(serverUrl);
    if (!looksLikeHost(base)) { setServerStatus('offline'); setServerStatusMsg('Paste the full tunnel URL, e.g. https://xxxx.trycloudflare.com'); return; }
    setServerStatus('checking');
    try {
      const res = await callProxy(`${base}/health`, 'GET');
      const raw = res && res.response;
      if (raw && (raw.status === 'success' || typeof raw.bots !== 'undefined')) {
        setServerStatus('online'); setServerStatusMsg(`Online${raw.bots != null ? ` · ${raw.bots} bots` : ''}`);
      } else {
        setServerStatus('offline'); setServerStatusMsg(res?.error || 'Not reachable');
      }
    } catch (e) {
      setServerStatus('offline'); setServerStatusMsg(e.message || 'Not reachable');
    }
  };

  useEffect(() => { const t = setTimeout(() => { pingServer(); }, 500); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [serverUrl]);

  /* Poll an async job (returned by the local bot server) until it finishes,
     updating the card's live log. Returns the final raw status object or null. */
  const pollJob = async (bot, statusUrl, job) => {
    const deadline = Date.now() + POLL_MAX_MS;
    while (Date.now() < deadline) {
      if (cancelAll.current) return null;
      await sleep(POLL_EVERY);
      let raw;
      try {
        const res = await callProxy(`${statusUrl}${statusUrl.includes('?') ? '&' : '?'}job=${encodeURIComponent(job)}`, 'GET');
        raw = res && res.response;
      } catch { continue; }
      if (raw && typeof raw === 'object') {
        setResults(rs => ({ ...rs, [bot.id]: { ...(rs[bot.id] || {}), status: 'running', message: 'Running…', response: raw.response ?? raw.log ?? rs[bot.id]?.response, durationMs: raw.durationMs } }));
        if (raw.status === 'success' || raw.status === 'error') return raw;
      }
    }
    return null;
  };

  const finalize = (bot, raw, ranAt) => {
    const status = raw.status === 'success' ? 'success' : 'error';
    const result = { status, message: raw.message, error: raw.error, response: raw.response, durationMs: raw.durationMs, httpStatus: raw.httpStatus, returncode: raw.returncode, ranAt: ranAt || new Date().toISOString() };
    setResults(rs => ({ ...rs, [bot.id]: result }));
    pushHistory(bot, { success: status === 'success', message: raw.message || raw.error || '', durationMs: raw.durationMs, ranAt: result.ranAt });
    return result;
  };

  /* Resolve what to actually call for a bot: command bots hit the bot server's
     /run with {bot: command}; url bots hit their own endpoint. */
  const targetOf = (bot) => {
    if (bot.kind === 'command') {
      const base = normalizeServer(bot.server || serverUrl);
      return { url: `${base}/run`, method: 'POST', payload: JSON.stringify({ bot: bot.command }) };
    }
    return { url: bot.url, method: bot.method || 'POST', payload: bot.payload || null };
  };

  const runBot = async (bot) => {
    const ranAt = new Date().toISOString();
    setRunning(r => ({ ...r, [bot.id]: true }));
    setResults(rs => ({ ...rs, [bot.id]: { ...(rs[bot.id] || {}), status: 'running', message: 'Starting…' } }));
    let res;
    try {
      const t = targetOf(bot);
      res = await callProxy(t.url, t.method, t.payload);
    } catch (e) {
      res = { success: false, error: e.message || 'Network error reaching the proxy.', ranAt };
    }
    try {
      const raw = res && res.response;
      // Async job from the local bot server → poll until it finishes.
      if (raw && typeof raw === 'object' && raw.job && (raw.statusUrl || bot.kind === 'command') && (raw.status === 'running' || raw.status === 'started' || raw.status === 'queued')) {
        setResults(rs => ({ ...rs, [bot.id]: { status: 'running', message: raw.message || 'Running…', job: raw.job, ranAt } }));
        // Build the poll URL from the configured (https) tunnel base for command
        // bots, so we never poll an http:// self-reported host.
        const pollBase = bot.kind === 'command' ? `${normalizeServer(bot.server || serverUrl)}/status` : raw.statusUrl;
        const final = await pollJob(bot, pollBase, raw.job);
        if (final) return finalize(bot, final, ranAt);
        // timed out or stopped — leave a clear non-crashing state
        setResults(rs => ({ ...rs, [bot.id]: { ...(rs[bot.id] || {}), status: 'running', message: 'Still running — polling stopped (check the bot server).' } }));
        return;
      }
      // Synchronous result (Apps Script / webhook / bot run with wait=1)
      const status = res.success ? 'success' : 'error';
      setResults(rs => ({ ...rs, [bot.id]: { status, ...res, ranAt } }));
      pushHistory(bot, { ...res, ranAt });
      return res;
    } finally {
      setRunning(r => { const n = { ...r }; delete n[bot.id]; return n; });
    }
  };

  const runMany = async (list) => {
    if (!list.length) return;
    cancelAll.current = false;
    const queue = [...list];
    const worker = async () => {
      while (queue.length && !cancelAll.current) {
        const b = queue.shift();
        // eslint-disable-next-line no-await-in-loop
        await runBot(b);
      }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, queue.length) }, worker));
  };

  const anyRunning = Object.keys(running).length > 0;

  const formValid = (f) => f && f.name.trim() && (f.kind === 'command' ? f.command.trim() : isHttp(f.url));

  const saveForm = () => {
    const f = form;
    if (!formValid(f)) return;
    if (f.id) setBots(bs => bs.map(b => b.id === f.id ? { ...b, ...f } : b));
    else setBots(bs => [...bs, { ...f, id: uid() }]);
    setForm(null);
  };

  const removeBot = (id) => {
    setBots(bs => bs.filter(b => b.id !== id));
    setResults(rs => { const n = { ...rs }; delete n[id]; return n; });
  };

  const clearAll = () => {
    if (!window.confirm('Remove ALL registered bots? This clears the list (your bot files are not touched).')) return;
    setBots([]); setResults({});
  };

  const loadDefaults = () => {
    setBots(prev => {
      const have = new Set(prev.filter(b => b.kind === 'command').map(b => b.command));
      const add = DEFAULT_BOTS.filter(b => !have.has(b.command)).map(b => ({ ...b, id: uid() }));
      return [...prev, ...add];
    });
  };

  /* Auto-discover bots from the local bot server's /bots and register them by command. */
  const syncServerBots = async () => {
    const base = normalizeServer(serverUrl);
    if (!looksLikeHost(base)) { setSyncMsg('Paste the full tunnel URL first, e.g. https://xxxx.trycloudflare.com'); return; }
    setSyncing(true); setSyncMsg('');
    try {
      const res = await callProxy(`${base}/bots`, 'GET');
      const raw = res && res.response;
      const list = raw && Array.isArray(raw.bots) ? raw.bots : null;
      if (!list) { setSyncMsg(res?.error || 'Could not read /bots — is bot_server.py running and reachable from here?'); return; }
      setBots(prev => {
        const others = prev.filter(b => !(b.kind === 'command' && trimSlash(b.server) === base));
        const serverBots = list.filter(b => b && b.id).map(b => ({
          id: `srv:${base}:${b.id}`, kind: 'command', command: b.id, server: base,
          name: b.label || b.id, category: b.category || '', description: b.desc || '',
        }));
        return [...others, ...serverBots];
      });
      setSyncMsg(`Synced ${list.length} bot${list.length === 1 ? '' : 's'} from the server.`);
    } catch (e) {
      setSyncMsg(e.message || 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  const doImport = () => {
    setImportErr('');
    let added = [];
    const txt = importText.trim();
    if (!txt) { setImportErr('Nothing to import.'); return; }
    try {
      if (txt.startsWith('[') || txt.startsWith('{')) {
        const parsed = JSON.parse(txt);
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        added = arr
          .filter(o => o && o.name && isHttp(o.url))
          .map(o => ({ id: uid(), kind: 'url', name: String(o.name), url: String(o.url), method: o.method === 'GET' ? 'GET' : 'POST', category: String(o.category || ''), description: String(o.description || ''), payload: typeof o.payload === 'string' ? o.payload : (o.payload ? JSON.stringify(o.payload) : '') }));
      } else {
        // line format: name | url | category  (url must be a real http(s) link)
        added = txt.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
          const parts = l.split('|').map(p => p.trim());
          return (parts[0] && isHttp(parts[1])) ? { id: uid(), kind: 'url', name: parts[0], url: parts[1], method: 'POST', category: parts[2] || '', description: '', payload: '' } : null;
        }).filter(Boolean);
      }
    } catch (e) { setImportErr('Could not parse — paste a JSON array of {name,url} or lines "name | url | category".'); return; }
    if (!added.length) { setImportErr('No valid bots found. Each row needs a name and a real http(s) URL. (Tip: to add Python bots, use "Sync from Bot Server" instead of pasting code.)'); return; }
    setBots(bs => [...bs, ...added]);
    setImportText(''); setImportOpen(false);
  };

  const exportBots = () => {
    const blob = new Blob([JSON.stringify(bots.map(({ id, ...rest }) => rest), null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'command-center-bots.json'; a.click();
  };

  const failedBots = bots.filter(b => results[b.id]?.status === 'error');

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl p-4 text-white" style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-base font-bold flex items-center gap-2"><Zap className="w-5 h-5" /> Command Center</h2>
            <p className="text-[11px] text-indigo-100/90 mt-0.5">One-click bot orchestration · live status · captured errors for rework</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <a href={DRIVE_FOLDER_URL} target="_blank" rel="noreferrer" className="text-[11px] px-3 py-1.5 bg-white/15 hover:bg-white/25 rounded-lg font-semibold flex items-center gap-1.5"><FolderOpen className="w-3.5 h-3.5" /> Bot Drive <ExternalLink className="w-3 h-3" /></a>
            <button onClick={() => setImportOpen(true)} className="text-[11px] px-3 py-1.5 bg-white/15 hover:bg-white/25 rounded-lg font-semibold flex items-center gap-1.5"><Upload className="w-3.5 h-3.5" /> Import</button>
            <button onClick={() => setForm({ ...EMPTY_FORM })} className="text-[11px] px-3 py-1.5 bg-white text-indigo-700 hover:bg-indigo-50 rounded-lg font-bold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add Bot</button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
          <Stat label="Total Bots" value={stats.total} icon={Bot} />
          <Stat label="Running" value={stats.run} icon={Loader2} spin={stats.run > 0} />
          <Stat label="Succeeded" value={stats.ok} icon={CheckCircle2} />
          <Stat label="Failed" value={stats.err} icon={XCircle} danger={stats.err > 0} />
        </div>
      </div>

      {/* Bot server connection */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-bold text-gray-700 flex items-center gap-1.5"><Bot className="w-3.5 h-3.5 text-indigo-500" /> Bot Server</span>
          <input value={serverUrl} onChange={e => setServerUrl(e.target.value)} placeholder={DEFAULT_SERVER} className="text-[11px] px-2 py-1.5 border border-gray-200 rounded-lg font-mono w-72" />
          {/* live connection badge */}
          <span className={`text-[10px] px-2 py-1 rounded font-bold flex items-center gap-1 ${serverStatus === 'online' ? 'bg-emerald-100 text-emerald-700' : serverStatus === 'offline' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
            {serverStatus === 'checking' ? <Loader2 className="w-3 h-3 animate-spin" /> : serverStatus === 'online' ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
            {serverStatus === 'online' ? 'Connected' : serverStatus === 'checking' ? 'Checking…' : 'Offline'}
          </span>
          <button onClick={pingServer} title="Test connection" className="text-[10px] px-2 py-1 rounded bg-gray-100 text-gray-600 font-semibold flex items-center gap-1"><RotateCw className="w-3 h-3" /> Test</button>
          <button disabled={syncing} onClick={syncServerBots} className="text-[11px] px-3 py-1.5 bg-indigo-600 text-white rounded-lg font-bold flex items-center gap-1.5 disabled:opacity-50">{syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />} Sync from Bot Server</button>
          {(serverStatusMsg || syncMsg) && <span className="text-[10px] text-gray-500 truncate max-w-[420px]">{syncMsg || serverStatusMsg}</span>}
        </div>
        {unreachableCombo ? (
          <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[10px] text-amber-800 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
            <span>You're on the <strong>hosted site</strong> ({typeof window !== 'undefined' ? window.location.hostname : ''}), which can't reach <code>127.0.0.1</code> on your PC. To run the Python bots from here: on the bot PC start <code>bot_server.py</code>, then run <strong>START_BOT_TUNNEL.bat</strong> — it auto-copies a <code>https://….trycloudflare.com</code> URL to your clipboard (also saved in <code>BOT_URL.txt</code>). Click the Bot Server box above, press <strong>Ctrl+V</strong> (paste the FULL url incl. <code>https://</code> and the random words), then <strong>Test</strong> → it should show Connected.</span>
          </div>
        ) : (
          <p className="text-[9px] text-gray-400 mt-1.5">Runs your Python bots by command name. Start <code>bot_server.py</code> in the Filflo_Bot folder, then it shows <strong>Connected</strong>. Use <code>127.0.0.1:8765</code> when the panel runs on the same PC, or a tunnel https URL for remote.</p>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap bg-white rounded-xl shadow-sm border border-gray-100 p-2.5">
        <button disabled={anyRunning || !visibleBots.length} onClick={() => runMany(visibleBots)} className="text-[11px] px-3 py-1.5 bg-emerald-600 text-white rounded-lg font-bold flex items-center gap-1.5 disabled:opacity-40"><Play className="w-3.5 h-3.5" /> Run {failedOnly ? 'Failed' : 'All'} ({visibleBots.length})</button>
        <button disabled={anyRunning || !failedBots.length} onClick={() => runMany(failedBots)} className="text-[11px] px-3 py-1.5 bg-red-600 text-white rounded-lg font-bold flex items-center gap-1.5 disabled:opacity-40"><RotateCw className="w-3.5 h-3.5" /> Retry Failed ({failedBots.length})</button>
        {anyRunning && <button onClick={() => { cancelAll.current = true; }} className="text-[11px] px-3 py-1.5 bg-gray-700 text-white rounded-lg font-semibold flex items-center gap-1.5"><X className="w-3.5 h-3.5" /> Stop queue</button>}
        <div className="flex items-center gap-1.5 ml-auto flex-wrap">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search bots…" className="text-[11px] pl-7 pr-2 py-1.5 border border-gray-200 rounded-lg w-40" />
          </div>
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)} className="text-[11px] px-2 py-1.5 border border-gray-200 rounded-lg bg-white">
            <option value="all">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={() => setFailedOnly(f => !f)} className={`text-[11px] px-2.5 py-1.5 rounded-lg font-semibold flex items-center gap-1 ${failedOnly ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600'}`}><AlertTriangle className="w-3.5 h-3.5" /> Failed only</button>
          <button onClick={loadDefaults} title="Restore the built-in Filflo bot list" className="text-[11px] px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 font-semibold flex items-center gap-1"><Bot className="w-3.5 h-3.5" /> Load Filflo bots</button>
          <button onClick={exportBots} disabled={!bots.length} title="Export" className="text-[11px] px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 font-semibold flex items-center gap-1 disabled:opacity-40"><Download className="w-3.5 h-3.5" /></button>
          <button onClick={clearAll} disabled={!bots.length} title="Clear all bots" className="text-[11px] px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-600 font-semibold flex items-center gap-1 disabled:opacity-40"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      {/* Empty state */}
      {!bots.length && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
          <Bot className="w-10 h-10 text-indigo-300 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-gray-700">No bots registered yet</h3>
          <p className="text-[12px] text-gray-500 mt-1 max-w-xl mx-auto">Your Filflo bots are Python scripts, so they run via the <strong>Bot Server</strong>. On the bot machine, start <code>bot_server.py</code> (in the Filflo_Bot folder), set the URL above, then click <strong>Sync from Bot Server</strong> to list them by command. For webhooks / Apps Script bots, use <strong>Add Bot → Direct URL</strong> instead.</p>
          <div className="flex items-center justify-center gap-2 mt-4">
            <button disabled={syncing} onClick={syncServerBots} className="text-[12px] px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold flex items-center gap-1.5 disabled:opacity-50">{syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />} Sync from Bot Server</button>
            <button onClick={() => setForm({ ...EMPTY_FORM })} className="text-[12px] px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-semibold flex items-center gap-1.5"><Plus className="w-4 h-4" /> Add manually</button>
            <a href={DRIVE_FOLDER_URL} target="_blank" rel="noreferrer" className="text-[12px] px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-semibold flex items-center gap-1.5"><FolderOpen className="w-4 h-4" /> Open Bot Drive</a>
          </div>
        </div>
      )}

      {/* Bot grid — grouped by category */}
      {bots.length > 0 && (
        <div className="space-y-5">
          {groupedVisible.map(group => (
            <div key={group.category}>
              <div className="flex items-center gap-2 mb-2"><span className="text-[11px] font-bold text-gray-700 uppercase tracking-wide">{group.category}</span><span className="text-[9px] text-gray-400">{group.bots.length}</span><div className="flex-1 h-px bg-gray-100" /></div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {group.bots.map(bot => {
            const r = results[bot.id];
            const isRun = !!running[bot.id];
            const status = isRun ? 'running' : (r?.status || 'idle');
            return (
              <div key={bot.id} className={`bg-white rounded-xl shadow-sm border overflow-hidden ${status === 'error' ? 'border-red-200' : status === 'success' ? 'border-emerald-200' : 'border-gray-100'}`}>
                <div className="px-3 py-2.5 border-b border-gray-50 flex items-start gap-2">
                  <StatusDot status={status} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-[12px] font-bold text-gray-800 truncate" title={bot.name}>{bot.name}</h3>
                      {bot.category && <span className="text-[8px] px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded font-semibold flex-shrink-0">{bot.category}</span>}
                    </div>
                    {bot.description && <p className="text-[10px] text-gray-400 truncate" title={bot.description}>{bot.description}</p>}
                  </div>
                  <span className="text-[8px] px-1.5 py-0.5 rounded font-mono bg-gray-100 text-gray-500 flex-shrink-0" title={bot.kind === 'command' ? `command: ${bot.command}` : bot.url}>{bot.kind === 'command' ? bot.command : (bot.method || 'POST')}</span>
                </div>

                <div className="px-3 py-2 text-[10px] text-gray-500 flex items-center gap-3 flex-wrap">
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {r?.ranAt ? timeAgo(r.ranAt) : 'never run'}</span>
                  {r?.durationMs != null && <span>{(r.durationMs / 1000).toFixed(1)}s</span>}
                  {r?.httpStatus != null && <span>HTTP {r.httpStatus}</span>}
                </div>

                {/* status message */}
                {status === 'error' && (
                  <div className="mx-3 mb-2 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5 text-[10px] text-red-700">
                    <div className="flex items-start gap-1.5"><XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-px" /><span className="font-semibold break-words">{r?.error || r?.message || 'Failed.'}</span></div>
                  </div>
                )}
                {status === 'success' && r?.message && (
                  <div className="mx-3 mb-2 bg-emerald-50 border border-emerald-100 rounded-lg px-2.5 py-1.5 text-[10px] text-emerald-700 flex items-start gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-px" /><span className="break-words">{r.message}</span></div>
                )}

                {/* response viewer */}
                {r && (r.response != null) && (
                  <div className="mx-3 mb-2">
                    <button onClick={() => setExpanded(e => ({ ...e, [bot.id]: !e[bot.id] }))} className="text-[9px] text-gray-400 hover:text-gray-600 flex items-center gap-1">{expanded[bot.id] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />} Response</button>
                    {expanded[bot.id] && <pre className="mt-1 text-[9px] bg-gray-900 text-emerald-300 rounded-lg p-2 overflow-auto max-h-40">{typeof r.response === 'string' ? r.response : JSON.stringify(r.response, null, 2)}</pre>}
                  </div>
                )}

                <div className="px-3 py-2 border-t border-gray-50 flex items-center gap-1.5">
                  <button disabled={isRun} onClick={() => runBot(bot)} className={`text-[11px] px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 disabled:opacity-50 ${status === 'error' ? 'bg-red-600 text-white' : 'bg-indigo-600 text-white'}`}>
                    {isRun ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Running…</> : status === 'error' ? <><RotateCw className="w-3.5 h-3.5" /> Retry</> : <><Play className="w-3.5 h-3.5" /> Run</>}
                  </button>
                  <button onClick={() => setLogBot(bot)} title="Run history" className="text-[11px] p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><History className="w-3.5 h-3.5" /></button>
                  <button onClick={() => setForm({ ...EMPTY_FORM, ...bot })} title="Edit" className="text-[11px] p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={() => removeBot(bot.id)} title="Delete" className="text-[11px] p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 ml-auto"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            );
                })}
              </div>
            </div>
          ))}
          {!visibleBots.length && <div className="text-center text-[12px] text-gray-400 py-8">No bots match the current filter.</div>}
        </div>
      )}

      {/* Recent activity */}
      {history.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2"><ListChecks className="w-3.5 h-3.5 text-indigo-500" /><h3 className="text-[11px] font-bold text-gray-700">Recent Activity</h3><button onClick={() => setHistory([])} className="ml-auto text-[10px] text-gray-400 hover:text-red-600">Clear</button></div>
          <div className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
            {history.slice(0, 50).map(h => (
              <div key={h.id} className="px-4 py-1.5 flex items-center gap-2 text-[10px]">
                {h.success ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />}
                <span className="font-semibold text-gray-700 w-40 truncate">{h.botName}</span>
                <span className={`flex-1 truncate ${h.success ? 'text-gray-500' : 'text-red-600'}`}>{h.message || (h.success ? 'Completed' : 'Failed')}</span>
                <span className="text-gray-400">{(h.durationMs / 1000).toFixed(1)}s</span>
                <span className="text-gray-300 w-16 text-right">{timeAgo(h.at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add/Edit modal */}
      {form && (
        <Modal title={form.id ? 'Edit Bot' : 'Add Bot'} onClose={() => setForm(null)}>
          <div className="space-y-2.5">
            <Field label="Type">
              <div className="flex gap-1.5">
                <button onClick={() => setForm({ ...form, kind: 'command' })} className={`text-[11px] px-3 py-1.5 rounded-lg font-semibold flex-1 ${form.kind === 'command' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}>Command (Bot Server)</button>
                <button onClick={() => setForm({ ...form, kind: 'url' })} className={`text-[11px] px-3 py-1.5 rounded-lg font-semibold flex-1 ${form.kind === 'url' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}>Direct URL</button>
              </div>
            </Field>
            <Field label="Name *"><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="cc-input" placeholder="e.g. Blinkit Appointment Booker" /></Field>
            {form.kind === 'command' ? (
              <>
                <Field label="Command *" hint="bot id from bot_server.py (BOTS)"><input value={form.command} onChange={e => setForm({ ...form, command: e.target.value })} className="cc-input font-mono text-[10px]" placeholder="blinkit_appt" /></Field>
                <Field label="Bot Server URL" hint="defaults to the one above"><input value={form.server || ''} onChange={e => setForm({ ...form, server: e.target.value })} className="cc-input font-mono text-[10px]" placeholder={serverUrl} /></Field>
              </>
            ) : (
              <>
                <Field label="Run URL *" hint="Apps Script /exec URL or webhook (https)"><input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} className="cc-input font-mono text-[10px]" placeholder="https://script.google.com/macros/s/…/exec" /></Field>
                <div className="grid grid-cols-2 gap-2.5">
                  <Field label="Method"><select value={form.method} onChange={e => setForm({ ...form, method: e.target.value })} className="cc-input"><option>POST</option><option>GET</option></select></Field>
                  <Field label="Payload (JSON)" hint="POST body"><input value={form.payload} onChange={e => setForm({ ...form, payload: e.target.value })} className="cc-input font-mono text-[10px]" placeholder='{"date":"today"}' /></Field>
                </div>
                {form.url && !isHttp(form.url) && <p className="text-[10px] text-red-600">URL must start with http(s)://</p>}
              </>
            )}
            <Field label="Category"><input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="cc-input" placeholder="Booking / Feeder / Sheets" /></Field>
            <Field label="Description"><input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="cc-input" placeholder="What this bot does" /></Field>
          </div>
          <div className="flex items-center justify-end gap-2 mt-4">
            <button onClick={() => setForm(null)} className="text-[11px] px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 font-semibold">Cancel</button>
            <button disabled={!formValid(form)} onClick={saveForm} className="text-[11px] px-4 py-1.5 rounded-lg bg-indigo-600 text-white font-bold disabled:opacity-40">{form.id ? 'Save' : 'Add Bot'}</button>
          </div>
        </Modal>
      )}

      {/* Import modal */}
      {importOpen && (
        <Modal title="Import Bots" onClose={() => setImportOpen(false)}>
          <p className="text-[11px] text-gray-500 mb-2">Paste a JSON array of <code>{'{name,url,category,method,payload}'}</code>, or one bot per line as <code>name | url | category</code>.</p>
          <textarea value={importText} onChange={e => setImportText(e.target.value)} className="cc-input font-mono text-[10px] h-40" placeholder={'Morning Report | https://script.google.com/.../exec | Reports\nGRN Sync | https://hook.make.com/abc | GRN'} />
          {importErr && <p className="text-[10px] text-red-600 mt-1">{importErr}</p>}
          <div className="flex items-center justify-end gap-2 mt-3">
            <button onClick={() => setImportOpen(false)} className="text-[11px] px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 font-semibold">Cancel</button>
            <button onClick={doImport} className="text-[11px] px-4 py-1.5 rounded-lg bg-indigo-600 text-white font-bold">Import</button>
          </div>
        </Modal>
      )}

      {/* History modal */}
      {logBot && (
        <Modal title={`Run history — ${logBot.name}`} onClose={() => setLogBot(null)}>
          <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
            {history.filter(h => h.botId === logBot.id).length === 0 && <p className="text-[11px] text-gray-400 py-4 text-center">No runs yet.</p>}
            {history.filter(h => h.botId === logBot.id).map(h => (
              <div key={h.id} className="py-2 flex items-start gap-2 text-[10px]">
                {h.success ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-px" /> : <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-px" />}
                <div className="flex-1 min-w-0">
                  <p className={`${h.success ? 'text-gray-600' : 'text-red-600 font-semibold'} break-words`}>{h.message || (h.success ? 'Completed' : 'Failed')}</p>
                  <p className="text-gray-400">{new Date(h.at).toLocaleString('en-IN')} · {(h.durationMs / 1000).toFixed(1)}s</p>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}

      <style>{`.cc-input{width:100%;border:1px solid #e5e7eb;border-radius:8px;padding:6px 8px;font-size:11px;outline:none}.cc-input:focus{border-color:#6366f1}`}</style>
    </div>
  );
}

function Stat({ label, value, icon: Icon, spin, danger }) {
  return (
    <div className="bg-white/10 rounded-lg px-3 py-2 flex items-center gap-2">
      <Icon className={`w-4 h-4 ${spin ? 'animate-spin' : ''} ${danger ? 'text-red-200' : 'text-white'}`} />
      <div><div className="text-base font-bold leading-none">{value}</div><div className="text-[9px] text-indigo-100/80 mt-0.5">{label}</div></div>
    </div>
  );
}

function StatusDot({ status }) {
  if (status === 'running') return <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin flex-shrink-0 mt-0.5" />;
  if (status === 'success') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />;
  if (status === 'error') return <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />;
  return <span className="w-2.5 h-2.5 rounded-full bg-gray-300 flex-shrink-0 mt-1" />;
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold text-gray-600">{label}{hint && <span className="font-normal text-gray-400"> — {hint}</span>}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm overflow-auto p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mt-12 mb-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <h3 className="text-sm font-bold text-indigo-700">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
