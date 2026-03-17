import React, { useState, useMemo } from 'react';
import DataTable from '../components/DataTable';
import KPICard from '../components/KPICard';
import FileUpload from '../components/FileUpload';
import { BarChart } from '../components/Charts';
import { Calculator, IndianRupee, Calendar, Package } from 'lucide-react';
import { groupBy, currency } from '../utils/index';

export default function Provision() {
  const [provisionData, setProvisionData] = useState([]);
  const [filterMonth, setFilterMonth] = useState('');
  const [filterPlatform, setFilterPlatform] = useState('');

  const months = useMemo(() => [...new Set(provisionData.map((r) => r.month || r.Month || '').filter(Boolean))], [provisionData]);
  const platforms = useMemo(() => [...new Set(provisionData.map((r) => r.platform || r.Platform || '').filter(Boolean))], [provisionData]);

  const filtered = useMemo(() => {
    return provisionData.filter((r) => {
      const m = r.month || r.Month || '';
      const p = r.platform || r.Platform || '';
      if (filterMonth && m !== filterMonth) return false;
      if (filterPlatform && p !== filterPlatform) return false;
      return true;
    });
  }, [provisionData, filterMonth, filterPlatform]);

  const totalProvision = useMemo(() => {
    return filtered.reduce((sum, r) => {
      const val = parseFloat(r.amount || r.Amount || r.provision || r.Provision || 0);
      return sum + (isNaN(val) ? 0 : val);
    }, 0);
  }, [filtered]);

  const columns = useMemo(() => {
    if (!provisionData.length) return [];
    return Object.keys(provisionData[0]).map((key) => ({
      key,
      label: key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()),
      render: key.toLowerCase().includes('amount') || key.toLowerCase().includes('cost') || key.toLowerCase().includes('provision')
        ? (val) => currency(val)
        : undefined,
    }));
  }, [provisionData]);

  const platformSummary = useMemo(() => {
    const key = provisionData.length ? (provisionData[0].platform !== undefined ? 'platform' : 'Platform') : 'platform';
    const amountKey = provisionData.length
      ? Object.keys(provisionData[0]).find((k) => k.toLowerCase().includes('amount') || k.toLowerCase().includes('provision')) || 'amount'
      : 'amount';

    const groups = groupBy(filtered, key);
    return Object.entries(groups).map(([platform, rows]) => ({
      platform,
      total: rows.reduce((s, r) => s + (parseFloat(r[amountKey]) || 0), 0),
      count: rows.length,
    }));
  }, [filtered, provisionData]);

  return (
    <div className="space-y-4">
      {provisionData.length === 0 ? (
        <>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
            Upload your monthly logistics provision sheet to view the provision summary.
          </div>
          <FileUpload
            label="Upload Provision Sheet (.xlsx, .csv)"
            onDataLoaded={(data) => setProvisionData(data)}
          />
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPICard title="Total Provision" value={currency(totalProvision)} icon={IndianRupee} color="blue" />
            <KPICard title="Records" value={filtered.length} icon={Calculator} color="indigo" />
            <KPICard title="Months" value={months.length} icon={Calendar} color="green" />
            <KPICard title="Platforms" value={platforms.length} icon={Package} color="purple" />
          </div>

          {/* Filters */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-center gap-3">
            <select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} className="filter-select">
              <option value="">All Months</option>
              {months.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={filterPlatform} onChange={(e) => setFilterPlatform(e.target.value)} className="filter-select">
              <option value="">All Platforms</option>
              {platforms.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <button onClick={() => setProvisionData([])} className="btn-secondary text-xs ml-auto">
              Upload New File
            </button>
          </div>

          {platformSummary.length > 0 && (
            <div className="chart-container">
              <BarChart
                title="Provision by Platform"
                labels={platformSummary.map((p) => p.platform)}
                datasets={[{ label: 'Provision', data: platformSummary.map((p) => p.total), color: '#6366F1' }]}
                height={250}
              />
            </div>
          )}

          <DataTable data={filtered} columns={columns} exportFilename="provision-data" />
        </>
      )}
    </div>
  );
}
