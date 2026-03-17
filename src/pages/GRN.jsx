import React, { useMemo } from 'react';
import { useData } from '../context/DataContext';
import KPICard from '../components/KPICard';
import { BarChart, LineChart } from '../components/Charts';
import { ClipboardList, CheckCircle, TrendingUp } from 'lucide-react';
import { groupBy, percent } from '../utils/index';

export default function GRN() {
  const { data } = useData();

  const grnStats = useMemo(() => {
    // Simulate GRN as shipments with delivery confirmation and CN status
    const delivered = data.filter(
      (r) => r.deliveryDate && r.deliveryDate.trim() !== '' && r.deliveryDate !== '-'
    );
    const withGRN = delivered.filter(
      (r) => r.cnStatus && r.cnStatus.trim() !== '' && r.cnStatus !== '-'
    );

    const submissionPercent = percent(withGRN.length, delivered.length);

    // Platform wise
    const platformGroups = groupBy(delivered, 'platform');
    const platformStats = Object.entries(platformGroups).map(([platform, rows]) => {
      const grn = rows.filter((r) => r.cnStatus && r.cnStatus.trim() !== '' && r.cnStatus !== '-');
      return {
        platform,
        total: rows.length,
        submitted: grn.length,
        percent: percent(grn.length, rows.length),
      };
    });

    // Month wise
    const monthGroups = groupBy(delivered, 'month');
    const monthStats = Object.entries(monthGroups)
      .map(([month, rows]) => {
        const grn = rows.filter((r) => r.cnStatus && r.cnStatus.trim() !== '' && r.cnStatus !== '-');
        return {
          month,
          total: rows.length,
          submitted: grn.length,
          percent: percent(grn.length, rows.length),
        };
      })
      .sort((a, b) => a.month.localeCompare(b.month));

    return { delivered: delivered.length, withGRN: withGRN.length, submissionPercent, platformStats, monthStats };
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard title="Total Delivered" value={grnStats.delivered} icon={ClipboardList} color="blue" />
        <KPICard title="GRN Submitted" value={grnStats.withGRN} icon={CheckCircle} color="green" />
        <KPICard title="GRN Submission %" value={`${grnStats.submissionPercent}%`} icon={TrendingUp} color="indigo" />
        <KPICard title="Pending GRN" value={grnStats.delivered - grnStats.withGRN} icon={ClipboardList} color="red" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="chart-container">
          <BarChart
            title="GRN Submission by Platform"
            labels={grnStats.platformStats.map((p) => p.platform)}
            datasets={[
              { label: 'Total Delivered', data: grnStats.platformStats.map((p) => p.total), color: '#E5E7EB' },
              { label: 'GRN Submitted', data: grnStats.platformStats.map((p) => p.submitted), color: '#10B981' },
            ]}
            options={{ plugins: { legend: { display: true, position: 'top' } } }}
          />
        </div>
        <div className="chart-container">
          <LineChart
            title="Month-wise GRN Trend"
            labels={grnStats.monthStats.map((m) => m.month)}
            datasets={[
              { label: 'GRN %', data: grnStats.monthStats.map((m) => m.percent), color: '#6366F1', fill: true },
            ]}
          />
        </div>
      </div>

      {/* Platform Performance Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">Platform-wise GRN Performance</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Platform</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Total Delivered</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">GRN Submitted</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Submission %</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Progress</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {grnStats.platformStats.map((p) => (
                <tr key={p.platform} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{p.platform}</td>
                  <td className="px-4 py-3">{p.total}</td>
                  <td className="px-4 py-3">{p.submitted}</td>
                  <td className="px-4 py-3">
                    <span className={`badge ${p.percent >= 80 ? 'badge-green' : p.percent >= 50 ? 'badge-yellow' : 'badge-red'}`}>
                      {p.percent}%
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${p.percent >= 80 ? 'bg-green-500' : p.percent >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
                        style={{ width: `${Math.min(p.percent, 100)}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
