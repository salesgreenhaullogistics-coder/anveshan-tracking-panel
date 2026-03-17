import React, { useMemo } from 'react';
import { useData } from '../context/DataContext';
import DataTable from '../components/DataTable';
import KPICard from '../components/KPICard';
import { BarChart } from '../components/Charts';
import { Truck, Package, Clock } from 'lucide-react';
import { isInTransit, formatDate, groupBy, getAgeBucket, safeParseDate } from '../utils/index';

const COLUMNS = [
  { key: 'awbNo', label: 'AWB No' },
  { key: 'invoiceNo', label: 'Invoice No' },
  { key: 'vendor', label: 'Courier' },
  { key: 'platform', label: 'Platform' },
  { key: 'origin', label: 'Origin' },
  { key: 'destination', label: 'Destination' },
  { key: 'status', label: 'Status', render: (val) => (
    <span className="badge badge-blue">{val}</span>
  )},
  { key: 'bookingDate', label: 'Booking Date', render: (val) => formatDate(val) },
  { key: 'edd', label: 'EDD', render: (val) => formatDate(val) },
  { key: 'zone', label: 'Zone' },
  { key: 'boxes', label: 'Boxes' },
];

export default function InTransit() {
  const { data } = useData();

  const inTransitData = useMemo(() => data.filter((r) => isInTransit(r.status)), [data]);

  const platformBreakdown = useMemo(() => {
    const groups = groupBy(inTransitData, 'platform');
    return Object.entries(groups).map(([k, v]) => ({ platform: k, count: v.length }));
  }, [inTransitData]);

  const ageBuckets = useMemo(() => {
    const buckets = { '0-3 Days': 0, '4-7 Days': 0, '8-15 Days': 0, '15+ Days': 0 };
    inTransitData.forEach((r) => {
      const bd = safeParseDate(r.bookingDate);
      if (bd) {
        const age = Math.floor((new Date() - bd) / (1000 * 60 * 60 * 24));
        const bucket = getAgeBucket(age);
        if (buckets[bucket] !== undefined) buckets[bucket]++;
      }
    });
    return buckets;
  }, [inTransitData]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard title="In-Transit Shipments" value={inTransitData.length} icon={Truck} color="indigo" />
        <KPICard title="Platforms" value={platformBreakdown.length} icon={Package} color="blue" />
        <KPICard title="Aged (8+ Days)" value={ageBuckets['8-15 Days'] + ageBuckets['15+ Days']} icon={Clock} color="red" />
        <KPICard title="Fresh (0-3 Days)" value={ageBuckets['0-3 Days']} icon={Clock} color="green" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="chart-container">
          <BarChart
            title="In-Transit by Platform"
            labels={platformBreakdown.map((p) => p.platform)}
            datasets={[{ label: 'Shipments', data: platformBreakdown.map((p) => p.count), color: '#6366F1' }]}
            height={250}
          />
        </div>
        <div className="chart-container">
          <BarChart
            title="Age Bucket"
            labels={Object.keys(ageBuckets)}
            datasets={[{ label: 'Shipments', data: Object.values(ageBuckets), color: '#F59E0B' }]}
            height={250}
          />
        </div>
      </div>

      <DataTable
        data={inTransitData}
        columns={COLUMNS}
        exportFilename="in-transit-shipments"
      />
    </div>
  );
}
