/**
 * ═════════════════════════════════════════════════════════════════════
 *  Google Apps Script — Anveshan Shipment Data API  (with POD links)
 * ═════════════════════════════════════════════════════════════════════
 *
 *  HOW TO UPDATE YOUR EXISTING SCRIPT:
 *  ───────────────────────────────────
 *  1.  Open your Google Sheet that contains the shipment data.
 *  2.  Go to  Extensions → Apps Script.
 *  3.  Replace the existing doGet() function with the one below.
 *  4.  Click  Deploy → Manage deployments.
 *  5.  Click the pencil icon on your existing deployment,
 *      set "Version" to "New version", and click Deploy.
 *  6.  The tracking panel will automatically pick up the new data
 *      format on its next refresh.
 *
 *  WHAT THIS DOES:
 *  ───────────────
 *  The POD column (Column X) in your Google Sheet contains clickable
 *  hyperlinks.  The previous script only returned the *display text*
 *  (e.g. "1756982942381-pod-…jpeg") — not the actual URL behind the
 *  link.  This updated version also returns the hyperlink URL as a
 *  new field called "POD Link", so the tracking panel can display
 *  the POD image preview.
 * ═════════════════════════════════════════════════════════════════════
 */

function doGet(e) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheets()[0];                       // first sheet
    var range = sheet.getDataRange();
    var data  = range.getValues();

    if (data.length < 2) {
      return ContentService
        .createTextOutput(JSON.stringify([]))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var headers = data[0];

    // ── Locate the POD column ──────────────────────────────
    var podColIdx = -1;
    for (var h = 0; h < headers.length; h++) {
      if (String(headers[h]).trim().toUpperCase() === 'POD') {
        podColIdx = h;
        break;
      }
    }

    // ── Extract hyperlink URLs from the POD column ─────────
    //    Works for both:
    //      •  Rich-text links  (inserted via Ctrl+K / right-click → Insert link)
    //      •  =HYPERLINK("url", "display_text") formulas
    var podLinks = {};   // row index → URL string

    if (podColIdx >= 0) {
      // Method 1: Try Rich-Text links (getRichTextValues)
      try {
        var richTexts = range.getRichTextValues();
        for (var r = 1; r < richTexts.length; r++) {
          var rt = richTexts[r][podColIdx];
          if (!rt) continue;
          var runs = rt.getRuns();
          for (var k = 0; k < runs.length; k++) {
            var url = runs[k].getLinkUrl();
            if (url) { podLinks[r] = url; break; }
          }
        }
      } catch (err) {
        // getRichTextValues may not be available in older runtimes
      }

      // Method 2: Check for =HYPERLINK() formulas (if rich-text didn't find links)
      if (Object.keys(podLinks).length === 0) {
        try {
          var formulas = range.getFormulas();
          var hlRegex = /^=HYPERLINK\s*\(\s*"([^"]+)"/i;
          for (var r = 1; r < formulas.length; r++) {
            var f = formulas[r][podColIdx];
            if (!f) continue;
            var match = f.match(hlRegex);
            if (match && match[1]) {
              podLinks[r] = match[1];
            }
          }
        } catch (err) {
          // Fallback silently
        }
      }
    }

    // ── Build the JSON response ────────────────────────────
    var result = [];
    for (var i = 1; i < data.length; i++) {
      var row = {};
      for (var j = 0; j < headers.length; j++) {
        var key = String(headers[j]).trim();
        if (key) row[key] = data[i][j];
      }
      // Attach the POD hyperlink URL (if found)
      if (podLinks[i]) {
        row['POD Link'] = podLinks[i];
      }
      result.push(row);
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
