# Anveshan Tracking Panel — Project Memory

> **Last Updated:** 2026-05-18
> **Owner:** tech@anveshan.farm (Sandeep)
> **Live URL:** https://anveshan-tracking.vercel.app
> **Project Path:** `C:\Users\sande\OneDrive\Desktop\anveshan-tracking-panel`

---

## 1. Project Overview

AI-powered logistics tracking panel for **Anveshan** (D2C food brand). Tracks B2B shipments across platforms (Blinkit, Zepto, Swiggy, Amazon, Big Basket, Flipkart) with analytics, KPI monitoring, aging analysis, and AI-powered insights.

**Total Codebase:** ~11,221 lines across 31 files (JSX + JS)

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18.3.1 + Vite 5.4.x |
| Styling | Tailwind CSS 3.4.x |
| Charts | Chart.js 4.4.7 + react-chartjs-2 5.2 + chartjs-plugin-datalabels |
| Icons | lucide-react 0.453 |
| Dates | date-fns 3.6 |
| Excel | xlsx (SheetJS) 0.18.5 |
| API | Google Apps Script (backend) |
| AI | @anthropic-ai/sdk 0.96 (for email composer, needs API key) |
| Hosting | Vercel (serverless) |
| Node.js | Portable v22.16.0 at `.node/node-v22.16.0-win-x64/` |

---

## 3. Build & Deploy Commands

```bash
# Local dev
PATH="$(pwd)/.node/node-v22.16.0-win-x64:$PATH" npx vite

# Build
PATH="$(pwd)/.node/node-v22.16.0-win-x64:$PATH" npx vite build

# Deploy to Vercel
PATH="$(pwd)/.node/node-v22.16.0-win-x64:$PATH" npx vercel deploy --prod --yes
```

**vercel.json:**
```json
{
  "buildCommand": "npx vite build",
  "outputDirectory": "dist",
  "framework": null,
  "functions": {
    "api/compose-email.mjs": { "memory": 256, "maxDuration": 30 }
  }
}
```

---

## 4. Architecture

### Data Flow
```
Google Apps Script API → DataContext (fetch + parse + normalize) → Client-side filtering → Page components
```

- **API URL:** `https://script.google.com/macros/s/AKfycbzu8zSSmcPeuMAxUdDylahx7UuNBmMXWYd8W1wCVptdR0oUVLEIrYJiz37TRW_qPk2kQA/exec`
- **Fetch strategy:** Try `/api?...` (Vercel proxy) first, fallback to direct Google Apps Script URL
- **Fetch timeout:** 120,000ms
- **Cache TTL:** 5 minutes (client-side Map)
- **Filtering:** 100% client-side via `filteredData` memo in DataContext (NOT server-side)
- **Tab-to-API mapping:** `analytics`, `cost`, `kpi`, `okr`, `all-lrs`, `aging-monitor` all map to `tab=dashboard` API call
- **Data persistence:** localStorage for tracking data, lock states

### Field Mapping (API → Internal)
The API returns raw field names that are mapped via `KEY_MAP` in DataContext.jsx:
| API Key | Internal Key | Notes |
|---------|-------------|-------|
| `"Booking Date"` | `bookingDate` | Also `"ff"` as fallback if bookingDate is empty |
| `"AWB No."` | `awbNo` | Primary identifier |
| `"Invoice No."` | `invoiceNo` | |
| `"Vendor"` | `vendor` | Courier/transporter name |
| `"Consignee"` | `consignee` | Mapped to `platform` via platformMapping.js |
| `"Origin"` | `origin` | |
| `"Destination"` | `destination` | City name |
| `"Boxes"` | `boxes` | |
| `"Status"` | `status` | Normalized via statusMapping.js |
| `"Appointment Date"` | `appointmentDate` | |
| `"Failure Remarks"` | `failureRemarks` | |
| `"Delivery Date"` | `deliveryDate` | |
| `"EDD"` | `edd` | Expected delivery date |
| `"PO Number"` | `poNumber` | |
| `"CN Status"` | `cnStatus` | Credit note status |
| `"Zone"` | `zone` | |
| `"TAT"` | `tat` | Turn-around time |
| `"Month"` | `month` | Abbreviated ("Mar"), converted to "Mar'26" via `deriveMMMYY` |
| `"Delivery-Booked"` | `deliveryBooked` | |
| `"Ref. No."` | `refNo` | Reference number |
| `"RTO AWB"` | `rtoAwb` | |
| `"CN No."` | `cnNo` | Credit note number |
| `"Invoice Value"` | `invoiceValue` | |
| `"Logistics Cost"` | `logisticsCost` | |
| `"POD"` | `pod` | POD status text |
| `"POD Link"` | `podUrl` | POD image/document URL |

