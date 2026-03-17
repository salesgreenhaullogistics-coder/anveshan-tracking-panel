import React, { useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import DataTable from '../components/DataTable';
import KPICard from '../components/KPICard';
import { BarChart } from '../components/Charts';
import { AlertTriangle, IndianRupee } from 'lucide-react';
import { isLost, formatDate, groupBy, currency } from '../utils/index';

const CLAIM_OPTIONS = ['CN Issue', 'COF Issue', 'Claim Received', 'Adjust to Invoice', 'Pending'];

export default function LostShipments() {
  const { data } = useData();
  const [claimStatuses, setClaimStatuses] = useState({});

  const lostData = useMemo(
    () => data.filter((r) => isLost(r.status)).map((r) => ({
      ...r,
      claimStatus: claimStatuses[r.awbNo] || 'Pending',
    })),
    [data, claimStatuses]
  );

  const totalValue = useMemo(
    () => lostData.reduce((sum, r) => sum + (parseFloat(r.logisticsCost) || 0), 0),
    [lostData]
  );

  const vendorBreakdown = useMemo(() => {
    const groups = groupBy(lostData, 'platform');
    return Object.entries(groups).map(([k, v]) => ({
      vendor: k,
      count: v.length,
      value: v.reduce((s, r) => s + (parseFloat(r.logisticsCost) || 0), 0),
    }));
  }, [lostData]);

  const claimSummary = useMemo(() => {
    const counts = {};
    CLAIM_OPTIONS.forEach((c) => (counts[c] = 0));
    lostData.forEach((r) => {
      const st = r.claimStatus || 'Pending';
      counts[st] = (counts[st] || 0) + 1;
    });
    return counts;
  }, [lostData]);

  const handleClaimChange = (awb, status) => {
    setClaimStatuses((prev) => ({ ...prev, [awb]: status }));
  };

  const COLUMNS = [
    { key: 'awbNo', label: 'AWB No' },
    { key: 'invoiceNo', label: 'Invoice No' },
    { key: 'vendor', label: 'Courier' },
    { key: 'platform', label: 'Platform' },
    { key: 'destination', label: 'Destination' },
    { key: 'status', label: 'Status', render: (val) => <span className="badge badge-red">{val}</span> },
    { key: 'bookingDate', label: 'Booking Date', render: (val) => formatDate(val) },
    { key: 'logisticsCost', label: 'Value', render: (val) => currency(val) },
    {
      key: 'claimStatus',
      label: 'Claim Status',
      render: (val, row) => (
        <select
          value={val}
          onChange={(e) => handleClaimChange(row.awbNo, e.target.value)}
          className="filter-select text-xs py-1"
          onClick={(e) => e.stopPropagation()}
        >
          {CLAIM_OPTIONS.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ),
      sortable: false,
    },
    { key: 'zone', label: 'Zone' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard title="Lost Shipments" value={lostData.length} icon={AlertTriangle} color="red" />
        <KPICard title="Total Value" value={currency(totalValue)} icon={IndianRupee} color="orange" />
        <KPICard title="Claim Received" value={claimSummary['Claim Received']} icon={AlertTriangle} color="green" />
        <KPICard title="Pending Claims" value={claimSummary['Pending']} icon={AlertTriangle} color="yellow" />
      </div>

      <div className="chart-container">
        <BarChart
          title="Lost Shipments by Logistics Provider"
          labels={vendorBreakdown.map((v) => v.vendor)}
          datasets={[
            { label: 'Count', data: vendorBreakdown.map((v) => v.count), color: '#EF4444' },
          ]}
          height={200}
        />
      </div>

      <DataTable data={lostData} columns={COLUMNS} exportFilename="lost-shipments" />
    </div>
  );
}
