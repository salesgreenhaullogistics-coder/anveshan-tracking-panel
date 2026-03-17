import React, { useMemo, useState, useCallback } from 'react';
import { useData } from '../context/DataContext';
import DataTable from '../components/DataTable';
import KPICard from '../components/KPICard';
import { BarChart } from '../components/Charts';
import { FileText, Search, Download, Eye, X, FileImage, File, ExternalLink, Loader2 } from 'lucide-react';
import { formatDate, groupBy, percent } from '../utils/index';

/*
 * ────────────────────────────────────────────────────
 *  POD Preview — purely from Google Sheet data
 * ────────────────────────────────────────────────────
 *  Column X ("POD") has hyperlinks. The Apps Script
 *  returns the actual URL as "POD Link" → mapped to
 *  row.podUrl. If podUrl is empty, we fall back to
 *  using the pod (filename) value directly.
 * ────────────────────────────────────────────────────
 */

const SUB_TABS = ['Search POD', 'Pending PODs'];

/* ─── Helpers ────────────────────────────────────────── */

/** Get the POD URL from the row — uses podUrl (hyperlink) or pod value */
function getPodUrl(row) {
  if (row.podUrl && row.podUrl.trim()) return row.podUrl.trim();
  const pod = (row.pod || '').trim();
  if (pod.startsWith('http://') || pod.startsWith('https://')) return pod;
  return pod; // filename only — won't render inline but kept for display
}

function podFileExt(val) {
  if (!val) return '';
  const clean = val.split('?')[0].split('#')[0];
  const dot = clean.lastIndexOf('.');
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : '';
}

function isUrl(val) {
  return val && (val.startsWith('http://') || val.startsWith('https://'));
}

function hasPod(podVal) {
  return podVal && podVal.trim() !== '' && podVal.trim() !== '-' && podVal.trim().toLowerCase() !== 'na';
}