### Platform Mapping (src/utils/platformMapping.js)
Consignee names from API are mapped to normalized platform names:
- `"BLINK COMMERCE PRIVATE LIMITED*"` → `Blinkit` (all variants including HOT, HOT-RTV, TWENTY LIFESTYLE)
- `"Kiranakart"`, `"Kirana Kart"`, `"Zepto*"` → `Zepto`
- `"Scootsy"`, `"Scooty"` → `Swiggy`
- `"Amazon - XXX*"` → `FBA` or `ARIPL` (depending on warehouse code)
- `"Flipkart*"`, `"FK"` → `FK Minutes`
- `"Avenue*"` → `D Mart`
- `"Innovative*"` → `Big Basket` or `HoReCa`
- `"Hands on*"` → `Blinkit`
- `"Jio Mart"`, `"natural basket"`, `"Reliance*"` → `Reliance`
- Many individual consignees → `Shopify Other`, `Retail Other`, `Emiza`, `Prozo`
- **Case-insensitive matching** with exact match tried first

### DataContext Internals (src/context/DataContext.jsx)
- **parseRows(raw):** Handles 3 formats: pre-normalized objects, KEY_MAP-based objects, header+array format
- **Header row filtering:** Rows where awbNo matches known header values are stripped
- **deriveMMMYY(rawMonth, bookingDate):** Converts "Mar" + booking year → "Mar'26"
- **Per-tab filter state:** Each tab has independent `{applied, pending}` filter objects
- **`filteredData` memo:** Applies platform, courier, zone, city, month, dateFrom, dateTo filters on `rawData`
- **Exposed via `useData()` hook:** `data` (filtered), `rawData`, `loading`, `error`, `activeTab`, `setActiveTab`, `filters`, `pendingFilters`, `applyFilters`, `clearFilters`, `uniqueValues`, `refreshData`, `globalSearch`, `fetchScopedData`, `getSearchSuggestions`, `lastFetched`
- **`globalSearch(query)`:** Client-side multi-token search across awbNo, invoiceNo, poNumber, refNo, cnNo, platform, vendor, destination, status
- **`getSearchSuggestions(query)`:** Returns up to 8 suggestions from awbNo, invoiceNo, poNumber, refNo fields
- **Race condition protection:** `requestIdRef` counter prevents stale responses from overwriting newer data

### Status Classification (src/utils/index.js)
**Normalized statuses** (after statusMapping.js):
`In-Transit`, `Delivered`, `Partial Delivered`, `Partial RTO Delivered`, `RTO Delivered`, `RTO - In Transit`, `Lost`, `Other`

**Classification functions:**
| Function | Matches |
|----------|---------|
| `isInTransit(status)` | `In-Transit`, fuzzy: pending, intransit, undelivered, manifested, booked, picked up |
| `isOFD(status)` | Fuzzy only: ofd, out for delivery, rtd, last mile |
| `isDelivered(status)` | `Delivered`, fuzzy: delivered, pod pending/uploaded/received |
| `isPartialDelivered(status)` | `Partial Delivered`, fuzzy: partial delivered |
| `isRTODelivered(status)` | `RTO Delivered`, fuzzy: rto delivered, returned to origin |
| `isRTOInTransit(status)` | `RTO - In Transit`, fuzzy: rto pending, rto ofd, rto connection pending |
| `isRTOPartial(status)` | `Partial RTO Delivered`, fuzzy: partial rto delivered |
| `isRTO(status)` | Combines: isRTODelivered OR isRTOInTransit OR isRTOPartial |
| `isLost(status)` | `Lost`, fuzzy: lost, missing, not found, damaged |
| `classifyStatus(status)` | Returns string label for any status |

