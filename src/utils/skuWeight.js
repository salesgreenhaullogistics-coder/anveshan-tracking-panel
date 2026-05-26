/**
 * Channel-SKU weight inference + pincode / zone helpers for Shopify BI.
 *
 * These are pure functions (no React, no network) so they are easy to reason about
 * and reuse across BI modules. They degrade gracefully on missing / messy data.
 */

/* ---- Weight inference from Channel SKU / product name ------------------ */
/* Convert a parsed quantity+unit to KILOGRAMS. Liquids (ML/L) are treated ~1:1
   with kg, which is the right ballpark for ghee/oil/honey (Anveshan's catalogue). */
function unitToKg(value, unit) {
  const u = String(unit || '').toLowerCase();
  if (!isFinite(value)) return 0;
  if (u === 'kg' || u === 'kgs' || u === 'kilogram' || u === 'kilograms') return value;
  if (u === 'g' || u === 'gm' || u === 'gms' || u === 'gram' || u === 'grams' || u === 'gr') return value / 1000;
  if (u === 'l' || u === 'lt' || u === 'ltr' || u === 'ltrs' || u === 'litre' || u === 'litres' || u === 'liter' || u === 'liters') return value;
  if (u === 'ml' || u === 'mls') return value / 1000;
  return 0;
}

const WEIGHT_RE = /(\d+(?:\.\d+)?)\s*(kgs?|kilograms?|gms?|grams?|gr|g|mls?|ltrs?|litres?|liters?|lt|l)\b/gi;

/* Detect a pack/combo multiplier e.g. "PACK OF 2", "SET OF 3", "COMBO2", "X2", "2X", "-2N". */
function packMultiplier(text) {
  const t = String(text || '').toUpperCase();
  let m;
  if ((m = t.match(/PACK\s*OF\s*(\d+)/))) return Math.max(1, parseInt(m[1], 10) || 1);
  if ((m = t.match(/SET\s*OF\s*(\d+)/))) return Math.max(1, parseInt(m[1], 10) || 1);
  if ((m = t.match(/COMBO[\s-]*(\d+)/))) return Math.max(1, parseInt(m[1], 10) || 1);
  if ((m = t.match(/\bX\s*(\d+)\b/))) return Math.max(1, parseInt(m[1], 10) || 1);
  if ((m = t.match(/\b(\d+)\s*X\b/))) return Math.max(1, parseInt(m[1], 10) || 1);
  if ((m = t.match(/[-_](\d+)N\b/))) return Math.max(1, parseInt(m[1], 10) || 1);
  return 1;
}

/**
 * Infer the per-unit weight (in KG) encoded in a Channel SKU / product name.
 * e.g. "FPCL-MSTR-PETT-1LTR" -> 1, "...-500ML" -> 0.5, "...-250G" -> 0.25,
 *      "GHEE-1KG-PACK OF 2" -> 2.  Returns 0 when no weight token is found.
 */
export function parseUnitWeightKg(channelSku, name) {
  const candidates = [channelSku, name].filter(Boolean).map(String);
  for (const text of candidates) {
    let total = 0;
    let found = false;
    let m;
    WEIGHT_RE.lastIndex = 0;
    while ((m = WEIGHT_RE.exec(text)) !== null) {
      const kg = unitToKg(parseFloat(m[1]), m[2]);
      if (kg > 0) { total += kg; found = true; }
    }
    if (found) {
      const mult = packMultiplier(text);
      return total * mult;
    }
  }
  return 0;
}

/**
 * Sum the inferred SKU weight (KG) for a whole order's product lines.
 * Each line = per-unit inferred weight x quantity. Returns
 * { kg, matched, total } so callers can show coverage (how many lines parsed).
 */
export function orderSkuWeightKg(products) {
  let kg = 0, matched = 0, total = 0;
  (Array.isArray(products) ? products : []).forEach(p => {
    total++;
    const q = parseFloat(p.quantity);
    const qty = isFinite(q) && q > 0 ? q : 1;
    const unit = parseUnitWeightKg(p.channel_sku || p.sku, p.name);
    if (unit > 0) { matched++; kg += unit * qty; }
  });
  return { kg: Math.round(kg * 1000) / 1000, matched, total };
}

/* ---- Pincode helpers --------------------------------------------------- */
export function cleanPincode(v) {
  const m = String(v == null ? '' : v).match(/\d{6}/);
  return m ? m[0] : '';
}

/* India PIN: first digit = zone region; first 3 digits = sorting district. */
const PIN_REGION = {
  '1': 'North (DL/HR/PB/HP/JK)',
  '2': 'North (UP/UK)',
  '3': 'West (RJ/GJ/DD)',
  '4': 'West (MH/MP/CG/GA)',
  '5': 'South (TG/AP/KA)',
  '6': 'South (TN/KL/PY)',
  '7': 'East (WB/OR/NE)',
  '8': 'East (BR/JH)',
  '9': 'APO/Field',
};
export function pinRegion(pincode) {
  const p = cleanPincode(pincode);
  return p ? (PIN_REGION[p[0]] || 'Unknown') : 'Unknown';
}
export function pinDistrict(pincode) { const p = cleanPincode(pincode); return p ? p.slice(0, 3) : ''; }

/**
 * Approximate logistics zone (Shiprocket-style A–E) from pickup vs delivery pincode.
 * Used only as a fallback when Shiprocket's own `zone` field is absent — label it
 * "(derived)" in the UI so it's never mistaken for the official zone.
 *   A = intra-city (same 3-digit), B = intra-region (same first digit),
 *   D = rest of India (national), E = special/remote (NE & A&N),  C reserved.
 */
export function deriveZone(pickupPin, deliveryPin) {
  const a = cleanPincode(pickupPin), b = cleanPincode(deliveryPin);
  if (!b) return '';
  // Northeast (79x) and Andaman (744) are special/remote
  if (/^79/.test(b) || /^744/.test(b)) return 'E';
  if (!a) return ''; // can't compare without a pickup pin
  if (a.slice(0, 3) === b.slice(0, 3)) return 'A';
  if (a[0] === b[0]) return 'B';
  return 'D';
}

/* Proximity (in coarse "tiers") between two pincodes — for shipping mis-rate.
   same: identical pin · district: same 3-digit · region: same first digit · far: else */
export function pinProximity(pinA, pinB) {
  const a = cleanPincode(pinA), b = cleanPincode(pinB);
  if (!a || !b) return 'unknown';
  if (a === b) return 'same';
  if (a.slice(0, 3) === b.slice(0, 3)) return 'district';
  if (a[0] === b[0]) return 'region';
  return 'far';
}
