import React, { useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import DataTable from '../components/DataTable';
import KPICard from '../components/KPICard';
import FileUpload from '../components/FileUpload';
import { BarChart } from '../components/Charts';
import { RotateCcw, Truck, CheckCircle, Package } from 'lucide-react';
import { isRTODelivered, isRTOInTransit, isRTOPartial, formatDate, groupBy } from '../utils/index';

const SUB_TABS = ['RTO Delivered', 'RTO In-Transit', 'RTO Partial', 'Inventory / Dock'];
const INVENTORY_TABS = ['GDN', 'RTV', 'PRN'];

export default function ReturnModule() {
  const { data } = useData();
  const [subTab, setSubTab] = useState('RTO Delivered');
  const [inventoryTab, setInventoryTab] = useState('GDN');
  const [uploadedData, setUploadedData] = useState({ GDN: [], RTV: [], PRN: [] });

  const rtoDelivered = useMemo(() => data.filter((r) => isRTODelivered(r.status)), [data]);
  const rtoInTransit = useMemo(() => data.filter((r) => isRTOInTransit(r.status)), [data]);
  const rtoPartial = useMemo(() => data.filter((r) => isRTOPartial(r.status)), [data]);

  const activeData = useMemo(() => {
    switch (subTab) {
      case 'RTO Delivered': return rtoDelivered;
      case 'RTO In-Transit': return rtoInTransit;
      case 'RTO Partial': return rtoPartial;
      default: return [];
    }
  }, [subTab, rtoDelivered, rtoInTransit, rtoPartial]);

  const platformBreakdown = useMemo(() => {
    if (subTab === 'Inventory / Dock') return [];
    const groups = groupBy(activeData, 'platform');
    return Object.entries(groups).map(([k, v]) => ({ platform: k, count: v.length }));
  }, [activeData, subTab]);

  const handleUpload = (tabKey, data) => {
    setUploadedData((prev) => ({ ...prev, [tabKey]: data }));
  };

  const RTO_COLUMNS = [
    { key: 'awbNo', label: 'AWB No' },
    { key: 'rtoAwb', label: 'RTO AWB' },
    { key: 'invoiceNo', label: 'Invoice No' },
    { key: 'vendor', label: 'Courier' },
    { key: 'platform', label: 'Platform' },
    { key: 'destination', label: 'Destination' },
    { key: 'status', label: 'Status', render: (val) => <span className="badge badge-red">{val}</span> },
    { key: 'bookingDate', label: 'Booking Date', render: (val) => formatDate(val) },
    { key: 'deliveryDate', label: 'Delivery Date', render: (val) => formatDate(val) },
    { key: 'failureRemarks', label: 'Remarks' },
    { key: 'zone', label: 'Zone' },
  ];

  const getInventoryColumns = (data) => {
    if (!data.length) return [];
    return Object.keys(data[0]).map((key) => ({
      key,
      label: key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()),
    }));
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard title="RTO Delivered" value={rtoDelivered.length} icon={CheckCircle} color="green" />
        <KPICard title="RTO In-Transit" value={rtoInTransit.length} icon={Truck} color="indigo" />
        <KPICard title="RTO Partial" value={rtoPartial.length} icon={Package} color="yellow" />
        <KPICard title="Total RTO" value={rtoDelivered.length + rtoInTransit.length + rtoPartial.length} icon={RotateCcw} color="red" />
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

      {subTab !== 'Inventory / Dock' ? (
        <>
          {platformBreakdown.length > 0 && (
            <div className="chart-container">
              <BarChart
                title={`${subTab} by Platform`}
                labels={platformBreakdown.map((p) => p.platform)}
                datasets={[{ label: subTab, data: platformBreakdown.map((p) => p.count), color: '#EF4444' }]}
                height={200}
              />
            </div>
          )}
          <DataTable data={activeData} columns={RTO_COLUMNS} exportFilename={subTab.toLowerCase().replace(/\s/g, '-')} />
        </>
      ) : (
        <div className="space-y-4">
          <div className="flex gap-2">
            {INVENTORY_TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setInventoryTab(tab)}
                className={`tab-btn ${inventoryTab === tab ? 'tab-btn-active' : 'tab-btn-inactive'}`}
              >
                {tab} ({uploadedData[tab].length})
              </button>
            ))}
          </div>

          {uploadedData[inventoryTab].length === 0 ? (
            <FileUpload
              label={`Upload ${inventoryTab} Data (.xlsx, .csv)`}
              onDataLoaded={(data) => handleUpload(inventoryTab, data)}
            />
          ) : (
            <>
              <div className="flex justify-end">
                <button
                  onClick={() => handleUpload(inventoryTab, [])}
                  className="btn-secondary text-xs"
                >
                  Upload New File
                </button>
              </div>
              <DataTable
                data={uploadedData[inventoryTab]}
                columns={getInventoryColumns(uploadedData[inventoryTab])}
                exportFilename={`${inventoryTab.toLowerCase()}-data`}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