**Fuzzy matching:** Uses Levenshtein distance ≤ 2 as fallback for unmapped statuses.

**Status Map (statusMapping.js) key entries:**
- `"GRN Done - POD Missed"` → `Delivered`
- `"POD Pending"` → `Delivered`
- `"OFD"` → `In-Transit` (OFD is treated as In-Transit after normalization)
- `"UNDELIVERED"`, `"pendong"`, `"in trasit"` → `In-Transit`
- `"RTO - Connection Pending"` → `RTO - In Transit`
- `"RTO - Documents Received"` → `RTO - In Transit`
- `"Slot not booked"`, `"NA"`, `"RTV issue"` → `Other`

---

## 5. File Structure

### Core
| File | Purpose |
|------|---------|
| `src/App.jsx` | Root component, PAGE_MAP, TAB_TITLES, layout |
| `src/main.jsx` | React entry point |
| `src/context/DataContext.jsx` | Data fetching, parsing, filtering, tab state, filters |

### Pages (~20 pages)
| File | Description | Lines |
|------|-------------|-------|
| `src/pages/KPIMatrix.jsx` | KPI Matrix data view (largest page) | 1,949 |
| `src/pages/Analytics.jsx` | 5 sub-tabs: MoM, Platform, Zone/City, Cost Intelligence, AI Insights | 1,657 |
| `src/pages/LogisticsCost.jsx` | Forward/RTO cost analysis | 1,265 |
| `src/pages/OKR.jsx` | KPI Command Center with 5 owner tabs, 4 views | 1,100 |
| `src/pages/Provision.jsx` | Provision Summary, Making, Billing, AI Email Composer | 666 |
| `src/pages/Dashboard.jsx` | Main overview dashboard | 459 |
| `src/pages/AgingMonitor.jsx` | Aged In-Transit + Appointment Manager (4 categories) | 432 |
| `src/pages/PODs.jsx` | POD Overview, Pending, Search (3 tabs) | 324 |
| `src/pages/AllLRs.jsx` | Consolidated LRs (In-Transit, Delivered, RTO, Lost, Other tabs) | 164 |
| `src/pages/ReturnModule.jsx` | Returns (legacy, removed from sidebar) | 139 |
| `src/pages/GRN.jsx` | GRN management | 126 |
| `src/pages/PlatformSOP.jsx` | Platform SOPs | 119 |
| `src/pages/AgedPOs.jsx` | Aged POs (legacy, merged into AgingMonitor) | 106 |
| `src/pages/Appointment.jsx` | Appointments (legacy, merged into AgingMonitor) | 105 |
| `src/pages/Delivered.jsx` | Delivered shipments (legacy, removed from sidebar) | 103 |
| `src/pages/LostShipments.jsx` | Lost shipments (legacy, removed from sidebar) | 103 |
| `src/pages/InTransit.jsx` | In-transit shipments (legacy, removed from sidebar) | 83 |
| `src/pages/PrepullAged.jsx` | Prepull Aged (legacy, merged into AgingMonitor) | 80 |
| `src/pages/OFD.jsx` | Out for Delivery (legacy, removed from sidebar) | 60 |
| `src/pages/POCDetails.jsx` | Point of Contact details | 53 |

### Components
| File | Purpose | Lines |
|------|---------|-------|
| `src/components/GlobalSearch.jsx` | AWB/Invoice/PO/Ref search with suggestions, search history (localStorage: `anveshan-global-search-history`), highlight matching text | 311 |
| `src/components/Charts.jsx` | BarChart, LineChart, PieChart, DoughnutChart wrappers (Chart.js registered with CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Filler) | 216 |
| `src/components/DataTable.jsx` | Reusable data table: search (250ms debounce), sort (asc/desc), pagination (configurable pageSize), Excel export | 196 |
| `src/components/Sidebar.jsx` | Navigation sidebar with 5 groups, collapsible, refresh button | 135 |
| `src/components/FileUpload.jsx` | File upload (drag & drop) component | 81 |
| `src/components/Filters.jsx` | Filter bar: platform, courier, zone, city, dateFrom, dateTo, month dropdowns. Apply/Clear buttons. Enter key applies. | 79 |
| `src/components/KPICard.jsx` | Reusable KPI card: title, value, icon, color (9 themes), change %, subtitle | 44 |

