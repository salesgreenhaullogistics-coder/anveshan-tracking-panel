import React from 'react';
import { Search, X, SlidersHorizontal, AlertCircle } from 'lucide-react';
import { useData } from '../context/DataContext';

export default function Filters() {
  const { pendingFilters, setPendingFilters, applyFilters, clearFilters, uniqueValues, filters } = useData();

  const update = (key, value) => setPendingFilters((prev) => ({ ...prev, [key]: value }));
  const hasFilters = Object.values(filters).some(Boolean);
  const hasPending = Object.values(pendingFilters).some(Boolean);

  const handleKeyDown = (e) => { if (e.key === 'Enter') applyFilters(); };

  return (
    <div className="filter-bar">
      {hasFilters && (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-50 border border-blue-200 rounded-lg">
          <AlertCircle className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
          <span className="text-[10px] font-semibold text-blue-700">Filters Active</span>
        </div>
      )}

      <div className="flex items-center gap-1.5 text-gray-500 mr-1">
        <SlidersHorizontal className="w-3.5 h-3.5" />
        <span className="text-[10px] font-bold uppercase tracking-widest">Filters</span>
      </div>

      <select value={pendingFilters.platform} onChange={(e) => update('platform', e.target.value)} className="filter-select" onKeyDown={handleKeyDown}>
        <option value="">All Platforms</option>
        {uniqueValues.platforms.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>

      <select value={pendingFilters.courier} onChange={(e) => update('courier', e.target.value)} className="filter-select" onKeyDown={handleKeyDown}>
        <option value="">All Couriers</option>
        {uniqueValues.couriers.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>

      <select value={pendingFilters.zone} onChange={(e) => update('zone', e.target.value)} className="filter-select" onKeyDown={handleKeyDown}>
        <option value="">All Zones</option>
        {uniqueValues.zones.map((z) => <option key={z} value={z}>{z}</option>)}
      </select>

      <select value={pendingFilters.city} onChange={(e) => update('city', e.target.value)} className="filter-select" onKeyDown={handleKeyDown}>
        <option value="">All Cities</option>
        {uniqueValues.cities.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>

      <div className="flex items-center gap-1">
        <label className="text-[10px] text-gray-400 font-medium">From</label>
        <input type="date" value={pendingFilters.dateFrom} onChange={(e) => update('dateFrom', e.target.value)} className="filter-input text-xs" onKeyDown={handleKeyDown} />
      </div>

      <div className="flex items-center gap-1">
        <label className="text-[10px] text-gray-400 font-medium">To</label>
        <input type="date" value={pendingFilters.dateTo} onChange={(e) => update('dateTo', e.target.value)} className="filter-input text-xs" onKeyDown={handleKeyDown} />
      </div>

      <select value={pendingFilters.month} onChange={(e) => update('month', e.target.value)} className="filter-select" onKeyDown={handleKeyDown}>
        <option value="">All Months</option>
        {uniqueValues.months.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>

      <button onClick={applyFilters} className="search-btn" title="Apply filters">
        <Search className="w-3.5 h-3.5" />
        Apply
      </button>

      {(hasFilters || hasPending) && (
        <button onClick={clearFilters} className="clear-btn" title="Clear all filters">
          <X className="w-3 h-3" />
          Clear
        </button>
      )}
    </div>
  );
}
