import React, { useState } from 'react';
import DataTable from '../components/DataTable';
import KPICard from '../components/KPICard';
import FileUpload from '../components/FileUpload';
import { Users, Building, Phone, Mail } from 'lucide-react';

const SAMPLE_POC = [
  { platform: 'Amazon', contactPerson: 'John Doe', phone: '9876543210', email: 'john@amazon.com', role: 'Logistics Manager' },
  { platform: 'Flipkart', contactPerson: 'Jane Smith', phone: '9876543211', email: 'jane@flipkart.com', role: 'Operations Head' },
  { platform: 'Myntra', contactPerson: 'Raj Kumar', phone: '9876543212', email: 'raj@myntra.com', role: 'Supply Chain Lead' },
];

const COLUMNS = [
  { key: 'platform', label: 'Platform' },
  { key: 'contactPerson', label: 'Contact Person' },
  { key: 'phone', label: 'Phone', render: (val) => (
    <span className="flex items-center gap-1 text-primary-600">
      <Phone className="w-3.5 h-3.5" /> {val}
    </span>
  )},
  { key: 'email', label: 'Email', render: (val) => (
    <span className="flex items-center gap-1 text-primary-600">
      <Mail className="w-3.5 h-3.5" /> {val}
    </span>
  )},
  { key: 'role', label: 'Role', render: (val) => <span className="badge badge-blue">{val}</span> },
];

export default function POCDetails() {
  const [pocData, setPocData] = useState(SAMPLE_POC);

  const platforms = [...new Set(pocData.map((p) => p.platform))];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KPICard title="Total Contacts" value={pocData.length} icon={Users} color="blue" />
        <KPICard title="Platforms" value={platforms.length} icon={Building} color="indigo" />
        <KPICard title="Roles" value={[...new Set(pocData.map((p) => p.role))].length} icon={Users} color="green" />
      </div>

      <DataTable data={pocData} columns={COLUMNS} exportFilename="poc-details" />

      <div className="border-t border-gray-200 pt-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Upload POC Details</h3>
        <FileUpload
          label="Upload POC Details (.xlsx, .csv)"
          onDataLoaded={(data) => setPocData(data)}
        />
      </div>
    </div>
  );
}