### Utils
| File | Purpose | Lines |
|------|---------|-------|
| `src/utils/index.js` | API fetch (with retry + fallback), status classifiers (fuzzy + exact), date utils, Excel export/import, helpers | 389 |
| `src/utils/platformMapping.js` | Consignee → Platform name map (~260 entries), case-insensitive | 282 |
| `src/utils/statusMapping.js` | Raw status → Normalized status map (~40 entries), case-insensitive | 62 |

### Context
| File | Purpose | Lines |
|------|---------|-------|
| `src/context/DataContext.jsx` | Central data store: fetch, parse, normalize, per-tab filter state, client-side filtering, global search, suggestions | 333 |

### Sidebar Structure (Current)
```
Operations
  └── Dashboard
LRs
  ├── All LRs
  └── Aging Monitor
Documentation
  ├── PODs
  └── GRN
Analytics
  ├── KPI Matrix
  ├── OKR
  ├── Logistics Cost
  └── Analytics
Configuration
  ├── POC Details
  ├── Platform SOP
  └── Provision
```

---

## 6. OKR / KPI Command Center (src/pages/OKR.jsx)

### KPI Owners
| Owner | Key | Role | KPIs |
|-------|-----|------|------|
| All Owners | `all` | Combined KPI View | All KPIs from all owners (grouped) |
| Sandeep | `sandeep` | Commercial & Primary | Overall Cost %, In-Transit Aging, Platform OTIF, Delivery Success %, Non-Appt 0-2 Days %, POD Visibility |
| Prashant | `prashant` | Last Mile & Return | Channel Delivery, First Attempt Del %, B2B RTO Tracking, RTO Ageing Control, Non-Appointment %, Doc Issues % |
| Nandlal | `nandlal` | Documentation & GRN | GRN Recovery %, POD Ageing, GRN Ageing, Platform GRN, Doc Issues % |
| Anoop | `anoop` | First Mile & Dispatch | Dispatch & Pickup (grouped: Same Day Dispatch + Pickup Compliance), Quality Control (grouped: Packaging + Label + WH), WH Capacity Utilization |

### Views
1. **Executive Summary** — KPI score, at-risk count, forecast, KPI health grid with sub-breakdowns, Plan of Action for below-target KPIs
2. **KPI Scorecard** — Full matrix table (Base/Target/High/Exceptional/Actual/Grade/Gap), Improvement Roadmap
3. **Monthly Tracking** — Editable grid with auto-feed from shipment data, per-period columns (Monthly/Quarterly/Yearly), lock/unlock months, drill-down modals with context-aware tables
4. **AI Root Cause** — Auto-generated root cause analysis for below-target KPIs, next month forecast

### Key Features
- **Auto-feed:** Monthly Tracking cells auto-populate from shipment data computations
- **`sub` property:** KPIs can have sub-breakdowns shown as nested cards
- **Drill-down modal:** Clicking Eye icon in tracking shows filtered raw data with Platform/Courier/Zone summary tables above the DataTable
- **Context-aware drill-down:** Cost KPI shows cost outliers; Transit shows aging buckets; RTO shows RTO-specific columns
- **Grade system:** Exceptional (95+), High (80+), Target (65+), Base (50+), Below (<50)
- **Scoring:** `scorePct()` compares actual vs target/base/exceptional with `inv` flag for inverse KPIs (lower=better)
- **Period columns:** Monthly = `["Mar'26","Apr'26",...]`, Quarterly = `["Q1'26","Q2'26",...]`, Yearly = `["FY 2025-26","FY 2026-27"]`
- **In-transit aging for past months:** Uses month-end date as reference (not `now`)
- **"All" tab:** Shows combined view — header has per-owner score cards, executive view groups KPIs by owner, scorecard has Owner column

