import React, { useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import KPICard from '../components/KPICard';
import DataTable from '../components/DataTable';
import { BarChart, LineChart, PieChart } from '../components/Charts';
import { IndianRupee, TrendingUp, AlertTriangle, Package } from 'lucide-react';
import { groupBy, currency, percent, getColor } from '../utils/index';

const COST_VIEWS = ['By Platform', 'By Zone', 'By City', 'By Month'];
const CATEGORIES = ['All', 'Forward', 'Reverse', 'RTV', 'PRN', 'GDN'];

export default function LogisticsCost() {
  const { data } = useData();
  const [costView, setCostView] = useState('By Platform');
  const [category, setCategory] = useState('All');

  const costData = useMemo(() => {
    return data
      .filter((r) => parseFloat(r.logisticsCost) > 0)
      .map((r) => ({
        ...r,
        costNum: parseFloat(r.logisticsCost) || 0,
      }));
  }, [data]);

  const totalCost = useMemo(() => costData.reduce((s, r) => s + r.costNum, 0), [costData]);
  const avgCost = useMemo(() => (costData.length ? totalCost / costData.length : 0), [totalCost, costData]);

  const viewData = useMemo(() => {
    let groupKey = 'platform';
    if (costView === 'By Zone') groupKey = 'zone';
    if (costView === 'By City') groupKey = 'destination';
    if (costView === 'By Month') groupKey = 'month';

    const groups = groupBy(costData, groupKey);
    return Object.entries(groups)
      .map(([key, rows]) => ({
        label: key,
        total: rows.reduce((s, r) => s + r.costNum, 0),
        count: rows.length,
        avg: rows.length ? rows.reduce((s, r) => s + r.costNum, 0) / rows.length : 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [costData, costView]);

  const highCostPlatforms = useMemo(() => {
    const avgAllPlatforms = viewData.length
      ? viewData.reduce((s, v) => s + v.avg, 0) / viewData.length
      : 0;
    return viewData.filter((v) => v.avg > avgAllPlatforms * 1.5);
  }, [viewData]);

  const COST_TABLE_COLUMNS = [
    { key: 'awbNo', label: 'AWB No' },
    { key: 'invoiceNo', label: 'Invoice No' },
    { key: 'vendor', label: 'Courier' },
    { key: 'platform', label: 'Platform' },
    { key: 'destination', label: 'Destination' },
    { key: 'zone', label: 'Zone' },
    { key: 'status', label: 'Status' },
    { key: 'logisticsCost', label: 'Cost', render: (val) => currency(val) },
    { key: 'month', label: 'Month' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard title="Total Cost" value={currency(totalCost)} icon={IndianRupee} color="blue" />
        <KPICard title="Avg Cost/Shipment" value={currency(avgCost)} icon={IndianRupee} color="green" />
        <KPICard title="Shipments with Cost" value={costData.length} icon={Package} color="indigo" />
        <KPICard title="High Cost Platforms" value={highCostPlatforms.length} icon={AlertTriangle} color="red" />
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="flex gap-2 flex-wrap">
          {COST_VIEWS.map((v) => (
            <button
              key={v}
              onClick={() => setCostView(v)}
              className={`tab-btn ${costView === v ? 'tab-btn-active' : 'tab-btn-inactive'}`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="chart-container">
          <BarChart
            title={`Cost ${costView}`}
            labels={viewData.slice(0, 15).map((v) => v.label)}
            datasets={[{ label: 'Total Cost', data: viewData.slice(0, 15).map((v) => v.total), color: '#F59E0B' }]}
            height={200}
          />
        </div>
        <div className="chart-container">
          <PieChart
            title={`Cost Distribution ${costView}`}
            labels={viewData.slice(0, 8).map((v) => v.label)}
            data={viewData.slice(0, 8).map((v) => v.total)}
            height={200}
          />
        </div>
      </div>

      {/* Cost Heatmap Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">Cost Comparison</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Label</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Shipments</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Total Cost</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Avg Cost</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Share %</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Heatmap</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {viewData.map((v) => {
                const share = percent(v.total, totalCost);
                const intensity = Math.min(share / 30, 1);
                return (
                  <tr key={v.label} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{v.label}</td>
                    <td className="px-4 py-3">{v.count}</td>
                    <td className="px-4 py-3 font-medium">{currency(v.total)}</td>
                    <td className="px-4 py-3">{currency(v.avg)}</td>
                    <td className="px-4 py-3">{share}%</td>
                    <td className="px-4 py-3">
                      <div
                        className="w-full h-6 rounded"
                        style={{
                          background: `rgba(245, 158, 11, ${0.1 + intensity * 0.8})`,
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {highCostPlatforms.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-red-800 flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4" />
            High Cost Detection
          </h3>
          <p className="text-xs text-red-600 mb-2">
            The following have significantly higher than average cost per shipment:
          </p>
          <div className="flex flex-wrap gap-2">
            {highCostPlatforms.map((p) => (
              <span key={p.label} className="badge badge-red">
                {p.label}: {currency(p.avg)}/shipment
              </span>
            ))}
          </div>
        </div>
      )}

      <DataTable data={costData} columns={COST_TABLE_COLUMNS} exportFilename="logistics-cost" />
    </div>
  );
}
