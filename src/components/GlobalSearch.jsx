import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, Loader2, Clock3, Filter } from 'lucide-react';
import { useData } from '../context/DataContext';
import { formatDate, currency } from '../utils/index';

const HISTORY_KEY = 'anveshan-global-search-history';

function HighlightText({ text, query }) {
  const value = String(text || '-');
  if (!query || value === '-') return <>{value}</>;

  const tokens = String(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return <>{value}</>;

  const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = value.split(regex);

  return (
    <>
      {parts.map((part, idx) =>
        part && regex.test(part)
          ? <mark key={idx} className="bg-yellow-200/70 rounded px-0.5">{part}</mark>
          : <span key={idx}>{part}</span>
      )}
    </>
  );
}

function ResultCard({ row, query }) {
  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-white hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="text-xs">
          <div className="text-slate-500">AWB: <span className="font-semibold text-slate-700"><HighlightText text={row.awbNo} query={query} /></span></div>
        </div>
        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-700 whitespace-nowrap">{row.status || '-'}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[10px] mb-2">
        <div><span className="text-slate-500">Invoice:</span> <span className="font-medium"><HighlightText text={row.invoiceNo} query={query} /></span></div>
        <div><span className="text-slate-500">PO:</span> <span className="font-medium"><HighlightText text={row.poNumber} query={query} /></span></div>
        <div><span className="text-slate-500">Ref:</span> <span className="font-medium"><HighlightText text={row.refNo} query={query} /></span></div>
        <div><span className="text-slate-500">Platform:</span> <span className="font-medium">{row.platform || '-'}</span></div>
      </div>
      <div className="text-[9px] text-slate-500 border-t pt-2 mt-2">
        <span>Booked: {formatDate(row.bookingDate)} • </span>
        <span>Delivered: {formatDate(row.deliveryDate)} • </span>
        <span>Cost: {currency(row.logisticsCost)}</span>
      </div>
    </div>
  );
}

