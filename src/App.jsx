import React from 'react';
import Sidebar from './components/Sidebar';
import Filters from './components/Filters';
import GlobalSearch from './components/GlobalSearch';
import { useData } from './context/DataContext';
import Dashboard from './pages/Dashboard';
import InTransit from './pages/InTransit';
import OFD from './pages/OFD';
import Appointment from './pages/Appointment';
import AgedPOs from './pages/AgedPOs';
import LostShipments from './pages/LostShipments';
import PrepullAged from './pages/PrepullAged';
import Delivered from './pages/Delivered';
import ReturnModule from './pages/ReturnModule';
import PODs from './pages/PODs';
import GRN from './pages/GRN';
import KPIMatrix from './pages/KPIMatrix';
import OKR from './pages/OKR';
import LogisticsCost from './pages/LogisticsCost';
import POCDetails from './pages/POCDetails';
import PlatformSOP from './pages/PlatformSOP';
import Provision from './pages/Provision';
import { Loader2, Database } from 'lucide-react';

const PAGE_MAP = {
  dashboard: Dashboard, intransit: InTransit, ofd: OFD,
  appointment: Appointment, 'aged-pos': AgedPOs, lost: LostShipments,
  prepull: PrepullAged, delivered: Delivered, return: ReturnModule,
  pods: PODs, grn: GRN, kpi: KPIMatrix, okr: OKR,
  cost: LogisticsCost, poc: POCDetails, sop: PlatformSOP, provision: Provision,
};

const TAB_TITLES = {
  dashboard: 'Dashboard', intransit: 'In-Transit', ofd: 'Out for Delivery',
  appointment: 'Appointment', 'aged-pos': "Aged PO's", lost: 'Lost Shipments',
  prepull: 'Prepull Aged', delivered: 'Delivered', return: 'Return',
  pods: 'PODs', grn: 'GRN', kpi: 'KPI Matrix', okr: 'OKR',
  cost: 'Logistics Cost', poc: 'POC Details', sop: 'Platform SOP', provision: 'Provision',
};

export default function App() {
  const { loading, error, refreshData, lastFetched, data, activeTab, setActiveTab } = useData();

  const PageComponent = PAGE_MAP[activeTab] || Dashboard;

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} onRefresh={refreshData} loading={loading} />
      <main className="flex-1 ml-56 transition-all duration-300">
        <header className="sticky top-0 z-20 bg-white/70 backdrop-blur-xl border-b border-gray-100/50 px-5 py-2.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-bold text-gray-900">{TAB_TITLES[activeTab]}</h2>
              {lastFetched && (
                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-gray-50 rounded-md">
                  <Database className="w-3 h-3 text-gray-400" />
                  <span className="text-[10px] text-gray-400">{data.length.toLocaleString('en-IN')} records</span>
                  <span className="text-[10px] text-gray-300">|</span>
                  <span className="text-[10px] text-gray-400">{lastFetched.toLocaleTimeString()}</span>
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 max-w-sm">
              <GlobalSearch />
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {loading && (
              <div className="flex items-center gap-1.5 text-primary-600 bg-primary-50 px-2.5 py-1 rounded-lg">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span className="text-[10px] font-medium">Syncing...</span>
              </div>
            )}
          </div>
        </header>

        <div className="p-4 space-y-3">
          <Filters />
          {error ? (
            <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
              <p className="text-red-600 font-medium text-sm">Error loading data</p>
              <p className="text-red-400 text-xs mt-1">{error}</p>
              <button onClick={refreshData} className="btn-primary mt-3 text-xs">Retry</button>
            </div>
          ) : loading && !lastFetched ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="relative">
                <div className="w-12 h-12 rounded-full border-2 border-gray-100 absolute inset-0" />
                <Loader2 className="w-12 h-12 text-primary-500 animate-spin" />
              </div>
              <p className="text-gray-400 text-sm mt-4">Loading shipment data...</p>
              <p className="text-gray-300 text-[10px] mt-1">This may take 20-30 seconds</p>
            </div>
          ) : (
            <PageComponent />
          )}
        </div>
      </main>
    </div>
  );
}