### OKR State stored in localStorage
- `okr-track` — Manual tracking data (JSON: `{ownerKey||month||kpiName: value}`)
- `okr-lock` — Locked months (JSON: `{ownerKey||month: true/false}`)

### Auto-feed KPI mapping (autoActuals keys must match KPI `name` exactly)
These keys are computed from shipment data per month in the Monthly Tracking view:
```
"Overall Cost %", "Delivery Success %", "POD Visibility", "Platform OTIF",
"Channel Delivery", "B2B RTO Tracking", "RTO Ageing Control", "Doc Issues %",
"GRN Recovery %", "First Attempt Del %", "Non-Appt 0-2 Days %",
"Non-Appointment %", "In-Transit Aging", "Same Day Dispatch %",
"Pickup Compliance %", "Packaging Quality %", "Label Accuracy %",
"WH Capacity Utilization", "Platform OTIF — Blinkit/Zepto/Swiggy",
"Channel Del — Blinkit/Swiggy/Amazon", "POD 0-7 Days %", etc.
```

---

## 7. Analytics Page (src/pages/Analytics.jsx)

### Sub-tabs
1. **MoM Performance** — Monthly delivery/RTO/transit trends, status-specific drill-down
2. **Platform Analytics** — Platform → Zone → City → Shipments drill-down, Health Score (0-100), Forward vs RTO comparison
3. **Zone & City** — Zone-wise and city-wise analysis
4. **Cost Intelligence** — Cost % analysis, forward vs RTO cost breakdown
5. **AI Insights** — AI-generated root cause analysis per platform

### Key: Status breakdown bars show Del% + RTO% + Transit% + Other% = 100%

---

## 8. Other Key Pages

### Provision & Billing (src/pages/Provision.jsx, 666 lines)
- 4 tabs: Provision Summary, Provision Making, Billing & Invoices, Share & Communicate
- **Provision Making:** Manual entry form (channel, type Forward/RTO, courier, month, amount, shipments, remarks), localStorage persisted
- **Billing:** Invoice management with localStorage
- **Share & Communicate (AI Email Composer):**
  - Prompt-to-email: keyword detection (POD → POD follow-up, RTO → RTO escalation, delivery → delivery update, etc.)
  - Language selector (English/Hindi)
  - 14 report types for data attachment (CSV/TXT export)
  - Gmail compose URL (`mailto:`), WhatsApp share, clipboard copy
  - Quick templates for common emails
  - Claude API integration via `/api/compose-email` (needs `ANTHROPIC_API_KEY` env var)
- **localStorage keys:** `anveshan-provision-entries`, `anveshan-billing`

### Aging Monitor (src/pages/AgingMonitor.jsx, 432 lines)
- Tab 1: **Aged In-Transit POs**
  - Age filters: All, 0-7 Days, 8-15 Days, 16-30 Days, 30+ Days
  - In-Transit Stage Funnel visualization
  - AI Aging Insights (auto-generated)
  - Platform aging table with courier/zone/reason drill-down
  - Age severity coloring (emerald/amber/orange/red)
- Tab 2: **Appointment Manager** (4 categories)
  - Today's Appointment (appointments for today, uses `isToday` from date-fns)
  - Appointment Pending (no appointment booked)
  - Prepull Required (aged without appointment)
  - Future Appointment (upcoming appointments)

### All LRs (src/pages/AllLRs.jsx, 164 lines)
- Status tabs: All, In-Transit, Delivered, RTO, Lost, Other
- Platform breakdown charts
- Age bucket distribution for in-transit

### PODs (src/pages/PODs.jsx, 324 lines)
- POD Overview, Pending PODs, Search POD
- POD aging (days since delivery without POD)
- Platform/Courier POD pendency drill-down
- Last 4 months filter
- POD preview modal

### KPI Matrix (src/pages/KPIMatrix.jsx, 1,949 lines)
- Largest page in the app
- Pivot-style drill-down table
- Separate API endpoint for KPI data

### Logistics Cost (src/pages/LogisticsCost.jsx, 1,265 lines)
- Forward vs RTO cost separation
- Cost % analysis by platform, courier, zone
- Invoice value vs logistics cost comparison