export default function GlobalSearch() {
  const data = useData();
  const globalSearch = data?.globalSearch;
  const getSearchSuggestions = data?.getSearchSuggestions;

  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [statusFilter, setStatusFilter] = useState('All');
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState(() => {
    try {
      const stored = localStorage.getItem(HISTORY_KEY);
      const parsed = JSON.parse(stored || '[]');
      return Array.isArray(parsed) ? parsed.slice(0, 8) : [];
    } catch (e) {
      console.warn('History parse error:', e);
      return [];
    }
  });

  const inputRef = useRef(null);
  const debounceRef = useRef(null);
  const wrapperRef = useRef(null);

  // Save history to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 8)));
    } catch (e) {
      console.warn('Failed to save history:', e);
    }
  }, [history]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch suggestions as user types
  useEffect(() => {
    if (!query.trim() || !getSearchSuggestions) {
      setSuggestions([]);
      return;
    }

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const response = await getSearchSuggestions(query, { limit: 8 });
        setSuggestions(Array.isArray(response) ? response : []);
      } catch (err) {
        console.error('Suggestions error:', err);
        setSuggestions([]);
      }
    }, 200);

    return () => clearTimeout(debounceRef.current);
  }, [query, getSearchSuggestions]);

  const executeSearch = useCallback(async (searchQuery) => {
    const q = String(searchQuery ?? query).trim();
    if (!q || !globalSearch) return;

    setLoading(true);
    setError('');

    try {
      const response = await globalSearch(q, { limit: 100 });
      setResult(response);
      setStatusFilter('All');
      setHistory((prev) => [q, ...prev.filter((v) => v !== q)]);
    } catch (err) {
      console.error('Search error:', err);
      setError(err.message || 'Search failed');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [globalSearch, query]);

  const filteredResults = useMemo(() => {
    if (!result || !Array.isArray(result.data)) return [];
    if (statusFilter === 'All') return result.data;
    return result.data.filter((row) => row.status === statusFilter);
  }, [result, statusFilter]);

  const statusOptions = useMemo(() => {
    if (!result || !Array.isArray(result.data)) return ['All'];
    const statuses = new Set(result.data.map((r) => r.status).filter(Boolean));
    return ['All', ...Array.from(statuses)];
  }, [result]);

  // Return nothing if functions not available
  if (!globalSearch || !getSearchSuggestions) {
    return null;
  }

  return (
    <div ref={wrapperRef} className="relative w-full">
      {/* Search Input */}
      <div className="flex items-center rounded-lg border border-slate-200 bg-white shadow-sm hover:border-slate-300 transition-colors overflow-hidden">
        <Search className="w-4 h-4 text-slate-400 ml-3 flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') executeSearch();
            if (e.key === 'Escape') setOpen(false);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search AWB, Invoice, PO, Ref..."
          className="flex-1 px-3 py-2 bg-transparent outline-none text-sm text-slate-700 placeholder:text-slate-400"
        />
        {query && (
          <button
            onClick={() => {
              setQuery('');
              setResult(null);
              setOpen(false);
              setSuggestions([]);
              inputRef.current?.focus();
            }}
            className="p-1 mr-1 hover:bg-slate-100 rounded transition-colors"
            title="Clear"
          >
            <X className="w-4 h-4 text-slate-400" />
          </button>
        )}
        <button
          onClick={() => executeSearch()}
          disabled={loading}
          className="px-3 py-2 bg-slate-50 hover:bg-slate-100 disabled:opacity-50 transition-colors border-l border-slate-200"
          title="Search"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin text-slate-600" /> : <Search className="w-4 h-4 text-slate-600" />}
        </button>
      </div>

      {/* Dropdown Menu */}
      {open && (
        <div className="absolute left-0 right-0 top-full mt-2 z-50 bg-white border border-slate-200 rounded-lg shadow-xl max-h-96 overflow-y-auto">
          {/* Loading State */}
          {loading && (
            <div className="p-4 text-center text-slate-600 text-sm flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Searching...
            </div>
          )}

          {/* Error State */}
          {error && !loading && (
            <div className="p-4 text-red-600 text-sm bg-red-50 border-b border-slate-200">
              {error}
            </div>
          )}

          {/* History */}
          {!result && !loading && !query.trim() && history.length > 0 && (
            <div className="p-3 border-b border-slate-200">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                <Clock3 className="w-3 h-3" /> Recent Searches
              </div>
              <div className="flex flex-wrap gap-2">
                {history.map((item) => (
                  <button
                    key={item}
                    onClick={() => {
                      setQuery(item);
                      executeSearch(item);
                    }}
                    className="px-2.5 py-1 text-xs rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Suggestions */}
          {!result && !loading && query.trim() && suggestions.length > 0 && (
            <div className="p-3 border-b border-slate-200">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Suggestions</div>
              <div className="space-y-1">
                {suggestions.map((s, idx) => (
                  <button
                    key={`${s.field}-${s.value}-${idx}`}
                    onClick={() => {
                      setQuery(s.value);
                      executeSearch(s.value);
                    }}
                    className="w-full text-left px-2.5 py-2 rounded-md hover:bg-slate-50 text-xs transition-colors"
                  >
                    <span className="text-slate-500">{s.fieldLabel}:</span>{' '}
                    <span className="font-medium text-slate-700">{s.value}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Results */}
          {result && !loading && (
            <div className="p-3 space-y-3">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200">
                <div className="text-xs text-slate-600">
                  <span className="font-semibold text-slate-900">{result.total || 0}</span> result(s)
                  {result.detectedTypeLabel && <span className="text-slate-500 ml-1">• {result.detectedTypeLabel}</span>}
                </div>
                {statusOptions.length > 1 && (
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="text-xs border border-slate-200 rounded px-2 py-1 bg-white hover:border-slate-300"
                  >
                    {statusOptions.map((st) => (
                      <option key={st} value={st}>{st}</option>
                    ))}
                  </select>
                )}
              </div>

              {filteredResults.length === 0 ? (
                <div className="text-xs text-slate-600 bg-slate-50 p-3 rounded-lg text-center">
                  No results found. Try different search terms.
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredResults.slice(0, 10).map((row, idx) => (
                    <ResultCard key={`${row.awbNo}-${idx}`} row={row} query={query} />
                  ))}
                  {filteredResults.length > 10 && (
                    <div className="text-xs text-slate-500 text-center py-2">
                      Showing 10 of {filteredResults.length} results
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Empty State */}
          {!result && !loading && !error && !query.trim() && history.length === 0 && (
            <div className="p-8 text-center text-slate-400 text-xs">
              Start searching by entering an AWB, Invoice, PO or Ref number
            </div>
          )}
        </div>
      )}
    </div>
  );
}
