import React, { useState } from 'react';
import {
  LayoutDashboard, Truck, PackageCheck, Calendar, Clock, AlertTriangle,
  Timer, CheckCircle, RotateCcw, FileText, ClipboardList, BarChart3,
  Target, IndianRupee, Users, FileCheck, Calculator, ChevronLeft,
  ChevronRight, RefreshCw, Package,
} from 'lucide-react';

const NAV_GROUPS = [
  {
    label: 'Operations',
    items: [
      { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { key: 'intransit', label: 'In-Transit', icon: Truck },
      { key: 'ofd', label: 'OFD', icon: PackageCheck },
      { key: 'appointment', label: 'Appointment', icon: Calendar },
      { key: 'aged-pos', label: "Aged PO's", icon: Clock },
      { key: 'lost', label: 'Lost Shipments', icon: AlertTriangle },
      { key: 'prepull', label: 'Prepull Aged', icon: Timer },
    ],
  },
  {
    label: 'Delivery',
    items: [
      { key: 'delivered', label: 'Delivered', icon: CheckCircle },
      { key: 'return', label: 'Return', icon: RotateCcw },
    ],
  },
  {
    label: 'Documentation',
    items: [
      { key: 'pods', label: 'PODs', icon: FileText },
      { key: 'grn', label: 'GRN', icon: ClipboardList },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { key: 'kpi', label: 'KPI Matrix', icon: BarChart3 },
      { key: 'okr', label: 'OKR', icon: Target },
      { key: 'cost', label: 'Logistics Cost', icon: IndianRupee },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { key: 'poc', label: 'POC Details', icon: Users },
      { key: 'sop', label: 'Platform SOP', icon: FileCheck },
      { key: 'provision', label: 'Provision', icon: Calculator },
    ],
  },
];

export default function Sidebar({ activeTab, onTabChange, onRefresh, loading }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`fixed left-0 top-0 h-full z-30 flex flex-col transition-all duration-300 ${
        collapsed ? 'w-14' : 'w-56'
      }`}
      style={{
        background: 'linear-gradient(180deg, #0f172a 0%, #1a1f3a 100%)',
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3 py-3 border-b border-white/[0.06]">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-blue-500/20">
          <Package className="w-4 h-4 text-white" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <h1 className="text-xs font-bold text-white tracking-wide truncate">Anveshan</h1>
            <p className="text-[9px] text-blue-300/60 tracking-widest uppercase">Tracking Panel</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-1.5 px-1.5 space-y-0.5">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-1">
            {!collapsed && (
              <p className="px-2 py-1 text-[9px] font-semibold text-slate-500 uppercase tracking-wider">
                {group.label}
              </p>
            )}
            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => onTabChange(item.key)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[11px] font-medium transition-all duration-200 mb-[1px] ${
                    isActive
                      ? 'bg-gradient-to-r from-blue-600/90 to-indigo-600/90 text-white shadow-md shadow-blue-600/20'
                      : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-200'
                  }`}
                  title={collapsed ? item.label : undefined}
                >
                  <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? 'text-white' : ''}`} />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-white/[0.06] p-1.5 space-y-0.5">
        <button
          onClick={onRefresh}
          disabled={loading}
          className="w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[11px] font-medium text-slate-400 hover:bg-white/[0.06] hover:text-slate-200 transition-all disabled:opacity-40"
          title="Refresh Data"
        >
          <RefreshCw className={`w-3.5 h-3.5 flex-shrink-0 ${loading ? 'animate-spin' : ''}`} />
          {!collapsed && <span>Refresh</span>}
        </button>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[11px] font-medium text-slate-400 hover:bg-white/[0.06] hover:text-slate-200 transition-all"
        >
          {collapsed ? (
            <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />
          ) : (
            <>
              <ChevronLeft className="w-3.5 h-3.5 flex-shrink-0" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}

export { NAV_GROUPS };