### Dashboard (src/pages/Dashboard.jsx, 459 lines)
- Main overview with KPI summary cards
- Recent shipment activity
- Status distribution charts

---

## 9. All localStorage Keys Used

| Key | Used By | Purpose |
|-----|---------|---------|
| `okr-track` | OKR.jsx | Manual KPI tracking data `{ownerKey\|\|month\|\|kpiName: value}` |
| `okr-lock` | OKR.jsx | Locked months `{ownerKey\|\|month: true/false}` |
| `anveshan-provision-entries` | Provision.jsx | Manual provision entries (JSON array) |
| `anveshan-billing` | Provision.jsx | Billing/invoice entries (JSON array) |
| `anveshan-global-search-history` | GlobalSearch.jsx | Recent search queries |

---

## 10. Component Props & API

### KPICard Props
`{ title, value, subtitle, icon, color, change, suffix }`
- **color options:** `blue`, `green`, `red`, `yellow`, `purple`, `indigo`, `cyan`, `orange`, `gray`
- **change:** Shows trending up/down arrow with percentage

### DataTable Props
`{ data, columns, pageSize (default 25), exportFilename, onRowClick, emptyMessage }`
- **columns format:** `[{ key: 'fieldName', label: 'Display Label', render: (value, row) => JSX }]`
- **Features:** Debounced search (250ms), sort by column (asc/desc), pagination, Excel export via `exportToExcel()`

### Charts (BarChart, LineChart, PieChart, DoughnutChart)
- Wrappers around react-chartjs-2 components
- All accept: `{ title, labels, datasets, height, options }`
- **datasets format:** `[{ label, data, color, fill? }]`
- Global defaults: Inter font, 11px, point-style legends

### GlobalSearch
- Positioned in header bar (App.jsx)
- Multi-token search (space-separated)
- Auto-suggestions from AWB, Invoice, PO, Ref fields
- Search history in localStorage
- Highlight matching text in results
- Result cards show shipment details inline

### Filters Component
- Renders dropdowns from `uniqueValues` (computed from rawData)
- Available filters: Platform, Courier, Zone, City, Month, Date From, Date To
- "Apply" button triggers filter, "Clear" resets
- Enter key in any dropdown applies filters
- Green banner shows when filters are active

---

## 11. Known Issues & Critical Rules

### NEVER DO These (Will Crash the App)
1. **React.useState inside IIFEs in JSX** — Using `useState` inside `(() => { ... })()` violates React hooks rules. ALWAYS move all `useState` to component top level.
2. **sed commands on complex JSX** — `sed -i 's/pattern/replacement/g'` can corrupt JSX by matching unintended locations. Prefer targeted Edit tool edits.
3. **Hindi/Unicode in Edit tool** — String matching may fail with Hindi text. Use Python or Bash instead.

### Data Quirks
- API returns `"ff"` field for booking date — only use if `bookingDate` is empty (fallback)
- Month field is abbreviated ("Mar" not "March") — MONTH_NAME_TO_IDX handles both
- Filters are sent as API params but **backend ignores them** — all filtering is client-side
- `"RTO - Connection Pending"` must be in RTO patterns (was misclassified as In-Transit)
- Empty invoice value skews Cost % — exclude from weighted calculation

### Performance
- DataTable has 250ms search debounce
- Single-pass computations for large datasets (avoid multiple .filter() passes)
- No row array storage — compute on the fly
- Build warning: bundle > 500 KB (expected, single-page app)

---

## 12. Pending / Future Tasks

1. **Pull KPI Matrix API data** — Fill blank OKR tracking cells from separate KPI API endpoint
2. **B2B RTO detailed tracking** — Claim settlement, RTV recovery, CN reconciliation, discard management
3. **Prashant's full KRA structure** — 50+ KPIs from attachments (partially implemented)
4. **AI Email Composer activation** — Needs Claude API key in Vercel env for `api/compose-email.mjs`
5. **Code splitting** — Vite build warns about bundle size; consider dynamic imports

---

## 13. API Endpoints

### Google Apps Script (Backend)
```
Base: https://script.google.com/macros/s/AKfycbzu8zSSmcPeuMAxUdDylahx7UuNBmMXWYd8W1wCVptdR0oUVLEIrYJiz37TRW_qPk2kQA/exec
```

