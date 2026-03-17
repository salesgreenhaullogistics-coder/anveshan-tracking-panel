import React, { useMemo, useState } from 'react';
import KPICard from '../components/KPICard';
import { BarChart, DoughnutChart } from '../components/Charts';
import FileUpload from '../components/FileUpload';
import DataTable from '../components/DataTable';
import { Target, CheckCircle, Clock, AlertTriangle } from 'lucide-react';

const SAMPLE_OKRS = [
  { objective: 'Improve Delivery Performance', keyResult: 'Achieve 95% on-time delivery', target: 95, achieved: 88, status: 'On Track' },
  { objective: 'Improve Delivery Performance', keyResult: 'Reduce TAT to under 3 days', target: 3, achieved: 3.5, status: 'At Risk' },
  { objective: 'Reduce Returns', keyResult: 'RTO rate below 5%', target: 5, achieved: 7, status: 'Off Track' },
  { objective: 'Reduce Returns', keyResult: 'Process 100% RTO within 7 days', target: 100, achieved: 82, status: 'At Risk' },
  { objective: 'Cost Optimization', keyResult: 'Reduce per-shipment cost by 10%', target: 10, achieved: 8, status: 'On Track' },
  { objective: 'Documentation', keyResult: 'POD visibility 95%+', target: 95, achieved: 85, status: 'At Risk' },
  { objective: 'Documentation', keyResult: 'GRN submission 90%+', target: 90, achieved: 78, status: 'Off Track' },
];

export default function OKR() {
  const [okrData, setOkrData] = useState(SAMPLE_OKRS);

  const summary = useMemo(() => {
    const objectives = [...new Set(okrData.map((o) => o.objective))];
    const onTrack = okrData.filter((o) => o.status === 'On Track').length;
    const atRisk = okrData.filter((o) => o.status === 'At Risk').length;
    const offTrack = okrData.filter((o) => o.status === 'Off Track').length;
    const avgCompletion = okrData.length
      ? Math.round(
          (okrData.reduce((s, o) => s + Math.min((o.achieved / o.target) * 100, 100), 0) / okrData.length) * 100
        ) / 100
      : 0;

    const objectiveStats = objectives.map((obj) => {
      const krs = okrData.filter((o) => o.objective === obj);
      const avgPct = Math.round(
        (krs.reduce((s, k) => s + Math.min((k.achieved / k.target) * 100, 100), 0) / krs.length) * 100
      ) / 100;
      return { objective: obj, keyResults: krs.length, completion: avgPct };
    });

    return { objectives: objectives.length, onTrack, atRisk, offTrack, avgCompletion, objectiveStats };
  }, [okrData]);

  const COLUMNS = [
    { key: 'objective', label: 'Objective' },
    { key: 'keyResult', label: 'Key Result' },
    { key: 'target', label: 'Target' },
    { key: 'achieved', label: 'Achieved' },
    {
      key: 'status',
      label: 'Status',
      render: (val) => (
        <span className={`badge ${val === 'On Track' ? 'badge-green' : val === 'At Risk' ? 'badge-yellow' : 'badge-red'}`}>
          {val}
        </span>
      ),
    },
    {
      key: '_completion',
      label: 'Completion %',
      render: (_, row) => {
        const pct = Math.round(Math.min((row.achieved / row.target) * 100, 100));
        return (
          <div className="flex items-center gap-2">
            <div className="w-16 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-yellow-500' : 'bg-red-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs font-medium">{pct}%</span>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      {/* OKR Summary Banner */}
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-xl p-4 text-white">
        <h3 className="text-sm font-bold mb-0.5">OKR Dashboard</h3>
        <p className="text-indigo-200 text-[11px]">Objectives & Key Results tracking</p>
        <div className="mt-3 flex items-center gap-3">
          <div className="text-2xl font-bold">{summary.avgCompletion}%</div>
          <div className="text-indigo-200 text-[11px]">Overall Completion</div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard title="Objectives" value={summary.objectives} icon={Target} color="indigo" />
        <KPICard title="On Track" value={summary.onTrack} icon={CheckCircle} color="green" />
        <KPICard title="At Risk" value={summary.atRisk} icon={Clock} color="yellow" />
        <KPICard title="Off Track" value={summary.offTrack} icon={AlertTriangle} color="red" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="chart-container">
          <BarChart
            title="Objective Completion %"
            labels={summary.objectiveStats.map((o) => o.objective)}
            datasets={[{
              label: 'Completion %',
              data: summary.objectiveStats.map((o) => o.completion),
              color: '#8B5CF6',
            }]}
            height={200}
          />
        </div>
        <div className="chart-container">
          <DoughnutChart
            title="Key Results Status"
            labels={['On Track', 'At Risk', 'Off Track']}
            data={[summary.onTrack, summary.atRisk, summary.offTrack]}
            height={200}
          />
        </div>
      </div>

      <DataTable data={okrData} columns={COLUMNS} exportFilename="okr-dashboard" />

      <div className="border-t border-gray-200 pt-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Upload OKR Data</h3>
        <FileUpload label="Upload OKR Data (.xlsx, .csv)" onDataLoaded={(d) => setOkrData(d)} />
      </div>
    </div>
  );
}
