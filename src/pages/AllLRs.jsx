import React, { useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import DataTable from '../components/DataTable';
import KPICard from '../components/KPICard';
import { BarChart, PieChart } from '../components/Charts';
import {
  Package, Truck, CheckCircle, RotateCcw, AlertTriangle, Clock, Eye,
  ChevronRight, X,
} from 'lucide-react';
import {
  isInTransit, isOFD, isDelivered, isPartialDelivered, isRTO, isLost,
  formatDate, groupBy, percent, safeParseDate, getAgeBucket,
} from '../utils/index';

const STATUS_TABS = [
  { key: 'all', label: 'All LRs', icon: Package, color: 'blue' },
  { key: 'intransit', label: 'In-Transit', icon: Truck, color: 'indigo' },
  { key: 'delivered', label: 'Delivered', icon: CheckCircle, color: 'green' },
  { key: 'rto', label: 'RTO', icon: RotateCcw, color: 'red' },
  { key: 'lost', label: 'Lost', icon: AlertTriangle, color: 'yellow' },
  { key: 'other', label: 'Other', icon: Clock, color: 'gray' },
];

const COLUMNS = [
  { key: 'awbNo', label: 'AWB No' },
  { key: 'invoiceNo', label: 'Invoice No' },
  { key: 'vendor', label: 'Courier' },
  { key: 'platform', label: 'Platform' },
  { key: 'origin', label: 'Origin' },
  { key: 'destination', label: 'Destination' },
  { key: 'status', label: 'Status', render: (val) => {
    const color = (isDelivered(val) || isPartialDelivered(val)) ? 'badge-green' : isRTO(val) ? 'badge-red' : (isInTransit(val) || isOFD(val)) ? 'badge-blue' : isLost(val) ? 'badge-yellow' : 'badge-gray';
    return <span className={`badge ${color}`}>{val}</span>;
  }},
  { key: 'bookingDate', label: 'Booking Date', render: (v) => formatDate(v) },
  { key: 'deliveryDate', label: 'Delivery Date', render: (v) => formatDate(v) },
  { key: 'appointmentDate', label: 'Appointment', render: (v) => formatDate(v) },
  { key: 'failureRemarks', label: 'Failure Remarks' },
  { key: 'zone', label: 'Zone' },
  { key: 'edd', label: 'EDD', render: (v) => formatDate(v) },
  { key: 'poNumber', label: 'PO Number' },
  { key: 'boxes', label: 'Boxes' },
];

export default function AllLRs() {
  const { data } = useData();
  const [statusTab, setStatusTab] = useState('all');

  const stats = useMemo(() => {
    const total = data.length;
    const intransit = data.filter(r => isInTransit(r.status) || isOFD(r.status)).length;
    const delivered = data.filter(r => isDelivered(r.status) || isPartialDelivered(r.status)).length;
    const rto = data.filter(r => isRTO(r.status)).length;
    const lost = data.filter(r => isLost(r.status)).length;
    const other = total - intransit - delivered - rto - lost;
    return { total, intransit, delivered, rto, lost, other };
  }, [data]);

  const filtered = useMemo(() => {
    switch (statusTab) {
      case 'intransit': return data.filter(r => isInTransit(r.status) || isOFD(r.status));
      case 'delivered': return data.filter(r => isDelivered(r.status) || isPartialDelivered(r.status));
      case 'rto': return data.filter(r => isRTO(r.status));
      case 'lost': return data.filter(r => isLost(r.status));
      case 'other': return data.filter(r => !(isInTransit(r.status) || isOFD(r.status)) && !(isDelivered(r.status) || isPartialDelivered(r.status)) && !isRTO(r.status) && !isLost(r.status));
      default: return data;
    }
  }, [data, statusTab]);

  const platformBreakdown = useMemo(() => {
    const groups = groupBy(filtered, 'platform');
    return Object.entries(groups)
      .filter(([k]) => k && k !== '' && k !== 'Unknown')
      .map(([platform, rows]) => ({ platform, count: rows.length }))
      .sort((a, b) => b.count - a.count);
  }, [filtered]);

  const ageBuckets = useMemo(() => {
    if (statusTab !== 'intransit' && statusTab !== 'all') return null;
    const source = statusTab === 'all' ? data.filter(r => isInTransit(r.status) || isOFD(r.status)) : filtered;
    const buckets = { '0-3 Days': 0, '4-7 Days': 0, '8-15 Days': 0, '15+ Days': 0 };
    source.forEach(r => {
      const bd = safeParseDate(r.bookingDate);
      if (bd) { const age = Math.floor((new Date() - bd) / 86400000); const b = getAgeBucket(age); if (buckets[b] !== undefined) buckets[b]++; }
    });
    return buckets;
  }, [data, filtered, statusTab]);

  const countMap = { all: stats.total, intransit: stats.intransit, delivered: stats.delivered, rto: stats.rto, lost: stats.lost, other: stats.other };

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        <KPICard title="Total LRs" value={stats.total} icon={Package} color="blue" />
        <KPICard title="In-Transit" value={stats.intransit} icon={Truck} color="indigo" />
        <KPICard title="Delivered" value={stats.delivered} icon={CheckCircle} color="green" subtitle={`${percent(stats.delivered, stats.total)}%`} />
        <KPICard title="RTO" value={stats.rto} icon={RotateCcw} color="red" subtitle={`${percent(stats.rto, stats.total)}%`} />
        <KPICard title="Lost" value={stats.lost} icon={AlertTriangle} color="yellow" />
        <KPICard title="Other" value={stats.other} icon={Clock} color="gray" />
      </div>

      {/* Status Tabs */}
      <div className="flex flex-wrap gap-1.5">
        {STATUS_TABS.map(t => {
          const Icon = t.icon;
          const count = countMap[t.key] || 0;
          const active = statusTab === t.key;
          return (
            <button key={t.key} onClick={() => setStatusTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                active ? `bg-${t.color}-500 text-white shadow-sm` : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}>
              <Icon className="w-3 h-3" />
              {t.label}
              <span className={`text-[9px] ${active ? 'opacity-80' : 'text-gray-400'}`}>({count.toLocaleString('en-IN')})</span>
            </button>
          );
        })}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="chart-container">
          <BarChart title={`${STATUS_TABS.find(t => t.key === statusTab)?.label || 'All'} by Platform`}
            labels={platformBreakdown.slice(0, 12).map(p => p.platform)}
            datasets={[{ label: 'Shipments', data: platformBreakdown.slice(0, 12).map(p => p.count),
              color: statusTab === 'rto' ? '#EF4444' : statusTab === 'delivered' ? '#10B981' : statusTab === 'intransit' ? '#6366F1' : '#3B82F6' }]}
            height={220} />
        </div>
        {statusTab === 'all' ? (
          <div className="chart-container">
            <PieChart title="Status Distribution"
              labels={['In-Transit', 'Delivered', 'RTO', 'Lost', 'Other']}
              data={[stats.intransit, stats.delivered, stats.rto, stats.lost, stats.other]}
              height={220} />
          </div>
        ) : ageBuckets ? (
          <div className="chart-container">
            <BarChart title="Age Bucket (In-Transit)"
              labels={Object.keys(ageBuckets)}
              datasets={[{ label: 'Shipments', data: Object.values(ageBuckets), color: '#8B5CF6' }]}
              height={220} />
          </div>
        ) : (
          <div className="chart-container">
            <PieChart title={`${STATUS_TABS.find(t => t.key === statusTab)?.label} by Platform`}
              labels={platformBreakdown.slice(0, 8).map(p => p.platform)}
              data={platformBreakdown.slice(0, 8).map(p => p.count)}
              height={220} />
          </div>
        )}
      </div>

      {/* Data Table */}
      <DataTable
        data={filtered}
        columns={COLUMNS}
        exportFilename={`lrs-${statusTab}`}
        pageSize={25}
      />
    </div>
  );
}