| Action | Endpoint | Response |
|--------|----------|----------|
| Shipments | `?action=shipments&tab=dashboard` | `{ data: [...] }` — array of shipment objects |
| Search | `?action=search&q=AWB123&limit=100` | `{ data: [], total, query }` |
| Suggestions | `?action=suggest&q=AWB&limit=8` | `{ suggestions: [] }` |

**Optional query params:** `platform`, `courier`, `zone`, `city`, `month`, `dateFrom`, `dateTo`, `refresh=1`
> Note: Backend ignores filter params. All filtering is client-side.

### Vercel Serverless Functions
```
GET  /api?action=shipments&tab=dashboard    → Proxy to Google Apps Script
POST /api/compose-email                      → Claude AI email generation
```

**compose-email.mjs:**
- Requires `ANTHROPIC_API_KEY` environment variable in Vercel
- Memory: 256MB, Max duration: 30s
- Accepts: `{ prompt, language, context }` in body
- Returns: `{ email }` with generated email text

---

## 14. Key Helper Functions (src/utils/index.js)

| Function | Purpose | Notes |
|----------|---------|-------|
| `fetchShipmentData({tab, filters, forceRefresh})` | Fetch data from API with cache | Tries `/api?` then direct GAS URL |
| `searchShipments(query, {limit, forceRefresh})` | Search API call | `action=search` |
| `fetchSearchSuggestions(query, {limit})` | Suggestions API call | `action=suggest` |
| `percent(part, total)` | Calculate percentage | Returns 2 decimal places |
| `currency(value)` | Format as INR (₹) | `Intl.NumberFormat('en-IN')` |
| `groupBy(array, key)` | Group array by key value | Returns `{key: [rows]}` |
| `countBy(array, key)` | Count by key | Returns `[{label, count}]` |
| `formatDate(dateStr)` | Format date for display | `dd MMM yyyy` via date-fns |
| `safeParseDate(dateStr)` | Parse date string safely | Handles DD/MM/YYYY, DD-MM-YYYY, ISO |
| `daysBetween(from, to)` | Calculate days between dates | Uses date-fns `differenceInDays` |
| `getAgeBucket(days)` | Age bucket label | 0-3, 4-7, 8-15, 15+ Days |
| `isAged(bookingDate, threshold=7)` | Check if shipment is aged | Default 7 days |
| `isDelivered(status)` | Check if delivered | Exact + fuzzy |
| `isPartialDelivered(status)` | Check if partially delivered | |
| `isRTO(status)` | Check if any RTO status | Combines Delivered+InTransit+Partial |
| `isRTODelivered(status)` | RTO completed | |
| `isRTOInTransit(status)` | RTO in transit | |
| `isRTOPartial(status)` | Partial RTO | |
| `isInTransit(status)` | Check if in-transit | Excludes OFD, Delivered, RTO |
| `isOFD(status)` | Check if out for delivery | Fuzzy only (OFD→In-Transit after normalize) |
| `isLost(status)` | Check if lost | |
| `classifyStatus(status)` | Returns classification string | Priority: RTO > Del > OFD > Lost > InTransit > Other |
| `exportToExcel(data, columns, filename)` | Export to .xlsx | Uses SheetJS |
| `readExcelFile(file)` | Read Excel file to JSON | Returns Promise |
| `COLORS` | 15-color palette array | Hex strings for charts |
| `getColor(i)` | Get color by index | Cycles through COLORS |

---

## 15. Git History (Key Commits)

```
730ca92 Fix OKR Overall Cost % calculation and make drill-down context-aware
3ef7892 Convert Vercel API route to CommonJS
33b033b Fix global search for Vercel deployment
d64edfe Fix Vercel API routing
882024a Fix RTO data in In-Transit and reposition Global Search
4a514fd Implement global search engine
fd599b0 Initial KPI Tracking Panel with pivot drill-down
```

---

## 16. App Layout (src/App.jsx)

