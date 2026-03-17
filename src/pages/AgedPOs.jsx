import React, { useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import DataTable from '../components/DataTable';
import KPICard from '../components/KPICard';
import { BarChart, PieChart } from '../components/Charts';
import { Clock, AlertTriangle } from 'lucide-react';
import { safeParseDate, formatDate, getAgeBucket, isAged, groupBy } from '../utils/index';

const AGE_FILTERS = ['All', '0-3 Days', '4-7 Days', '8-15 Days', '15+ Days'];

export default function AgedPOs() {
  const { data } = useData();
  const [ageFilter, setAgeFilter] = useState('All');

  const agedData = useMemo(() => {
    return data
      .filter((r) => isAged(r.bookingDate, 7))
      .map((r) => {
        const bd = safeParseDate(r.bookingDate);
        const age = bd ? Math.floor((new Date() - bd) / (1000 * 60 * 60 * 24)) : 0;
        return { ...r, age, ageBucket: getAgeBucket(age) };
      });
  }, [data]);

  const filteredData = useMemo(() => {
    if (ageFilter === 'All') return agedData;
    return agedData.filter((r) => r.ageBucket === ageFilter);
  }, [agedData, ageFilter]);

  const bucketCounts = useMemo(() => {
    const counts = { '0-3 Days': 0, '4-7 Days': 0, '8-15 Days': 0, '15+ Days': 0 };
    agedData.forEach((r) => {
      if (counts[r.ageBucket] !== undefined) counts[r.ageBucket]++;
    });
    return counts;
  }, [agedData]);

  const platformBreakdown = useMemo(() => {
    const groups = groupBy(filteredData, 'platform');
    return Object.entries(groups).map(([k, v]) => ({ platform: k, count: v.length }));
  }, [filteredData]);

  const COLUMNS = [
    { key: 'awbNo', label: 'AWB No' },
    { key: 'invoiceNo', label: 'Invoice No' },
    { key: 'vendor', label: 'Courier' },
    { key: 'platform', label: 'Platform' },
    { key: 'destination', label: 'Destination' },
    { key: 'status', label: 'Status' },
    { key: 'bookingDate', label: 'Booking Date', render: (val) => formatDate(val) },
    { key: 'age', label: 'Age (Days)', render: (val) => (
      <span className={`badge ${val > 15 ? 'badge-red' : val > 7 ? 'badge-yellow' : 'badge-green'}`}>
        {val} days
      </span>
    )},
    { key: 'ageBucket', label: 'Age Bucket' },
    { key: 'appointmentDate', label: 'Appointment', render: (val) => formatDate(val) },
    { key: 'zone', label: 'Zone' },
    { key: 'poNumber', label: 'PO Number' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard title="Total Aged POs" value={agedData.length} icon={Clock} color="red" />
        <KPICard title="8-15 Days" value={bucketCounts['8-15 Days']} icon={AlertTriangle} color="yellow" />
        <KPICard title="15+ Days" value={bucketCounts['15+ Days']} icon={AlertTriangle} color="red" />
        <KPICard title="Platforms Affected" value={new Set(agedData.map((r) => r.platform)).size} icon={Clock} color="purple" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="chart-container">
          <BarChart
            title="Age Bucket Distribution"
            labels={Object.keys(bucketCounts)}
            datasets={[{ label: 'Shipments', data: Object.values(bucketCounts), color: '#8B5CF6' }]}
            height={200}
          />
        </div>
        <div className="chart-container">
          <PieChart
            title="Aged POs by Platform"
            labels={platformBreakdown.map((p) => p.platform)}
            data={platformBreakdown.map((p) => p.count)}
            height={200}
          />
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {AGE_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setAgeFilter(f)}
            className={`tab-btn ${ageFilter === f ? 'tab-btn-active' : 'tab-btn-inactive'}`}
          >
            {f} {f !== 'All' ? `(${bucketCounts[f] || 0})` : `(${agedData.length})`}
          </button>
        ))}
      </div>

      <DataTable data={filteredData} columns={COLUMNS} exportFilename="aged-pos" />
    </div>
  );
}