/* ─── POD Preview Modal ──────────────────────────────── */
function PodPreviewModal({ url, filename, awb, onClose }) {
  if (!url) return null;
  const ext = podFileExt(url) || podFileExt(filename);
  const isImage = ['jpeg', 'jpg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext);
  const isPdf = ext === 'pdf';
  const hasValidUrl = isUrl(url);
  const [imgError, setImgError] = useState(false);
  const [imgLoading, setImgLoading] = useState(isImage && hasValidUrl);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-gray-50/80">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-1.5 bg-blue-50 rounded-lg">
              {isImage ? <FileImage className="w-4 h-4 text-blue-600" /> : <File className="w-4 h-4 text-blue-600" />}
            </div>
            <div className="min-w-0">
              <h3 className="text-[13px] font-semibold text-gray-800 truncate">POD Preview {awb ? `— ${awb}` : ''}</h3>
              <p className="text-[10px] text-gray-400 truncate">{filename || url}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 ml-3">
            {hasValidUrl && (
              <>
                <a
                  href={url}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-[11px] font-medium hover:bg-blue-700 transition-colors shadow-sm"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </a>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-gray-200 bg-white text-gray-600 rounded-lg text-[11px] font-medium hover:bg-gray-50 transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  Open
                </a>
              </>
            )}
            <button onClick={onClose} className="p-1.5 hover:bg-gray-200 rounded-lg transition-colors">
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Preview Body */}
        <div className="flex-1 overflow-auto bg-gray-100 flex items-center justify-center p-4 min-h-[320px]">
          {!hasValidUrl ? (
            /* No valid URL — Apps Script needs updating */
            <div className="text-center space-y-4 py-10 max-w-md">
              <div className="mx-auto w-16 h-16 bg-amber-50 rounded-xl flex items-center justify-center">
                <FileImage className="w-8 h-8 text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700">POD URL not available</p>
                <p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed">
                  The Google Sheet has a hyperlink in Column X, but the Apps Script
                  is only returning the filename — not the actual URL.<br /><br />
                  To fix this, update the Apps Script in your Google Sheet using
                  the code in <strong>scripts/update-apps-script.gs</strong>.<br />
                  (Extensions → Apps Script → replace doGet → Deploy new version)
                </p>
              </div>
            </div>
          ) : isImage && !imgError ? (
            /* Image preview */
            <div className="relative flex items-center justify-center w-full">
              {imgLoading && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                    <p className="text-xs text-gray-500">Loading POD image…</p>
                  </div>
                </div>
              )}
              <img
                src={url}
                alt={`POD ${awb || ''}`}
                className={`max-w-full max-h-[65vh] rounded-lg shadow-md object-contain bg-white transition-opacity ${imgLoading ? 'opacity-0' : 'opacity-100'}`}
                onLoad={() => setImgLoading(false)}
                onError={() => { setImgLoading(false); setImgError(true); }}
              />
            </div>
          ) : isPdf && !imgError ? (
            /* PDF preview */
            <iframe
              src={url}
              title="POD PDF Preview"
              className="w-full h-[65vh] rounded-lg border border-gray-200 bg-white"
              onError={() => setImgError(true)}
            />
          ) : imgError ? (
            /* Load error fallback */
            <div className="text-center space-y-4 py-10 max-w-md">
              <div className="mx-auto w-16 h-16 bg-amber-50 rounded-xl flex items-center justify-center">
                <FileImage className="w-8 h-8 text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700">Could not load preview</p>
                <p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed">
                  The image could not be displayed inline. Try opening it in a new tab.
                </p>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors shadow-sm"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open POD in New Tab
                </a>
              </div>
            </div>
          ) : (
            /* Unsupported file type */
            <div className="text-center space-y-4 py-10">
              <div className="mx-auto w-16 h-16 bg-blue-50 rounded-xl flex items-center justify-center">
                <File className="w-8 h-8 text-blue-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">{ext.toUpperCase() || 'Unknown'} File</p>
                <p className="text-[11px] text-gray-400 mt-1">Use the Download or Open button above to view.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Main PODs Page ─────────────────────────────────── */
export default function PODs() {
  const { data } = useData();
  const [subTab, setSubTab] = useState('Search POD');
  const [searchType, setSearchType] = useState('awbNo');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [podPreview, setPodPreview] = useState(null); // { url, filename, awb }

  const podData = useMemo(() => data.filter((r) => hasPod(r.pod)), [data]);
  const pendingPods = useMemo(() => data.filter((r) => !hasPod(r.pod)), [data]);

  const platformPodStats = useMemo(() => {
    const groups = groupBy(data, 'platform');
    return Object.entries(groups)
      .filter(([p]) => p && p !== '' && p.toLowerCase() !== 'unknown')
      .map(([platform, rows]) => ({
        platform,
        total: rows.length,
        withPod: rows.filter((r) => hasPod(r.pod)).length,
      }));
  }, [data]);

  const handleSearch = useCallback(() => {
    if (!searchQuery.trim()) return;
    const rawValues = searchQuery
      .split(/[,;\n|]+/)
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
    if (rawValues.length === 0) return;
    const results = data.filter((r) => {
      const fieldVal = (r[searchType] || '').toLowerCase();
      if (!fieldVal) return false;
      return rawValues.some((q) => fieldVal.includes(q));
    });
    setSearchResults(results);
  }, [searchQuery, searchType, data]);

  const openPodPreview = useCallback((row) => {
    const url = getPodUrl(row);
    setPodPreview({ url, filename: (row.pod || '').trim(), awb: row.awbNo });
  }, []);

  const SEARCH_COLUMNS = useMemo(() => [
    { key: 'awbNo', label: 'AWB No' },
    { key: 'invoiceNo', label: 'Invoice No' },
    { key: 'vendor', label: 'Courier' },
    { key: 'platform', label: 'Platform' },
    { key: 'status', label: 'Status' },
    { key: 'bookingDate', label: 'Booking Date', render: (val) => formatDate(val) },
    { key: 'deliveryDate', label: 'Delivery Date', render: (val) => formatDate(val) },
    {
      key: 'pod',
      label: 'POD',
      sortable: false,
      render: (val, row) => hasPod(val) ? (
        <button
          onClick={(e) => { e.stopPropagation(); openPodPreview(row); }}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-600 text-white rounded-md text-[10px] font-medium hover:bg-blue-700 active:bg-blue-800 transition-colors shadow-sm"
        >
          <Eye className="w-3 h-3" />
          View POD
        </button>
      ) : (
        <span className="inline-flex items-center px-2 py-0.5 bg-gray-100 text-gray-400 rounded-md text-[10px] font-medium">
          Pending
        </span>
      ),
    },
    { key: 'zone', label: 'Zone' },
  ], [openPodPreview]);

  const PENDING_COLUMNS = [
    { key: 'awbNo', label: 'AWB No' },
    { key: 'invoiceNo', label: 'Invoice No' },
    { key: 'vendor', label: 'Courier' },
    { key: 'platform', label: 'Platform' },
    { key: 'destination', label: 'Destination' },
    { key: 'status', label: 'Status' },
    { key: 'bookingDate', label: 'Booking Date', render: (val) => formatDate(val) },
    { key: 'deliveryDate', label: 'Delivery Date', render: (val) => formatDate(val) },
    { key: 'zone', label: 'Zone' },
  ];

  const placeholderText = {
    awbNo: 'Enter AWB / LR numbers (comma-separated for multiple)',
    invoiceNo: 'Enter Invoice numbers (comma-separated for multiple)',
    poNumber: 'Enter PO numbers (comma-separated for multiple)',
    refNo: 'Enter Reference numbers (comma-separated for multiple)',
  };

  return (
    <div className="space-y-4">
      {podPreview && (
        <PodPreviewModal
          url={podPreview.url}
          filename={podPreview.filename}
          awb={podPreview.awb}
          onClose={() => setPodPreview(null)}
        />
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard title="Total with POD" value={podData.length} icon={FileText} color="green" />
        <KPICard title="Pending PODs" value={pendingPods.length} icon={FileText} color="red" />
        <KPICard title="POD Visibility" value={`${percent(podData.length, data.length)}%`} icon={Eye} color="blue" />
        <KPICard title="Total Records" value={data.length} icon={FileText} color="gray" />
      </div>

      <div className="chart-container">
        <BarChart
          title="POD Visibility by Platform"
          labels={platformPodStats.map((p) => p.platform)}
          datasets={[
            { label: 'With POD', data: platformPodStats.map((p) => p.withPod), color: '#10B981' },
            { label: 'Total', data: platformPodStats.map((p) => p.total), color: '#E5E7EB' },
          ]}
          options={{ plugins: { legend: { display: true, position: 'top' } } }}
          height={200}
        />
      </div>

      <div className="flex gap-2 flex-wrap">
        {SUB_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setSubTab(tab)}
            className={`tab-btn ${subTab === tab ? 'tab-btn-active' : 'tab-btn-inactive'}`}
          >
            {tab}
          </button>
        ))}
      </div>

      {subTab === 'Search POD' ? (
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Search POD</h3>
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Search By</label>
                <select
                  value={searchType}
                  onChange={(e) => { setSearchType(e.target.value); setSearchResults(null); }}
                  className="filter-select"
                >
                  <option value="awbNo">AWB / LR Number</option>
                  <option value="invoiceNo">Invoice No</option>
                  <option value="poNumber">PO Number</option>
                  <option value="refNo">Reference No</option>
                </select>
              </div>
              <div className="flex-1 min-w-[250px]">
                <label className="block text-xs text-gray-500 mb-1">
                  Search Query
                  <span className="text-[10px] text-gray-400 ml-1.5">(use commas to search multiple values)</span>
                </label>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder={placeholderText[searchType] || 'Enter search value...'}
                  className="filter-input w-full"
                />
              </div>
              <button onClick={handleSearch} className="btn-primary flex items-center gap-1.5">
                <Search className="w-4 h-4" />
                Search
              </button>
            </div>
            {searchQuery.includes(',') && (
              <div className="mt-2 text-[10px] text-blue-500 bg-blue-50 px-3 py-1.5 rounded-lg inline-flex items-center gap-1">
                <Search className="w-3 h-3" />
                Searching {searchQuery.split(/[,;\n|]+/).filter((v) => v.trim()).length} values
              </div>
            )}
          </div>
          {searchResults !== null && (
            <DataTable
              data={searchResults}
              columns={SEARCH_COLUMNS}
              exportFilename="pod-search-results"
              emptyMessage="No POD records found for this search"
            />
          )}
        </div>
      ) : (
        <DataTable data={pendingPods} columns={PENDING_COLUMNS} exportFilename="pending-pods" />
      )}
    </div>
  );
}