```
┌─────────┬──────────────────────────────────────────┐
│         │  Header (sticky top, blur background)     │
│         │  ┌─ Title ─── Record Count ─── Search ──┐ │
│ Sidebar │  └─ Filters Bar ────────────────────────┘ │
│ (fixed  │  ┌──────────────────────────────────────┐ │
│  left   │  │                                      │ │
│  w-56)  │  │         Active Page Component        │ │
│         │  │                                      │ │
│         │  └──────────────────────────────────────┘ │
└─────────┴──────────────────────────────────────────┘
```

- Sidebar is fixed left, 56px (or 14px collapsed)
- Main content has `ml-56` margin
- Header is sticky with backdrop blur
- GlobalSearch is in header
- Filters bar is below title
- Loading state shows spinner overlay
- Error state shows retry button

---

## 17. Quick Reference for Common Modifications

### Adding a new page:
1. Create `src/pages/NewPage.jsx`
2. Import in `src/App.jsx`, add to `PAGE_MAP` and `TAB_TITLES`
3. Add to `src/components/Sidebar.jsx` NAV_GROUPS
4. If needs full data: add tab key to the array in DataContext.jsx `loadData()` that maps to `'dashboard'`

### Adding a new KPI owner:
1. Add to `KPI_OWNERS` array in OKR.jsx
2. Add KPI definitions in the `defs` object inside `kpis` useMemo
3. Auto-feed keys in `autoActuals[m]` must match KPI `name` exactly

### Adding a new status classification:
1. Add pattern to `src/utils/statusMapping.js` correctStatus map
2. If RTO pattern: also add to `RTO_INTRANSIT_PATTERNS` in `src/utils/index.js`

### Fixing "blank page" after code change:
- Check browser console for React hooks error
- Most likely cause: `useState` or `useEffect` used inside an IIFE or conditional
- Fix: Move all hooks to top level of component function

### Adding a new filter:
1. Add to `EMPTY_FILTERS` in DataContext.jsx
2. Add filtering logic in `filteredData` useMemo
3. Add dropdown in `Filters.jsx` component
4. Add to `uniqueValues` computation

### Adding a new platform mapping:
1. Add entry to `CONSIGNEE_TO_PLATFORM` in `src/utils/platformMapping.js`
2. Case-insensitive lookup is auto-built from the map

### Adding a chart:
```jsx
import { BarChart, LineChart, DoughnutChart } from '../components/Charts';
<BarChart
  title="My Chart"
  labels={['A','B','C']}
  datasets={[{ label: 'Series 1', data: [10,20,30], color: '#3B82F6' }]}
  height={200}
/>
```

### Accessing data in a page component:
```jsx
import { useData } from '../context/DataContext';
const { data, rawData, loading, error, refreshData } = useData();
// `data` = filtered data, `rawData` = unfiltered
```

### Creating a drill-down modal pattern (used across many pages):
```jsx
const [drillDown, setDrillDown] = useState(null);
// Open: setDrillDown({ title: '...', data: filteredRows });
// Render:
{drillDown && (
  <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm overflow-auto p-4">
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl mt-8 mb-8">
      <div className="flex items-center justify-between px-5 py-3 border-b">
        <h3>{drillDown.title}</h3>
        <button onClick={() => setDrillDown(null)}><X /></button>
      </div>
      <div className="p-4">
        <DataTable data={drillDown.data} columns={cols} />
      </div>
    </div>
  </div>
)}
```

---

## 18. CSS / Styling Notes

- **Tailwind CSS 3.4.x** — utility-first, no custom CSS files except minimal globals
- **Custom CSS classes used:**
  - `.kpi-card` — KPICard wrapper (defined in global CSS)
  - `.filter-bar` — Filters wrapper
  - `.filter-select` — Filter dropdown styling
  - `.chart-container` — Chart wrapper with bg-white, rounded-xl, shadow-sm, border
- **Font:** Inter (system-ui fallback), set via Chart.js defaults
- **Design patterns:** Gradients for headers (indigo-600 to purple-700), rounded-xl cards, shadow-sm borders, text sizes 9px-14px
- **Color convention:** Emerald = good/delivered, Red = bad/RTO, Amber = warning, Indigo/Blue = primary/info, Purple = special
