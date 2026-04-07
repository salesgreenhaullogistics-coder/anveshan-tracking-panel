import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, Loader2, Clock3, Filter, Settings2 } from 'lucide-react';
import { useData } from '../context/DataContext';
import { formatDate, currency } from '../utils/index';

const HISTORY_KEY = 'anveshan-global-search-history';

function tokenize(query) {
  return String(query || '')
    .split(/[\s,;|]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function HighlightText({ text, query }) {
  const value = String(text || '-');
  const tokens = tokenize(query);
  if (!tokens.length || value === '-') return <>{value}</>;

  const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  if (!escaped) return <>{value}</>;

  const regex = new RegExp(`(${escaped})`, 'ig');
  const parts = value.split(regex);
  return (
    <>
      {parts.map((part, idx) => (
        part && new RegExp(`^(${escaped})$`, 'i').test(part)
          ? <mark key={idx} className="bg-yellow-200/70 rounded px-0.5">{part}</mark>
          : <React.Fragment key={idx}>{part}</React.Fragment>
      ))}
    </>
  );
}

function ResultCard({ row, query }) {
  const timeline = [
    { label: 'Booked', value: formatDate(row.bookingDate) },
    { label: 'Appointment', value: formatDate(row.appointmentDate) },
    { label: 'Delivered', value: formatDate(row.deliveryDate) },
  ];

  return (
    <div className="border border-slate-200 rounded-xl p-3 bg-white">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs text-slate-500">AWB: <span className="font-semibold text-slate-700"><HighlightText text={row.awbNo} query={query} /></span></div>
        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700">{row.status || '-'}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
        <div><div className="text-slate-400">Invoice</div><div className="font-medium text-slate-700"><HighlightText text={row.invoiceNo} query={query} /></div></div>
        <div><div className="text-slate-400">PO</div><div className="font-medium text-slate-700"><HighlightText text={row.poNumber} query={query} /></div></div>
        <div><div className="text-slate-400">Ref. No.</div><div className="font-medium text-slate-700"><HighlightText text={row.refNo} query={query} /></div></div>
        <div><div className="text-slate-400">Courier / Platform</div><div className="font-medium text-slate-700">{row.vendor || '-'} / {row.platform || '-'}</div></div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
        <span>Booked: {formatDate(row.bookingDate)}</span>
        <span>Appointment: {formatDate(row.appointmentDate)}</span>
        <span>Delivered: {formatDate(row.deliveryDate)}</span>
        <span>Cost: {currency(row.logisticsCost)}</span>
      </div>
      <div className="mt-2 flex items-center gap-2 overflow-x-auto pb-1">
        {timeline.map((item, idx) => (
          <React.Fragment key={item.label}>
            <div className="rounded-md bg-slate-50 border border-slate-200 px-2 py-1 min-w-max">
              <div className="text-[9px] uppercase tracking-wide text-slate-400">{item.label}</div>
              <div className="text-[10px] font-medium text-slate-700">{item.value}</div>
            </div>
            {idx < timeline.length - 1 && <div className="text-slate-300 text-[10px]">→</div>}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

export default function GlobalSearch() {
  const { globalSearch, getSearchSuggestions } = useData();

  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [statusFilter, setStatusFilter] = useState('All');
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const inputRef = useRef(null);
  const debounceRef = useRef(null);
  const wrapperRef = useRef(null);

  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 8)));
  }, [history]);

  useEffect(() => {
    const onMouseDown = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setSuggestions([]);
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const list = await getSearchSuggestions(query, { limit: 8 });
        setSuggestions(list);
      } catch {
        setSuggestions([]);
      }
    }, 180);

    return () => clearTimeout(debounceRef.current);
  }, [query, getSearchSuggestions]);

  const executeSearch = useCallback(async (incomingQuery) => {
    const q = String(incomingQuery ?? query).trim();
    if (!q) return;

    setLoading(true);
    setError('');
    setOpen(true);

    try {
      const payload = await globalSearch(q, { limit: 100 });
      setResult(payload);
      setStatusFilter('All');
      setHistory((prev) => [q, ...prev.filter((v) => v !== q)].slice(0, 8));
    } catch (err) {
      setError(err.message || 'Search failed');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [globalSearch, query]);

  const filteredResults = useMemo(() => {
    const rows = result?.data || [];
    if (statusFilter === 'All') return rows;
    return rows.filter((row) => row.status === statusFilter);
  }, [result, statusFilter]);

  const statusOptions = useMemo(() => {
    const rows = result?.data || [];
    const set = new Set(rows.map((r) => r.status).filter(Boolean));
    return ['All', ...Array.from(set)];
  }, [result]);

  return (
    <div ref={wrapperRef} className="relative w-full max-w-md">
      <div className="flex items-stretch rounded-md border border-slate-300 bg-[#f2f2f5] shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-1.5 flex-1 min-w-0">
          <Search className="w-4 h-4 text-slate-400" />
        <input
          ref={inputRef}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && executeSearch()}
          placeholder="Search Orders"
          className="w-full bg-transparent outline-none text-sm text-slate-700 placeholder:text-slate-500"
        />
          {query && <button onClick={() => { setQuery(''); setResult(null); setOpen(false); }} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>}
        </div>
        <button
          onClick={() => executeSearch()}
          title="Search"
          className="px-2.5 border-l border-slate-300 bg-[#ececf0] hover:bg-[#e4e4ea] transition-colors flex items-center gap-2"
        >
          <Settings2 className="w-3.5 h-3.5 text-slate-600" />
          <span className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]" />
        </button>
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-40 bg-white border border-slate-200 rounded-xl shadow-lg p-3 max-h-[70vh] overflow-auto">
          {!result && !loading && !query.trim() && history.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1"><Clock3 className="w-3 h-3" /> Recent Searches</div>
              <div className="flex flex-wrap gap-2">
                {history.map((item) => (
                  <button key={item} onClick={() => { setQuery(item); executeSearch(item); }} className="px-2 py-1 text-xs rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200">{item}</button>
                ))}
              </div>
            </div>
          )}

          {!result && !loading && query.trim() && suggestions.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Suggestions</div>
              <div className="space-y-1">
                {suggestions.map((s, idx) => (
                  <button
                    key={`${s.field}-${s.value}-${idx}`}
                    onClick={() => {
                      setQuery(s.value);
                      executeSearch(s.value);
                    }}
                    className="w-full text-left px-2 py-1.5 rounded-md hover:bg-slate-50 text-xs"
                  >
                    <span className="text-slate-500">{s.fieldLabel}: </span>
                    <span className="font-medium text-slate-700"><HighlightText text={s.value} query={query} /></span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {loading && (
            <div className="flex items-center gap-2 text-xs text-slate-600"><Loader2 className="w-4 h-4 animate-spin" /> Searching shipments...</div>
          )}

          {error && <div className="text-xs text-red-600">{error}</div>}

          {result && !loading && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-xs text-slate-700">
                  <span className="font-semibold">{result.total}</span> result(s)
                  <span className="text-slate-500"> | Detected Type: {result.detectedTypeLabel || 'Mixed'}</span>
                </div>
                {statusOptions.length > 1 && (
                  <div className="flex items-center gap-2">
                    <Filter className="w-3.5 h-3.5 text-slate-400" />
                    <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="text-xs border border-slate-200 rounded-md px-2 py-1">
                      {statusOptions.map((st) => <option key={st} value={st}>{st}</option>)}
                    </select>
                  </div>
                )}
              </div>

              {filteredResults.length === 0 ? (
                <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
                  No Data Found. Try full AWB/Invoice value, fewer tokens, or check for typos.
                </div>
              ) : filteredResults.length === 1 ? (
                <ResultCard row={filteredResults[0]} query={query} />
              ) : (
                <div className="space-y-2">
                  {filteredResults.map((row) => (
                    <ResultCard key={`${row.awbNo}-${row.invoiceNo}-${row.poNumber}`} row={row} query={query} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
