/**
 * Command Center bot runner — shared by the Vercel function and the Vite dev
 * middleware. Forwards a single trigger request to a user-registered bot URL
 * (e.g. a Google Apps Script Web App /exec, or an automation webhook) and
 * returns a normalised result the UI can render: transport status + parsed
 * body + a best-effort success/error judgement.
 *
 * SECURITY: this is an internal bot-trigger tool whose whole purpose is to call a
 * LOCAL bot server (127.0.0.1 / LAN) or a tunnel URL. So localhost & private LAN
 * are allowed; only cloud-metadata endpoints (a real credential-theft vector) are
 * blocked, and only http(s) is permitted.
 */

const BLOCKED_HOST_RE = /^(169\.254\.169\.254|metadata\.google\.internal|metadata\.google)/i;

function validateUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); }
  catch { return { error: 'Invalid URL.' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'Only http(s) URLs are allowed.' };
  if (BLOCKED_HOST_RE.test(u.hostname)) return { error: 'This host is blocked (cloud metadata endpoint).' };
  return { url: u };
}

/* Decide whether the bot itself reported failure, even on HTTP 200.
   Looks for common conventions: {status:'error'|'fail'}, {ok:false}, {success:false}, {error:...} */
function judge(parsed, httpOk) {
  if (!httpOk) return { success: false, message: 'HTTP error from bot.' };
  if (parsed && typeof parsed === 'object') {
    const st = String(parsed.status ?? parsed.result ?? '').toLowerCase();
    if (parsed.ok === false || parsed.success === false) return { success: false, message: String(parsed.message || parsed.error || 'Bot reported failure.') };
    if (parsed.error) return { success: false, message: String(parsed.error) };
    if (st === 'error' || st === 'fail' || st === 'failed') return { success: false, message: String(parsed.message || 'Bot reported error status.') };
    if (parsed.message || st) return { success: true, message: String(parsed.message || parsed.status) };
  }
  return { success: true, message: 'Completed.' };
}

export async function handleRunBot(input) {
  const { url, method = 'POST', payload = null, headers = {}, timeoutMs = 55000 } = input || {};
  const v = validateUrl(url);
  if (v.error) return { ok: false, status: 400, body: { success: false, error: v.error } };

  const m = String(method || 'POST').toUpperCase();
  const useMethod = (m === 'GET' || m === 'POST') ? m : 'POST';

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.min(Math.max(parseInt(timeoutMs, 10) || 55000, 1000), 60000));
  const started = Date.now();
  try {
    const opts = {
      method: useMethod,
      redirect: 'follow',
      signal: ctrl.signal,
      // 'bypass-tunnel-reminder' + non-browser UA skip localtunnel's interstitial
      // page so we reach the bot server JSON directly through the tunnel.
      headers: { 'Content-Type': 'application/json', 'bypass-tunnel-reminder': 'true', 'User-Agent': 'AnveshanCommandCenter/1.0', ...headers },
    };
    if (useMethod === 'POST') {
      opts.body = (payload == null) ? '{}' : (typeof payload === 'string' ? payload : JSON.stringify(payload));
    }
    const res = await fetch(v.url.toString(), opts);
    const text = await res.text();
    const durationMs = Date.now() - started;
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* non-JSON response is fine */ }
    const verdict = judge(parsed, res.ok);
    return {
      ok: true,
      status: 200,
      body: {
        success: verdict.success,
        message: verdict.message,
        httpStatus: res.status,
        durationMs,
        contentType: res.headers.get('content-type') || '',
        response: parsed != null ? parsed : text.slice(0, 4000),
        ranAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    const durationMs = Date.now() - started;
    const aborted = err && (err.name === 'AbortError');
    const code = err && (err.cause?.code || err.code);
    let error;
    if (aborted) {
      error = `Timed out after ${Math.round(durationMs / 1000)}s — the bot took too long to respond.`;
    } else if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH' || /fetch failed/i.test(err.message || '')) {
      error = `Could not reach the bot server at ${v.url.host}${code ? ` (${code})` : ''}. Make sure bot_server.py is running there. Note: the hosted site cannot reach 127.0.0.1 on your PC — run the panel locally (start-dev.bat → http://localhost:5173) or point this at a tunnel URL.`;
    } else {
      error = err.message || String(err);
    }
    return {
      ok: true,
      status: 200,
      body: { success: false, error, code: code || null, durationMs, ranAt: new Date().toISOString() },
    };
  } finally {
    clearTimeout(timer);
  }
}
