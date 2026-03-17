import React, { useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import DataTable from '../components/DataTable';
import KPICard from '../components/KPICard';
import { BarChart } from '../components/Charts';
import { CheckCircle, FileText } from 'lucide-react';
import { isDelivered, isPartialDelivered, formatDate, groupBy, percent } from '../utils/index';

const SUB_TABS = ['Delivered', 'Partial Delivered'];

export default function Delivered() {
  const { data } = useData();
  const [subTab, setSubTab] = useState('Delivered');

  const deliveredData = useMemo(
    () => data.filter((r) => isDelivered(r.status)).map((r) => ({
      ...r,
      cnRaisedStatus: r.cnStatus
        ? (r.cnStatus.toLowerCase().includes('raised') || r.cnStatus.toLowerCase().includes('yes') ? 'CN Raised' : 'CN Not Raised')
        : 'CN Not Raised',
    })),
    [data]
  );

  const partialData = useMemo(
    () => data.filter((r) => isPartialDelivered(r.status)).map((r) => ({
      ...r,
      cnRaisedStatus: r.cnStatus
        ? (r.cnStatus.toLowerCase().includes('raised') || r.cnStatus.toLowerCase().includes('yes') ? 'CN Raised' : 'CN Not Raised')
        : 'CN Not Raised',
    })),
    [data]
  );

  const activeData = subTab === 'Delivered' ? deliveredData : partialData;

  const platformBreakdown = useMemo(() => {
    const groups = groupBy(activeData, 'platform');
    return Object.entries(groups).map(([k, v]) => ({ platform: k, count: v.length }));
  }, [activeData]);

  const cnStats = useMemo(() => {
    const raised = activeData.filter((r) => r.cnRaisedStatus === 'CN Raised').length;
    return { raised, notRaised: activeData.length - raised };
  }, [activeData]);

  const COLUMNS = [
    { key: 'awbNo', label: 'AWB No' },
    { key: 'invoiceNo', label: 'Invoice No' },
    { key: 'vendor', label: 'Courier' },
    { key: 'platform', label: 'Platform' },
    { key: 'destination', label: 'Destination' },
    { key: 'status', label: 'Status', render: (val) => (
      <span className="badge badge-green">{val}</span>
    )},
    { key: 'bookingDate', label: 'Booking Date', render: (val) => formatDate(val) },
    { key: 'deliveryDate', label: 'Delivery Date', render: (val) => formatDate(val) },
    { key: 'cnRaisedStatus', label: 'CN Status', render: (val) => (
      <span className={`badge ${val === 'CN Raised' ? 'badge-green' : 'badge-red'}`}>{val}</span>
    )},
    { key: 'cnStatus', label: 'Reason' },
    { key: 'zone', label: 'Zone' },
    { key: 'pod', label: 'POD', render: (val) => val ? (
      <span className="badge badge-green">Available</span>
    ) : (
      <span className="badge badge-gray">Pending</span>
    )},
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard title="Delivered" value={deliveredData.length} icon={CheckCircle} color="green" />
        <KPICard title="Partial Delivered" value={partialData.length} icon={CheckCircle} color="yellow" />
        <KPICard title="CN Raised" value={cnStats.raised} icon={FileText} color="blue" />
        <KPICard title="POD Available" value={activeData.filter((r) => r.pod).length} icon={FileText} color="green" subtitle={`${percent(activeData.filter((r) => r.pod).length, activeData.length)}%`} />
      </div>

      <div className="flex gap-2 flex-wrap">
        {SUB_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setSubTab(tab)}
            className={`tab-btn ${subTab === tab ? 'tab-btn-active' : 'tab-btn-inactive'}`}
          >
            {tab} ({tab === 'Delivered' ? deliveredData.length : partialData.length})
          </button>
        ))}
      </div>

      <div className="chart-container">
        <BarChart
          title={`${subTab} by Platform`}
          labels={platformBreakdown.map((p) => p.platform)}
          datasets={[{ label: subTab, data: platformBreakdown.map((p) => p.count), color: '#10B981' }]}
          height={200}
        />
      </div>

      <DataTable data={activeData} columns={COLUMNS} exportFilename={subTab.toLowerCase().replace(/\s/g, '-')} />
    </div>
  );
}
