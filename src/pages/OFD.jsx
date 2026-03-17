import React, { useMemo } from 'react';
import { useData } from '../context/DataContext';
import DataTable from '../components/DataTable';
import KPICard from '../components/KPICard';
import { BarChart } from '../components/Charts';
import { PackageCheck, Package } from 'lucide-react';
import { isOFD, formatDate, groupBy } from '../utils/index';

const COLUMNS = [
  { key: 'awbNo', label: 'AWB No' },
  { key: 'invoiceNo', label: 'Invoice No' },
  { key: 'vendor', label: 'Courier' },
  { key: 'platform', label: 'Platform' },
  { key: 'origin', label: 'Origin' },
  { key: 'destination', label: 'Destination' },
  { key: 'status', label: 'Status', render: (val) => (
    <span className="badge badge-yellow">{val}</span>
  )},
  { key: 'bookingDate', label: 'Booking Date', render: (val) => formatDate(val) },
  { key: 'edd', label: 'EDD', render: (val) => formatDate(val) },
  { key: 'zone', label: 'Zone' },
  { key: 'boxes', label: 'Boxes' },
];

export default function OFD() {
  const { data } = useData();

  const ofdData = useMemo(() => data.filter((r) => isOFD(r.status)), [data]);

  const platformBreakdown = useMemo(() => {
    const groups = groupBy(ofdData, 'platform');
    return Object.entries(groups).map(([k, v]) => ({ platform: k, count: v.length }));
  }, [ofdData]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KPICard title="OFD Shipments" value={ofdData.length} icon={PackageCheck} color="yellow" />
        <KPICard title="Platforms" value={platformBreakdown.length} icon={Package} color="blue" />
        <KPICard
          title="Top Platform"
          value={platformBreakdown.sort((a, b) => b.count - a.count)[0]?.platform || '-'}
          icon={Package}
          color="indigo"
        />
      </div>

      <div className="chart-container">
        <BarChart
          title="OFD by Platform"
          labels={platformBreakdown.map((p) => p.platform)}
          datasets={[{ label: 'Shipments', data: platformBreakdown.map((p) => p.count), color: '#F59E0B' }]}
          height={200}
        />
      </div>

      <DataTable data={ofdData} columns={COLUMNS} exportFilename="ofd-shipments" />
    </div>
  );
}
