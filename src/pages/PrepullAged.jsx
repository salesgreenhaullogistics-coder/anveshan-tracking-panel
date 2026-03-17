import React, { useMemo } from 'react';
import { useData } from '../context/DataContext';
import DataTable from '../components/DataTable';
import KPICard from '../components/KPICard';
import { BarChart } from '../components/Charts';
import { Timer, AlertTriangle } from 'lucide-react';
import { safeParseDate, formatDate, daysBetween, groupBy } from '../utils/index';

export default function PrepullAged() {
  const { data } = useData();

  const prepullData = useMemo(() => {
    return data.filter((r) => {
      const apptDate = safeParseDate(r.appointmentDate);
      const eddDate = safeParseDate(r.edd);
      if (!apptDate || !eddDate) return false;
      const diff = daysBetween(r.edd, r.appointmentDate);
      return diff !== null && diff > 7;
    }).map((r) => ({
      ...r,
      delayDays: daysBetween(r.edd, r.appointmentDate),
    }));
  }, [data]);

  const platformBreakdown = useMemo(() => {
    const groups = groupBy(prepullData, 'platform');
    return Object.entries(groups).map(([k, v]) => ({ platform: k, count: v.length }));
  }, [prepullData]);

  const COLUMNS = [
    { key: 'awbNo', label: 'AWB No' },
    { key: 'invoiceNo', label: 'Invoice No' },
    { key: 'vendor', label: 'Courier' },
    { key: 'platform', label: 'Platform' },
    { key: 'destination', label: 'Destination' },
    { key: 'status', label: 'Status' },
    { key: 'bookingDate', label: 'Booking Date', render: (val) => formatDate(val) },
    { key: 'edd', label: 'EDD', render: (val) => formatDate(val) },
    { key: 'appointmentDate', label: 'Appointment Date', render: (val) => formatDate(val) },
    { key: 'delayDays', label: 'Delay (Days)', render: (val) => (
      <span className={`badge ${val > 15 ? 'badge-red' : 'badge-yellow'}`}>{val} days</span>
    )},
    { key: 'zone', label: 'Zone' },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        Showing shipments where Appointment Date exceeds EDD by more than 7 days (late appointment allocations).
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KPICard title="Prepull Aged" value={prepullData.length} icon={Timer} color="yellow" />
        <KPICard title="Platforms Affected" value={platformBreakdown.length} icon={AlertTriangle} color="red" />
        <KPICard
          title="Avg Delay"
          value={
            prepullData.length
              ? Math.round(prepullData.reduce((s, r) => s + (r.delayDays || 0), 0) / prepullData.length)
              : 0
          }
          suffix="days"
          icon={Timer}
          color="orange"
        />
      </div>

      <div className="chart-container">
        <BarChart
          title="Prepull Aged by Platform"
          labels={platformBreakdown.map((p) => p.platform)}
          datasets={[{ label: 'Shipments', data: platformBreakdown.map((p) => p.count), color: '#F59E0B' }]}
          height={200}
        />
      </div>

      <DataTable data={prepullData} columns={COLUMNS} exportFilename="prepull-aged" />
    </div>
  );
}
