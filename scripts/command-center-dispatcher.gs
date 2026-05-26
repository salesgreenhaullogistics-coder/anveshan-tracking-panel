/**
 * Anveshan Command Center — Bot Dispatcher (Google Apps Script Web App)
 * ---------------------------------------------------------------------
 * Turns your Apps Script "bots" into ONE callable URL that the Command Center
 * can trigger with a single click, returning success/error so failures surface
 * for rework.
 *
 * HOW TO SET UP (one time):
 *  1. Open script.google.com (or any one of your bot scripts in the Drive folder).
 *  2. Paste this file's contents into a new script file (e.g. "Dispatcher.gs").
 *  3. In the BOTS map below, point each bot key at the function that runs it.
 *     (If your bots live in OTHER script projects, either move/import the
 *      functions here, or give each its own deployment — see note at bottom.)
 *  4. Deploy: Deploy > New deployment > type "Web app"
 *        - Execute as:        Me
 *        - Who has access:    Anyone            <-- important (no login wall)
 *     Copy the resulting URL ending in /exec.
 *  5. In the Command Center panel: Add Bot
 *        - Run URL:  <the /exec URL>
 *        - Method:   POST
 *        - Payload:  {"bot":"morningReport"}    <-- the key from BOTS below
 *     Repeat "Add Bot" for each bot, changing only the "bot" value in payload.
 *
 * The panel reads {status, message} from the response, so a thrown error in any
 * bot shows up red in the panel with its message + stack for debugging.
 */

/* 1) Register your bots: key (used in the panel payload) -> function to run. */
var BOTS = {
  morningReport: runMorningReport,
  grnSync:       runGrnSync,
  // addMore:    yourFunctionName,
};

function doPost(e) { return dispatch_(e); }
function doGet(e)  { return dispatch_(e); }

function dispatch_(e) {
  var start = Date.now();
  try {
    var params = {};
    if (e && e.postData && e.postData.contents) {
      try { params = JSON.parse(e.postData.contents); } catch (err) { params = {}; }
    }
    var name = (params.bot || (e && e.parameter && e.parameter.bot) || '').toString().trim();
    if (!name) {
      return out_({ status: 'error', message: 'No bot specified. Send {"bot":"<key>"}. Known: ' + Object.keys(BOTS).join(', ') });
    }
    var fn = BOTS[name];
    if (typeof fn !== 'function') {
      return out_({ status: 'error', message: 'Unknown bot "' + name + '". Known: ' + Object.keys(BOTS).join(', ') });
    }
    var result = fn(params); // your bot may return a string or an object
    return out_({
      status: 'success',
      message: (typeof result === 'string') ? result : 'Completed',
      data: (typeof result === 'object') ? result : undefined,
      ms: Date.now() - start
    });
  } catch (err) {
    return out_({ status: 'error', message: (err && err.message) ? err.message : String(err), stack: err && err.stack, ms: Date.now() - start });
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---- Example bots: replace the bodies with your real automation code ---- */
function runMorningReport(params) {
  // ... your existing bot code here ...
  return 'Morning report generated';
}

function runGrnSync(params) {
  // ... your existing bot code here ...
  return 'GRN sync complete';
}

/**
 * NOTE — bots in separate script projects:
 * If each bot is its own Apps Script project, the simplest path is to deploy
 * EACH as its own Web App (Deploy > Web app) and add doGet/doPost wrappers that
 * return out_({status,message}). Then register each /exec URL separately in the
 * panel (no shared dispatcher needed). Use this dispatcher only when several
 * bot functions live in ONE project.
 */
