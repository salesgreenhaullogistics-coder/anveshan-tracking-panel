import React, { useState, useEffect, useMemo, useCallback } from 'react';
import KPICard from '../components/KPICard';
import { BarChart, LineChart, DoughnutChart } from '../components/Charts';
import DataTable from '../components/DataTable';
import { COLORS, exportToExcel } from '../utils/index';
import {
  BarChart3, Target, Users, Award, TrendingUp, TrendingDown, AlertTriangle,
  Activity, Brain, Zap, RefreshCw, Calendar, Filter, ChevronDown, ChevronRight,
  Star, Medal, ArrowUpRight, ArrowDownRight, Minus, Sun, Moon, Search,
  Download, Eye, X, Loader2, Lightbulb, ShieldAlert, Sparkles, Trophy,
  Clock, CheckCircle, XCircle, Info, ChevronLeft, Layers, Table2, ArrowRight,
} from 'lucide-react';

// ─── Constants ───────────────────────────────────────────────────────────────

const KPI_API = 'https://script.google.com/macros/s/AKfycbxI66Y3lZZqeSlZCdIQKVrPGla10AvM-3vVI89t8gc49ld4ukH3wnrIIEiuCv6khAAA/exec';
const AUTO_REFRESH_MS = 10 * 60 * 1000;
const NON_DATA_VALUES = new Set(['holiday', 'week off', 'off', '3rd sat off', '3rd sat', 'leave', 'na', '-', 'done', '']);
const OWNER_COLORS = { Sandeep: '#3B82F6', Anoop: '#10B981', Prashant: '#F59E0B', Nandlal: '#EF4444', Souvik: '#8B5CF6', 'Sandeep Dagar': '#EC4899', 'Abhay Mishra': '#06B6D4' };
const GRADE_CONFIG = { A: { min: 80, color: 'emerald', label: 'Excellent' }, B: { min: 60, color: 'amber', label: 'Good' }, C: { min: 0, color: 'red', label: 'Needs Improvement' } };
const SUB_TABS = [
  { key: 'overview', label: 'Overview', icon: Activity },
  { key: 'employees', label: 'Employee Scorecards', icon: Users },
  { key: 'trends', label: 'KPI Trends', icon: TrendingUp },
  { key: 'leaderboard', label: 'Leaderboard', icon: Trophy },
  { key: 'insights', label: 'AI Insights', icon: Brain },
];

// ─── Date Parsing ────────────────────────────────────────────────────────────

function parseDateCol(key) {
  if (!key || key === 'L' || key === '') return null;
  const d = new Date(key);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate(d) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

function fmtDateFull(d) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function weekKey(d) {
  const start = new Date(d);
  start.setDate(start.getDate() - start.getDay() + 1);
  return `W${String(start.getDate()).padStart(2,'0')}-${['Jan','Feb','Mar'][start.getMonth()]}`;
}

function monthKey(d) {
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()] + "'" + String(d.getFullYear()).slice(2);
}

// ─── Data Parsing ────────────────────────────────────────────────────────────

function parseValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim().toLowerCase();
  if (NON_DATA_VALUES.has(s)) return null;
  if (s.endsWith('%%')) { const n = parseFloat(s); return isNaN(n) ? null : n / 100; }
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function isPercentageKPI(name, values) {
  const nm = (name || '').toLowerCase();
  const hasKeyword = nm.includes('%') || nm.includes('rate') || nm.includes('utilization') || nm.includes('success') || nm.includes('adherence') || nm.includes('accuracy');
  const nums = values.filter(v => v !== null && typeof v === 'number');
  if (nums.length === 0) return hasKeyword;
  const allInDecimal = nums.every(n => n >= 0 && n <= 1.5);
  if (allInDecimal) return true;
  return false; // even if name has %, values > 1.5 means it's not a 0-1 decimal percentage
}

function isDecimalPercent(values) {
  const nums = values.filter(v => v !== null && typeof v === 'number');
  if (nums.length === 0) return true;
  return nums.every(n => n >= 0 && n <= 1.5);
}

function isCurrencyKPI(name) {
  const nm = (name || '').toLowerCase();
  return nm.includes('value') || nm.includes('cost') || nm.includes('amount') || nm.includes('claim') || nm.includes('recovery value');
}

function parseApiData(raw) {
  const dateKeys = [];
  const allKeys = Object.keys(raw[0] || {});
  allKeys.forEach(k => {
    const d = parseDateCol(k);
    if (d) dateKeys.push({ key: k, date: d });
  });
  dateKeys.sort((a, b) => a.date - b.date);

  const owners = [];
  let current = null;

  raw.forEach(row => {
    const owner = (row.L || '').trim();
    const kpi = (row[''] || '').trim();
    if (owner === 'Owner' || (!owner && !kpi)) return;
    if (owner && owner !== '') {
      current = { name: owner, kpis: [] };
      owners.push(current);
    }
    if (!current || !kpi || kpi === 'KPI') return;

    const values = dateKeys.map(dk => ({ date: dk.date, dateKey: dk.key, value: parseValue(row[dk.key]), raw: row[dk.key] }));
    const numericValues = values.map(v => v.value).filter(v => v !== null);
    const isSubKPI = kpi.startsWith('-') || ['0-7 Days','8-15 Days','16-20 Days','21-30 Days','Above 30 Days','Zone A','Zone B','Zone C','Zone D','Zone E','Central/Others','East','North','South','West','Prozo GGN05','Emiza BLR','Emiza Kol','Kuik Kalyan Nagar','Prozo Bhiwandi','Kuik Bommanhalli','Gracious','Omkar','Skylark','Amazon Freight','Manesar','JWL','Shopify','Amazon','Flipkart','Others','B2B','D2C','RTO','Delay','Lost Cases','0–3 Days','3–7 Days','7+ days'].includes(kpi) || kpi.includes('Manesar-') || kpi.includes('JWL-') || kpi.includes('Omkar-') || kpi.includes('Skylark-') || kpi.includes('Gracious-');

    current.kpis.push({
      name: kpi.replace(/^-/, '').trim(),
      fullName: kpi,
      values,
      numericValues,
      isPercentage: isPercentageKPI(kpi, numericValues),
      isDecimal: isDecimalPercent(numericValues),
      isCurrency: isCurrencyKPI(kpi),
      isSubKPI,
      avg: numericValues.length ? numericValues.reduce((a, b) => a + b, 0) / numericValues.length : null,
      latest: numericValues.length ? numericValues[numericValues.length - 1] : null,
      min: numericValues.length ? Math.min(...numericValues) : null,
      max: numericValues.length ? Math.max(...numericValues) : null,
      dataPoints: numericValues.length,
    });
  });

  return { owners, dateKeys };
}

// ─── AI Analytics ────────────────────────────────────────────────────────────

function calcTrend(values) {
  const nums = values.filter(v => v !== null);
  if (nums.length < 3) return { slope: 0, direction: 'stable', pctChange: 0 };
  const recent = nums.slice(-7);
  const earlier = nums.slice(-14, -7);
  if (!earlier.length || !recent.length) return { slope: 0, direction: 'stable', pctChange: 0 };
  const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
  const avgEarlier = earlier.reduce((a, b) => a + b, 0) / earlier.length;
  const pctChange = avgEarlier !== 0 ? ((avgRecent - avgEarlier) / Math.abs(avgEarlier)) * 100 : 0;
  return {
    slope: avgRecent - avgEarlier,
    direction: pctChange > 3 ? 'up' : pctChange < -3 ? 'down' : 'stable',
    pctChange: Math.round(pctChange * 10) / 10,
  };
}

function detectAnomalies(kpi) {
  const nums = kpi.numericValues;
  if (nums.length < 5) return [];
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const std = Math.sqrt(nums.reduce((s, v) => s + (v - mean) ** 2, 0) / nums.length);
  if (std === 0) return [];
  const anomalies = [];
  kpi.values.forEach(v => {
    if (v.value === null) return;
    const z = Math.abs((v.value - mean) / std);
    if (z > 2) anomalies.push({ date: v.date, value: v.value, zscore: Math.round(z * 10) / 10, type: v.value > mean ? 'spike' : 'drop' });
  });
  return anomalies.slice(-5);
}

function linearForecast(values, periods = 7) {
  const nums = values.filter(v => v !== null);
  if (nums.length < 5) return [];
  const recent = nums.slice(-14);
  const n = recent.length;
  const xMean = (n - 1) / 2;
  const yMean = recent.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  recent.forEach((y, x) => { num += (x - xMean) * (y - yMean); den += (x - xMean) ** 2; });
  const slope = den !== 0 ? num / den : 0;
  const intercept = yMean - slope * xMean;
  return Array.from({ length: periods }, (_, i) => Math.max(0, Math.round((slope * (n + i) + intercept) * 10000) / 10000));
}

function generateInsights(owners) {
  const insights = [];

  owners.forEach(owner => {
    const mainKPIs = owner.kpis.filter(k => !k.isSubKPI && k.numericValues.length >= 5);
    mainKPIs.forEach(kpi => {
      const trend = calcTrend(kpi.numericValues);
      const anomalies = detectAnomalies(kpi);

      if (trend.direction === 'down' && Math.abs(trend.pctChange) > 5) {
        insights.push({
          type: 'warning', severity: Math.abs(trend.pctChange) > 15 ? 'critical' : 'warning',
          owner: owner.name, kpi: kpi.name,
          message: `${kpi.name} dropped ${Math.abs(trend.pctChange)}% this week for ${owner.name}`,
          recommendation: kpi.isPercentage
            ? `Review daily operations and identify root causes. Current avg: ${(scoreVal(kpi.avg, kpi) * 100).toFixed(1)}%`
            : `Investigate recent changes. Current avg: ${formatNum(kpi.avg, kpi)}`,
        });
      }

      if (trend.direction === 'up' && trend.pctChange > 10) {
        insights.push({
          type: 'positive', severity: 'good',
          owner: owner.name, kpi: kpi.name,
          message: `${kpi.name} improved ${trend.pctChange}% this week for ${owner.name}`,
          recommendation: 'Maintain current practices and document what worked well.',
        });
      }

      if (anomalies.length > 0) {
        const latest = anomalies[anomalies.length - 1];
        insights.push({
          type: 'anomaly', severity: latest.zscore > 3 ? 'critical' : 'warning',
          owner: owner.name, kpi: kpi.name,
          message: `Unusual ${latest.type} detected in ${kpi.name} (${fmtDate(latest.date)}): ${formatNum(latest.value, kpi)} (${latest.zscore}x std dev)`,
          recommendation: `Investigate ${latest.type === 'spike' ? 'unexpected increase' : 'sudden decrease'} on ${fmtDateFull(latest.date)}.`,
        });
      }

      if (kpi.isPercentage && kpi.latest !== null && scoreVal(kpi.latest, kpi) < 0.7) {
        insights.push({
          type: 'warning', severity: 'warning',
          owner: owner.name, kpi: kpi.name,
          message: `${kpi.name} is below 70% target (currently ${(scoreVal(kpi.latest, kpi) * 100).toFixed(1)}%) for ${owner.name}`,
          recommendation: 'Prioritize this KPI. Conduct root cause analysis and set daily improvement targets.',
        });
      }
    });
  });

  insights.sort((a, b) => {
    const sev = { critical: 0, warning: 1, good: 2 };
    return (sev[a.severity] || 2) - (sev[b.severity] || 2);
  });
  return insights;
}

function generateNLSummary(owners, dateKeys) {
  if (!owners.length || !dateKeys.length) return '';
  const lastDate = dateKeys[dateKeys.length - 1].date;
  const parts = [`Performance summary as of ${fmtDateFull(lastDate)}:`];

  owners.forEach(owner => {
    const mainKPIs = owner.kpis.filter(k => !k.isSubKPI && k.isPercentage && k.numericValues.length >= 5);
    const declining = mainKPIs.filter(k => calcTrend(k.numericValues).direction === 'down');
    const improving = mainKPIs.filter(k => calcTrend(k.numericValues).direction === 'up');

    if (declining.length > 0) {
      parts.push(`${owner.name}: ${declining.length} KPI${declining.length > 1 ? 's' : ''} declining (${declining.slice(0, 2).map(k => k.name).join(', ')}).`);
    }
    if (improving.length > 0) {
      parts.push(`${owner.name}: ${improving.length} KPI${improving.length > 1 ? 's' : ''} improving (${improving.slice(0, 2).map(k => k.name).join(', ')}).`);
    }
  });

  return parts.join(' ');
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

function calcOwnerScore(owner) {
  const pctKPIs = owner.kpis.filter(k => !k.isSubKPI && k.isPercentage && k.avg !== null);
  if (!pctKPIs.length) return { score: 0, grade: 'C', totalKPIs: owner.kpis.filter(k => !k.isSubKPI).length, pctKPIs: 0, trending: 'stable' };
  const avgScore = pctKPIs.reduce((s, k) => s + Math.min(scoreVal(k.avg, k), 1), 0) / pctKPIs.length * 100;
  const trends = pctKPIs.map(k => calcTrend(k.numericValues));
  const upCount = trends.filter(t => t.direction === 'up').length;
  const downCount = trends.filter(t => t.direction === 'down').length;
  return {
    score: Math.round(avgScore * 10) / 10,
    grade: avgScore >= 80 ? 'A' : avgScore >= 60 ? 'B' : 'C',
    totalKPIs: owner.kpis.filter(k => !k.isSubKPI).length,
    pctKPIs: pctKPIs.length,
    trending: upCount > downCount ? 'up' : downCount > upCount ? 'down' : 'stable',
  };
}

function formatNum(v, kpi) {
  if (v === null || v === undefined) return '-';
  if (kpi?.isPercentage) {
    const pct = kpi.isDecimal ? v * 100 : v;
    return pct.toFixed(1) + '%';
  }
  if (kpi?.isCurrency) return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v);
  if (Number.isInteger(v)) return v.toLocaleString('en-IN');
  return v.toFixed(2);
}

function scoreVal(v, kpi) {
  if (v === null) return 0;
  return kpi?.isDecimal ? v : v / 100;
}

// ─── Components ──────────────────────────────────────────────────────────────

function GradeBadge({ grade }) {
  const cfg = GRADE_CONFIG[grade] || GRADE_CONFIG.C;
  const colors = { emerald: 'bg-emerald-100 text-emerald-700 ring-emerald-200', amber: 'bg-amber-100 text-amber-700 ring-amber-200', red: 'bg-red-100 text-red-700 ring-red-200' };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold ring-1 ${colors[cfg.color]}`}>Grade {grade} - {cfg.label}</span>;
}

function TrendBadge({ trend, pctChange }) {
  if (trend === 'up') return <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-md"><ArrowUpRight className="w-3 h-3" />{pctChange > 0 ? `+${pctChange}%` : ''}</span>;
  if (trend === 'down') return <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-md"><ArrowDownRight className="w-3 h-3" />{pctChange < 0 ? `${pctChange}%` : ''}</span>;
  return <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded-md"><Minus className="w-3 h-3" />Stable</span>;
}

function MiniSparkline({ values, isPercentage, color = '#3B82F6' }) {
  const nums = values.slice(-30).map(v => v.value).filter(v => v !== null);
  if (nums.length < 2) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;
  const w = 120;
  const h = 32;
  const pts = nums.map((v, i) => `${(i / (nums.length - 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`).join(' ');
  return (
    <svg width={w} height={h} className="flex-shrink-0">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={(nums.length - 1) / (nums.length - 1) * w} cy={h - ((nums[nums.length - 1] - min) / range) * (h - 4) - 2} r="2.5" fill={color} />
    </svg>
  );
}

function DateRangeFilter({ dateKeys, dateRange, setDateRange }) {
  const minDate = dateKeys[0]?.date;
  const maxDate = dateKeys[dateKeys.length - 1]?.date;
  if (!minDate || !maxDate) return null;
  const toStr = d => d.toISOString().split('T')[0];
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <Calendar className="w-3.5 h-3.5 text-gray-400" />
      <input type="date" value={dateRange[0] || toStr(minDate)} onChange={e => setDateRange([e.target.value, dateRange[1]])} className="px-2 py-1 border border-gray-200 rounded-md text-[11px] bg-white focus:ring-2 focus:ring-blue-500/30" />
      <span className="text-gray-400">to</span>
      <input type="date" value={dateRange[1] || toStr(maxDate)} onChange={e => setDateRange([dateRange[0], e.target.value])} className="px-2 py-1 border border-gray-200 rounded-md text-[11px] bg-white focus:ring-2 focus:ring-blue-500/30" />
    </div>
  );
}

// ─── Overview Tab ────────────────────────────────────────────────────────────

function OverviewTab({ owners, dateKeys, filteredOwners }) {
  const [drillDown, setDrillDown] = useState(null); // { owner, kpi } or 'summary'
  const [expandedLowKPI, setExpandedLowKPI] = useState(null);

  const scores = filteredOwners.map(o => ({ ...o, ...calcOwnerScore(o) }));
  const avgScore = scores.length ? Math.round(scores.reduce((s, o) => s + o.score, 0) / scores.length * 10) / 10 : 0;
  const topPerformer = [...scores].sort((a, b) => b.score - a.score)[0];
  const totalKPIs = filteredOwners.reduce((s, o) => s + o.kpis.filter(k => !k.isSubKPI).length, 0);
  const criticalKPIs = filteredOwners.flatMap(o => o.kpis.filter(k => !k.isSubKPI && k.isPercentage && k.latest !== null && scoreVal(k.latest, k) < 0.6)).length;
  const summary = generateNLSummary(filteredOwners, dateKeys);

  // Key metrics across all owners
  const keyMetrics = filteredOwners.flatMap(o =>
    o.kpis.filter(k => !k.isSubKPI && k.isPercentage && k.avg !== null)
      .map(k => ({ owner: o.name, ownerObj: o, ...k, trend: calcTrend(k.numericValues) }))
  ).sort((a, b) => (a.avg || 0) - (b.avg || 0));

  const worst5 = keyMetrics.slice(0, 5);
  const best5 = keyMetrics.slice(-5).reverse();

  // Low KPIs for pivot breakdown
  const lowKPIs = keyMetrics.filter(k => scoreVal(k.avg, k) < 0.7);

  const openDrillDown = (kpiItem) => {
    const ownerObj = filteredOwners.find(o => o.name === kpiItem.owner) || kpiItem.ownerObj;
    const kpiObj = ownerObj?.kpis.find(k => k.name === kpiItem.name && !k.isSubKPI);
    if (ownerObj && kpiObj) setDrillDown({ owner: ownerObj, kpi: kpiObj });
  };

  return (
    <div className="space-y-4">
      {/* AI Summary Banner */}
      {summary && (
        <div className="bg-gradient-to-r from-violet-50 to-blue-50 border border-violet-100 rounded-xl p-3">
          <div className="flex items-start gap-2">
            <Sparkles className="w-4 h-4 text-violet-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-[10px] font-semibold text-violet-600 uppercase tracking-wider mb-1">AI Summary</p>
              <p className="text-[11px] text-gray-700 leading-relaxed">{summary}</p>
            </div>
          </div>
        </div>
      )}

      {/* Top KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard title="Team Members" value={filteredOwners.length} icon={Users} color="blue" />
        <KPICard title="Avg Performance" value={`${avgScore}%`} icon={Target} color={avgScore >= 80 ? 'green' : avgScore >= 60 ? 'yellow' : 'red'} />
        <KPICard title="Total KPIs Tracked" value={totalKPIs} icon={BarChart3} color="indigo" />
        <button onClick={() => setDrillDown('summary')} className="text-left">
          <KPICard title="Critical KPIs" value={criticalKPIs} icon={AlertTriangle} color={criticalKPIs > 0 ? 'red' : 'green'} subtitle={criticalKPIs > 0 ? 'Click to drill down' : 'none'} />
        </button>
      </div>

      {/* Employee Performance Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="chart-container">
          <BarChart
            title="Employee Performance Score (%)"
            labels={scores.map(s => s.name)}
            datasets={[{ label: 'Score', data: scores.map(s => s.score), color: scores.map(s => s.score >= 80 ? '#10B981' : s.score >= 60 ? '#F59E0B' : '#EF4444') }]}
            height={220}
          />
        </div>
        <div className="chart-container">
          <DoughnutChart
            title="Performance Grade Distribution"
            labels={['Grade A (>=80%)', 'Grade B (60-80%)', 'Grade C (<60%)']}
            data={[scores.filter(s => s.grade === 'A').length, scores.filter(s => s.grade === 'B').length, scores.filter(s => s.grade === 'C').length]}
            height={220}
          />
        </div>
      </div>

      {/* Low KPI Alerts — Pivot Breakdown */}
      {lowKPIs.length > 0 && (
        <div className="bg-white rounded-xl border border-red-100 p-3" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[11px] font-bold text-red-700 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
              Low KPI Alerts — {lowKPIs.length} KPIs Below 70%
            </h4>
            <button
              onClick={() => setDrillDown('summary')}
              className="text-[10px] text-indigo-500 hover:text-indigo-700 font-medium flex items-center gap-0.5"
            >
              Full Drill-Down <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-1.5">
            {lowKPIs.map((k, i) => {
              const isExpanded = expandedLowKPI === `${k.owner}-${k.name}`;
              const ownerObj = filteredOwners.find(o => o.name === k.owner);
              const kpiObj = ownerObj?.kpis.find(kk => kk.name === k.name && !kk.isSubKPI);
              return (
                <div key={i}>
                  <div
                    onClick={() => setExpandedLowKPI(isExpanded ? null : `${k.owner}-${k.name}`)}
                    className="w-full flex items-center justify-between py-1.5 px-2 rounded-lg bg-red-50/80 hover:bg-red-100/50 transition-colors text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-red-400" /> : <ChevronRight className="w-3.5 h-3.5 text-red-400" />}
                      <div className="min-w-0">
                        <p className="text-[11px] font-medium text-gray-700 truncate">{k.name}</p>
                        <p className="text-[9px] text-gray-400">{k.owner}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold text-red-600">{(scoreVal(k.avg, k) * 100).toFixed(1)}%</span>
                      <TrendBadge trend={k.trend.direction} pctChange={k.trend.pctChange} />
                      <button
                        onClick={(e) => { e.stopPropagation(); openDrillDown(k); }}
                        className="p-0.5 rounded hover:bg-red-200 text-red-500"
                        title="Open full drill-down"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {/* Expanded pivot view */}
                  {isExpanded && ownerObj && kpiObj && (
                    <div className="mt-1.5 ml-5">
                      <PivotTable kpi={kpiObj} owner={ownerObj} allOwners={filteredOwners} dateKeys={dateKeys} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Best & Worst KPIs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-3" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <h4 className="text-[11px] font-bold text-gray-700 flex items-center gap-1.5 mb-2"><Trophy className="w-3.5 h-3.5 text-emerald-500" />Top 5 Performing KPIs</h4>
          <div className="space-y-1.5">
            {best5.map((k, i) => (
              <button key={i} onClick={() => openDrillDown(k)} className="w-full flex items-center justify-between py-1.5 px-2 rounded-lg bg-emerald-50/50 hover:bg-emerald-100/50 transition-colors text-left">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] font-bold text-emerald-600 w-4">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-gray-700 truncate">{k.name}</p>
                    <p className="text-[9px] text-gray-400">{k.owner}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-emerald-600">{(scoreVal(k.avg, k) * 100).toFixed(1)}%</span>
                  <TrendBadge trend={k.trend.direction} pctChange={k.trend.pctChange} />
                  <ChevronRight className="w-3 h-3 text-emerald-300" />
                </div>
              </button>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-3" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <h4 className="text-[11px] font-bold text-gray-700 flex items-center gap-1.5 mb-2"><AlertTriangle className="w-3.5 h-3.5 text-red-500" />Bottom 5 KPIs - Needs Attention</h4>
          <div className="space-y-1.5">
            {worst5.map((k, i) => (
              <button key={i} onClick={() => openDrillDown(k)} className="w-full flex items-center justify-between py-1.5 px-2 rounded-lg bg-red-50/50 hover:bg-red-100/50 transition-colors text-left">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] font-bold text-red-600 w-4">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-gray-700 truncate">{k.name}</p>
                    <p className="text-[9px] text-gray-400">{k.owner}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-red-600">{(scoreVal(k.avg, k) * 100).toFixed(1)}%</span>
                  <TrendBadge trend={k.trend.direction} pctChange={k.trend.pctChange} />
                  <ChevronRight className="w-3 h-3 text-red-300" />
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Multi-Level Drill-Down Modal */}
      {drillDown && (
        <MultiLevelDrillDown
          owners={filteredOwners}
          dateKeys={dateKeys}
          initialOwner={drillDown === 'summary' ? null : drillDown.owner}
          initialKPI={drillDown === 'summary' ? null : drillDown.kpi}
          onClose={() => setDrillDown(null)}
        />
      )}
    </div>
  );
}

// ─── Employee Scorecards Tab ─────────────────────────────────────────────────

function EmployeeTab({ filteredOwners, dateKeys }) {
  const [expanded, setExpanded] = useState(null);
  const [drillKPI, setDrillKPI] = useState(null);
  const [drillDown, setDrillDown] = useState(null);

  return (
    <div className="space-y-3">
      {filteredOwners.map(owner => {
        const score = calcOwnerScore(owner);
        const isOpen = expanded === owner.name;
        const mainKPIs = owner.kpis.filter(k => !k.isSubKPI);
        const ownerColor = OWNER_COLORS[owner.name] || '#6366F1';
        const lowCount = mainKPIs.filter(k => k.isPercentage && k.avg !== null && scoreVal(k.avg, k) < 0.7).length;

        return (
          <div key={owner.name} className="bg-white rounded-xl border border-gray-100 overflow-hidden" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            {/* Card Header */}
            <button onClick={() => setExpanded(isOpen ? null : owner.name)} className="w-full flex items-center justify-between p-3 hover:bg-gray-50/50 transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center text-white font-bold text-sm" style={{ background: ownerColor }}>
                  {owner.name.charAt(0)}
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold text-gray-800">{owner.name}</p>
                  <p className="text-[10px] text-gray-400">
                    {score.totalKPIs} KPIs tracked | {score.pctKPIs} scored
                    {lowCount > 0 && <span className="text-red-500 ml-1"> | {lowCount} below target</span>}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-lg font-bold" style={{ color: ownerColor }}>{score.score}%</p>
                  <GradeBadge grade={score.grade} />
                </div>
                <TrendBadge trend={score.trending} />
                {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
              </div>
            </button>

            {/* Expanded Detail */}
            {isOpen && (
              <div className="border-t border-gray-100 p-3 space-y-3">
                {/* Mini chart */}
                <div className="chart-container">
                  <BarChart
                    title={`${owner.name} - KPI Achievement (%)`}
                    labels={mainKPIs.filter(k => k.isPercentage && k.avg !== null).map(k => k.name.length > 25 ? k.name.slice(0, 22) + '...' : k.name)}
                    datasets={[{
                      label: 'Achievement',
                      data: mainKPIs.filter(k => k.isPercentage && k.avg !== null).map(k => Math.round(Math.min(scoreVal(k.avg, k), 1) * 100 * 10) / 10),
                      color: mainKPIs.filter(k => k.isPercentage && k.avg !== null).map(k => scoreVal(k.avg, k) >= 0.8 ? '#10B981' : scoreVal(k.avg, k) >= 0.6 ? '#F59E0B' : '#EF4444'),
                    }]}
                    height={180}
                  />
                </div>

                {/* KPI Table */}
                <p className="text-[9px] text-gray-400 italic">Click any KPI row for detailed drill-down analysis</p>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-50/80 border-b border-gray-100">
                        <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-gray-500 uppercase">KPI</th>
                        <th className="px-3 py-1.5 text-right text-[10px] font-semibold text-gray-500 uppercase">Avg</th>
                        <th className="px-3 py-1.5 text-right text-[10px] font-semibold text-gray-500 uppercase">Latest</th>
                        <th className="px-3 py-1.5 text-right text-[10px] font-semibold text-gray-500 uppercase">Min</th>
                        <th className="px-3 py-1.5 text-right text-[10px] font-semibold text-gray-500 uppercase">Max</th>
                        <th className="px-3 py-1.5 text-center text-[10px] font-semibold text-gray-500 uppercase">Trend</th>
                        <th className="px-3 py-1.5 text-center text-[10px] font-semibold text-gray-500 uppercase">Spark</th>
                        <th className="px-3 py-1.5 text-center text-[10px] font-semibold text-gray-500 uppercase">Drill</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {mainKPIs.map((kpi, idx) => {
                        const trend = calcTrend(kpi.numericValues);
                        const isLow = kpi.isPercentage && kpi.avg !== null && scoreVal(kpi.avg, kpi) < 0.7;
                        return (
                          <tr
                            key={idx}
                            className={`cursor-pointer transition-colors ${isLow ? 'bg-red-50/40 hover:bg-red-50' : `hover:bg-blue-50/30 ${idx % 2 === 0 ? '' : 'bg-gray-50/20'}`}`}
                            onClick={() => setDrillDown({ owner, kpi })}
                          >
                            <td className={`px-3 py-1.5 text-[11px] font-medium max-w-[200px] truncate ${isLow ? 'text-red-700' : 'text-gray-700'}`} title={kpi.name}>
                              {isLow && <AlertTriangle className="w-3 h-3 text-red-400 inline mr-1" />}
                              {kpi.name}
                            </td>
                            <td className={`px-3 py-1.5 text-[11px] text-right font-semibold ${isLow ? 'text-red-600' : ''}`}>{formatNum(kpi.avg, kpi)}</td>
                            <td className="px-3 py-1.5 text-[11px] text-right">{formatNum(kpi.latest, kpi)}</td>
                            <td className="px-3 py-1.5 text-[11px] text-right text-gray-400">{formatNum(kpi.min, kpi)}</td>
                            <td className="px-3 py-1.5 text-[11px] text-right text-gray-400">{formatNum(kpi.max, kpi)}</td>
                            <td className="px-3 py-1.5 text-center"><TrendBadge trend={trend.direction} pctChange={trend.pctChange} /></td>
                            <td className="px-3 py-1.5 text-center"><MiniSparkline values={kpi.values} isPercentage={kpi.isPercentage} color={ownerColor} /></td>
                            <td className="px-3 py-1.5 text-center">
                              <button onClick={(e) => { e.stopPropagation(); setDrillKPI(drillKPI === kpi ? null : kpi); }} className="p-1 rounded hover:bg-blue-100 text-blue-500">
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Inline Drill-down panel */}
                {drillKPI && mainKPIs.includes(drillKPI) && (
                  <DrillDownPanel kpi={drillKPI} dateKeys={dateKeys} color={ownerColor} onClose={() => setDrillKPI(null)} owner={owner} />
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Multi-Level Drill-Down Modal */}
      {drillDown && (
        <MultiLevelDrillDown
          owners={filteredOwners}
          dateKeys={dateKeys}
          initialOwner={drillDown.owner}
          initialKPI={drillDown.kpi}
          onClose={() => setDrillDown(null)}
        />
      )}
    </div>
  );
}

function DrillDownPanel({ kpi, dateKeys, color, onClose, owner }) {
  const trend = calcTrend(kpi.numericValues);
  const anomalies = detectAnomalies(kpi);
  const forecast = linearForecast(kpi.numericValues);
  const subKPIs = owner.kpis.filter(k => k.isSubKPI);
  // Find sub-KPIs that belong to this parent
  const kpiIdx = owner.kpis.indexOf(kpi);
  const children = [];
  for (let i = kpiIdx + 1; i < owner.kpis.length; i++) {
    if (owner.kpis[i].isSubKPI) children.push(owner.kpis[i]);
    else break;
  }

  const chartValues = kpi.values.filter(v => v.value !== null);
  const labels = chartValues.map(v => fmtDate(v.date));
  const toChartPct = val => kpi.isPercentage ? Math.round((kpi.isDecimal ? val * 100 : val) * 100) / 100 : val;
  const data = chartValues.map(v => toChartPct(v.value));

  // Weekly aggregates
  const weeklyMap = {};
  chartValues.forEach(v => {
    const wk = weekKey(v.date);
    if (!weeklyMap[wk]) weeklyMap[wk] = [];
    weeklyMap[wk].push(v.value);
  });
  const weeklyLabels = Object.keys(weeklyMap);
  const weeklyData = weeklyLabels.map(wk => {
    const vals = weeklyMap[wk];
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return toChartPct(avg) || Math.round(avg * 100) / 100;
  });

  return (
    <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-gray-800 flex items-center gap-2">
          <Activity className="w-4 h-4" style={{ color }} />{kpi.name}
        </h4>
        <button onClick={onClose} className="p-1 rounded-md hover:bg-gray-200"><X className="w-4 h-4 text-gray-500" /></button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <div className="bg-white rounded-lg p-2 text-center">
          <p className="text-[9px] text-gray-400 uppercase">Average</p>
          <p className="text-sm font-bold text-gray-800">{formatNum(kpi.avg, kpi)}</p>
        </div>
        <div className="bg-white rounded-lg p-2 text-center">
          <p className="text-[9px] text-gray-400 uppercase">Latest</p>
          <p className="text-sm font-bold text-gray-800">{formatNum(kpi.latest, kpi)}</p>
        </div>
        <div className="bg-white rounded-lg p-2 text-center">
          <p className="text-[9px] text-gray-400 uppercase">Range</p>
          <p className="text-sm font-bold text-gray-800">{formatNum(kpi.min, kpi)} - {formatNum(kpi.max, kpi)}</p>
        </div>
        <div className="bg-white rounded-lg p-2 text-center">
          <p className="text-[9px] text-gray-400 uppercase">Trend</p>
          <TrendBadge trend={trend.direction} pctChange={trend.pctChange} />
        </div>
        <div className="bg-white rounded-lg p-2 text-center">
          <p className="text-[9px] text-gray-400 uppercase">Data Points</p>
          <p className="text-sm font-bold text-gray-800">{kpi.dataPoints}</p>
        </div>
      </div>

      {/* Daily trend chart */}
      <div className="chart-container bg-white">
        <LineChart
          title={`Daily Trend${kpi.isPercentage ? ' (%)' : ''}`}
          labels={labels}
          datasets={[
            { label: kpi.name, data, color, fill: true },
            ...(forecast.length ? [{ label: 'Forecast', data: [...Array(data.length - 1).fill(null), data[data.length - 1], ...forecast.map(f => toChartPct(f))], color: '#A855F7', borderDash: [5, 5] }] : []),
          ]}
          height={200}
        />
      </div>

      {/* Weekly trend */}
      <div className="chart-container bg-white">
        <BarChart
          title={`Weekly Average${kpi.isPercentage ? ' (%)' : ''}`}
          labels={weeklyLabels}
          datasets={[{ label: 'Weekly Avg', data: weeklyData, color }]}
          height={160}
        />
      </div>

      {/* Sub-KPI breakdown */}
      {children.length > 0 && (
        <div className="bg-white rounded-lg p-2">
          <h5 className="text-[10px] font-semibold text-gray-500 uppercase mb-1.5">Breakdown</h5>
          <div className="space-y-1">
            {children.map((sub, i) => (
              <div key={i} className="flex items-center justify-between py-1 px-2 rounded bg-gray-50/80">
                <span className="text-[11px] text-gray-700">{sub.name}</span>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-semibold">{formatNum(sub.avg, sub)}</span>
                  <MiniSparkline values={sub.values} color={COLORS[i % COLORS.length]} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Anomalies */}
      {anomalies.length > 0 && (
        <div className="bg-white rounded-lg p-2">
          <h5 className="text-[10px] font-semibold text-gray-500 uppercase mb-1.5 flex items-center gap-1"><ShieldAlert className="w-3 h-3 text-amber-500" />Anomalies Detected</h5>
          <div className="space-y-1">
            {anomalies.map((a, i) => (
              <div key={i} className={`flex items-center justify-between py-1 px-2 rounded text-[11px] ${a.type === 'spike' ? 'bg-amber-50' : 'bg-red-50'}`}>
                <span className="text-gray-600">{fmtDateFull(a.date)}</span>
                <span className="font-semibold">{formatNum(a.value, kpi)} ({a.zscore}x std dev {a.type})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Forecast */}
      {forecast.length > 0 && (
        <div className="bg-white rounded-lg p-2">
          <h5 className="text-[10px] font-semibold text-gray-500 uppercase mb-1 flex items-center gap-1"><Zap className="w-3 h-3 text-violet-500" />7-Day Forecast (Linear Projection)</h5>
          <div className="flex gap-1.5 flex-wrap">
            {forecast.map((f, i) => (
              <span key={i} className="px-2 py-0.5 bg-violet-50 text-violet-700 rounded text-[10px] font-medium">
                Day {i + 1}: {formatNum(f, kpi)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Pivot Table ─────────────────────────────────────────────────────────────

function PivotTable({ kpi, owner, allOwners, dateKeys }) {
  const [pivotMode, setPivotMode] = useState('weekly'); // weekly | monthly | daily

  // Find sub-KPIs for this KPI
  const kpiIdx = owner ? owner.kpis.indexOf(kpi) : -1;
  const children = [];
  if (owner && kpiIdx >= 0) {
    for (let i = kpiIdx + 1; i < owner.kpis.length; i++) {
      if (owner.kpis[i].isSubKPI) children.push(owner.kpis[i]);
      else break;
    }
  }

  // Cross-employee comparison: find same KPI across all owners
  const crossEmployee = allOwners ? allOwners.map(o => {
    const match = o.kpis.find(k => k.name === kpi.name && !k.isSubKPI);
    return match ? { owner: o.name, kpi: match } : null;
  }).filter(Boolean) : [];

  // Determine rows (sub-KPIs if available, else cross-employee)
  const rows = children.length > 0
    ? children.map(c => ({ label: c.name, kpi: c }))
    : crossEmployee.map(ce => ({ label: ce.owner, kpi: ce.kpi }));

  if (rows.length === 0) return null;

  // Build time columns based on pivot mode
  const buildColumns = (values) => {
    const colMap = {};
    values.forEach(v => {
      if (v.value === null) return;
      let col;
      if (pivotMode === 'weekly') col = weekKey(v.date);
      else if (pivotMode === 'monthly') col = monthKey(v.date);
      else col = fmtDate(v.date);
      if (!colMap[col]) colMap[col] = [];
      colMap[col].push(v.value);
    });
    return colMap;
  };

  // Get all unique columns from all rows
  const allColsSet = new Set();
  rows.forEach(r => {
    const cols = buildColumns(r.kpi.values);
    Object.keys(cols).forEach(c => allColsSet.add(c));
  });
  const allCols = Array.from(allColsSet);
  // Sort columns chronologically
  if (pivotMode === 'daily') {
    // Already sorted by date in values
  }

  // Build pivot data
  const pivotData = rows.map(r => {
    const cols = buildColumns(r.kpi.values);
    const cellValues = {};
    allCols.forEach(c => {
      const vals = cols[c];
      cellValues[c] = vals ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    });
    return { label: r.label, kpi: r.kpi, cells: cellValues };
  });

  // Determine low threshold
  const isLow = (val, rowKpi) => {
    if (val === null) return false;
    if (rowKpi.isPercentage) return scoreVal(val, rowKpi) < 0.6;
    return false;
  };

  const isMedium = (val, rowKpi) => {
    if (val === null) return false;
    if (rowKpi.isPercentage) {
      const s = scoreVal(val, rowKpi);
      return s >= 0.6 && s < 0.8;
    }
    return false;
  };

  return (
    <div className="bg-white rounded-lg border border-gray-100 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50/80 border-b border-gray-100">
        <h5 className="text-[10px] font-semibold text-gray-500 uppercase flex items-center gap-1.5">
          <Table2 className="w-3.5 h-3.5 text-indigo-500" />
          Pivot Breakdown — {kpi.name}
        </h5>
        <div className="flex gap-1">
          {['daily', 'weekly', 'monthly'].map(mode => (
            <button
              key={mode}
              onClick={() => setPivotMode(mode)}
              className={`px-2 py-0.5 rounded text-[9px] font-medium transition-colors ${
                pivotMode === mode ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="bg-gray-50/50">
              <th className="px-2 py-1.5 text-left font-semibold text-gray-600 sticky left-0 bg-gray-50/50 min-w-[120px]">
                {children.length > 0 ? 'Sub-KPI' : 'Employee'}
              </th>
              <th className="px-2 py-1.5 text-right font-semibold text-gray-600 min-w-[50px]">Avg</th>
              {allCols.map(col => (
                <th key={col} className="px-2 py-1.5 text-right font-semibold text-gray-500 whitespace-nowrap min-w-[55px]">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {pivotData.map((row, ri) => (
              <tr key={ri} className={`hover:bg-blue-50/30 ${ri % 2 ? 'bg-gray-50/20' : ''}`}>
                <td className="px-2 py-1.5 font-medium text-gray-700 sticky left-0 bg-white truncate max-w-[150px]" title={row.label}>{row.label}</td>
                <td className="px-2 py-1.5 text-right font-semibold text-gray-800">{formatNum(row.kpi.avg, row.kpi)}</td>
                {allCols.map(col => {
                  const val = row.cells[col];
                  const low = isLow(val, row.kpi);
                  const med = isMedium(val, row.kpi);
                  return (
                    <td key={col} className={`px-2 py-1.5 text-right font-medium ${
                      low ? 'bg-red-100 text-red-700 font-bold' : med ? 'bg-amber-50 text-amber-700' : 'text-gray-600'
                    }`}>
                      {val !== null ? formatNum(val, row.kpi) : <span className="text-gray-300">-</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Multi-Level Drill-Down Modal ────────────────────────────────────────────

function MultiLevelDrillDown({ owners, dateKeys, initialOwner, initialKPI, onClose }) {
  // Breadcrumb levels: summary → team → kpi → subkpi
  const [path, setPath] = useState(() => {
    const p = [{ level: 'summary', label: 'All KPIs' }];
    if (initialOwner) p.push({ level: 'team', label: initialOwner.name, owner: initialOwner });
    if (initialKPI) p.push({ level: 'kpi', label: initialKPI.name, kpi: initialKPI, owner: initialOwner });
    return p;
  });

  const current = path[path.length - 1];

  const navigateTo = (level, data) => {
    setPath(prev => [...prev, { level, ...data }]);
  };

  const navigateBack = (index) => {
    setPath(prev => prev.slice(0, index + 1));
  };

  // ─── Summary Level: all owners, their low KPIs
  const renderSummary = () => {
    const allLowKPIs = owners.flatMap(o =>
      o.kpis.filter(k => !k.isSubKPI && k.isPercentage && k.avg !== null && scoreVal(k.avg, k) < 0.7)
        .map(k => ({ ...k, owner: o.name, ownerObj: o, trend: calcTrend(k.numericValues) }))
    ).sort((a, b) => scoreVal(a.avg, a) - scoreVal(b.avg, b));

    return (
      <div className="space-y-3">
        <div className="bg-red-50 border border-red-100 rounded-lg p-3">
          <h5 className="text-[11px] font-bold text-red-700 flex items-center gap-1.5 mb-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            {allLowKPIs.length} KPIs Below 70% Target
          </h5>
          <p className="text-[10px] text-red-500">Click any KPI or team to drill down for detailed breakdown</p>
        </div>

        {/* Group by owner */}
        {owners.map(owner => {
          const lowKPIs = owner.kpis.filter(k => !k.isSubKPI && k.isPercentage && k.avg !== null && scoreVal(k.avg, k) < 0.7);
          const score = calcOwnerScore(owner);
          if (lowKPIs.length === 0) return null;

          return (
            <div key={owner.name} className="bg-white rounded-lg border border-gray-100 overflow-hidden">
              <button
                onClick={() => navigateTo('team', { label: owner.name, owner })}
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-blue-50/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[10px] font-bold" style={{ background: OWNER_COLORS[owner.name] || '#6366F1' }}>
                    {owner.name.charAt(0)}
                  </div>
                  <div className="text-left">
                    <p className="text-[12px] font-semibold text-gray-800">{owner.name}</p>
                    <p className="text-[9px] text-gray-400">{lowKPIs.length} low KPIs | Score: {score.score}%</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-red-600">{lowKPIs.length} alerts</span>
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                </div>
              </button>
              <div className="border-t border-gray-50 px-3 py-1.5">
                {lowKPIs.slice(0, 3).map((k, i) => (
                  <button
                    key={i}
                    onClick={() => navigateTo('kpi', { label: k.name, kpi: k, owner })}
                    className="w-full flex items-center justify-between py-1 hover:bg-red-50/50 rounded px-1 transition-colors"
                  >
                    <span className="text-[10px] text-gray-600 truncate">{k.name}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold text-red-600">{(scoreVal(k.avg, k) * 100).toFixed(1)}%</span>
                      <ArrowRight className="w-3 h-3 text-gray-400" />
                    </div>
                  </button>
                ))}
                {lowKPIs.length > 3 && (
                  <button
                    onClick={() => navigateTo('team', { label: owner.name, owner })}
                    className="text-[9px] text-blue-500 hover:text-blue-700 mt-0.5"
                  >
                    +{lowKPIs.length - 3} more...
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ─── Team Level: all KPIs for one owner
  const renderTeam = () => {
    const owner = current.owner;
    const mainKPIs = owner.kpis.filter(k => !k.isSubKPI);
    const lowKPIs = mainKPIs.filter(k => k.isPercentage && k.avg !== null && scoreVal(k.avg, k) < 0.7);
    const okKPIs = mainKPIs.filter(k => !lowKPIs.includes(k));
    const ownerColor = OWNER_COLORS[owner.name] || '#6366F1';

    return (
      <div className="space-y-3">
        {/* Owner header */}
        <div className="bg-white rounded-lg border border-gray-100 p-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-lg" style={{ background: ownerColor }}>
            {owner.name.charAt(0)}
          </div>
          <div>
            <p className="text-sm font-bold text-gray-800">{owner.name}</p>
            <p className="text-[10px] text-gray-400">{mainKPIs.length} KPIs | {lowKPIs.length} below target</p>
          </div>
          <div className="ml-auto">
            <GradeBadge grade={calcOwnerScore(owner).grade} />
          </div>
        </div>

        {/* Low KPIs section */}
        {lowKPIs.length > 0 && (
          <div className="space-y-1.5">
            <h5 className="text-[10px] font-semibold text-red-600 uppercase flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Below Target KPIs</h5>
            {lowKPIs.map((kpi, i) => {
              const trend = calcTrend(kpi.numericValues);
              return (
                <button
                  key={i}
                  onClick={() => navigateTo('kpi', { label: kpi.name, kpi, owner })}
                  className="w-full bg-red-50/80 border border-red-100 rounded-lg p-2.5 flex items-center justify-between hover:bg-red-100/50 transition-colors text-left"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium text-gray-800 truncate">{kpi.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-gray-400">Avg: {formatNum(kpi.avg, kpi)}</span>
                      <span className="text-[10px] text-gray-400">Latest: {formatNum(kpi.latest, kpi)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-red-600">{(scoreVal(kpi.avg, kpi) * 100).toFixed(1)}%</span>
                    <TrendBadge trend={trend.direction} pctChange={trend.pctChange} />
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Other KPIs */}
        {okKPIs.length > 0 && (
          <div className="space-y-1.5">
            <h5 className="text-[10px] font-semibold text-gray-500 uppercase">Other KPIs</h5>
            {okKPIs.map((kpi, i) => {
              const trend = calcTrend(kpi.numericValues);
              return (
                <button
                  key={i}
                  onClick={() => navigateTo('kpi', { label: kpi.name, kpi, owner })}
                  className="w-full bg-white border border-gray-100 rounded-lg p-2 flex items-center justify-between hover:bg-blue-50/30 transition-colors text-left"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium text-gray-700 truncate">{kpi.name}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-gray-600">{formatNum(kpi.avg, kpi)}</span>
                    <TrendBadge trend={trend.direction} pctChange={trend.pctChange} />
                    <MiniSparkline values={kpi.values} color={ownerColor} />
                    <ChevronRight className="w-3.5 h-3.5 text-gray-300" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // ─── KPI Level: detailed view with pivot, sub-KPIs, daily data
  const renderKPI = () => {
    const { kpi, owner } = current;
    const trend = calcTrend(kpi.numericValues);
    const anomalies = detectAnomalies(kpi);
    const forecast = linearForecast(kpi.numericValues);
    const ownerColor = OWNER_COLORS[owner.name] || '#6366F1';

    // Find sub-KPIs
    const kpiIdx = owner.kpis.indexOf(kpi);
    const children = [];
    for (let i = kpiIdx + 1; i < owner.kpis.length; i++) {
      if (owner.kpis[i].isSubKPI) children.push(owner.kpis[i]);
      else break;
    }

    const isLowKPI = kpi.isPercentage && kpi.avg !== null && scoreVal(kpi.avg, kpi) < 0.7;
    const chartValues = kpi.values.filter(v => v.value !== null);
    const toChartPct = val => kpi.isPercentage ? Math.round((kpi.isDecimal ? val * 100 : val) * 100) / 100 : val;

    return (
      <div className="space-y-3">
        {/* KPI Header */}
        <div className={`rounded-lg p-3 ${isLowKPI ? 'bg-red-50 border border-red-100' : 'bg-blue-50 border border-blue-100'}`}>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-bold text-gray-800">{kpi.name}</h4>
            <span className={`text-lg font-bold ${isLowKPI ? 'text-red-600' : 'text-emerald-600'}`}>
              {formatNum(kpi.avg, kpi)}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <div className="bg-white/80 rounded p-1.5 text-center">
              <p className="text-[9px] text-gray-400">Average</p>
              <p className="text-[11px] font-bold">{formatNum(kpi.avg, kpi)}</p>
            </div>
            <div className="bg-white/80 rounded p-1.5 text-center">
              <p className="text-[9px] text-gray-400">Latest</p>
              <p className="text-[11px] font-bold">{formatNum(kpi.latest, kpi)}</p>
            </div>
            <div className="bg-white/80 rounded p-1.5 text-center">
              <p className="text-[9px] text-gray-400">Range</p>
              <p className="text-[11px] font-bold">{formatNum(kpi.min, kpi)} - {formatNum(kpi.max, kpi)}</p>
            </div>
            <div className="bg-white/80 rounded p-1.5 text-center">
              <p className="text-[9px] text-gray-400">Trend</p>
              <TrendBadge trend={trend.direction} pctChange={trend.pctChange} />
            </div>
            <div className="bg-white/80 rounded p-1.5 text-center">
              <p className="text-[9px] text-gray-400">Data Points</p>
              <p className="text-[11px] font-bold">{kpi.dataPoints}</p>
            </div>
          </div>
        </div>

        {/* Trend Chart */}
        <div className="chart-container bg-white">
          <LineChart
            title={`Daily Trend${kpi.isPercentage ? ' (%)' : ''}`}
            labels={chartValues.map(v => fmtDate(v.date))}
            datasets={[
              { label: kpi.name, data: chartValues.map(v => toChartPct(v.value)), color: ownerColor, fill: true },
              ...(forecast.length ? [{
                label: 'Forecast',
                data: [...Array(chartValues.length - 1).fill(null), toChartPct(chartValues[chartValues.length - 1].value), ...forecast.map(f => toChartPct(f))],
                color: '#A855F7', borderDash: [5, 5],
              }] : []),
            ]}
            height={200}
          />
        </div>

        {/* Pivot Table - auto-shown for low KPIs, toggleable for others */}
        {(children.length > 0 || owners.length > 1) && (
          <PivotTable kpi={kpi} owner={owner} allOwners={owners} dateKeys={dateKeys} />
        )}

        {/* Sub-KPI clickable cards */}
        {children.length > 0 && (
          <div className="space-y-1.5">
            <h5 className="text-[10px] font-semibold text-gray-500 uppercase flex items-center gap-1.5">
              <Layers className="w-3 h-3 text-indigo-500" />Sub-KPI Breakdown (click to drill deeper)
            </h5>
            {children.map((sub, i) => {
              const subTrend = calcTrend(sub.numericValues);
              const subLow = sub.isPercentage && sub.avg !== null && scoreVal(sub.avg, sub) < 0.6;
              return (
                <button
                  key={i}
                  onClick={() => navigateTo('subkpi', { label: sub.name, kpi: sub, owner, parentKPI: kpi })}
                  className={`w-full flex items-center justify-between p-2 rounded-lg border transition-colors text-left ${
                    subLow ? 'bg-red-50 border-red-100 hover:bg-red-100/50' : 'bg-gray-50/80 border-gray-100 hover:bg-blue-50/30'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-bold text-gray-400 w-4">{i + 1}</span>
                    <span className="text-[11px] font-medium text-gray-700 truncate">{sub.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-bold ${subLow ? 'text-red-600' : 'text-gray-700'}`}>{formatNum(sub.avg, sub)}</span>
                    <TrendBadge trend={subTrend.direction} pctChange={subTrend.pctChange} />
                    <MiniSparkline values={sub.values} color={COLORS[i % COLORS.length]} />
                    <ChevronRight className="w-3.5 h-3.5 text-gray-300" />
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Anomalies */}
        {anomalies.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-100 p-2">
            <h5 className="text-[10px] font-semibold text-gray-500 uppercase mb-1.5 flex items-center gap-1"><ShieldAlert className="w-3 h-3 text-amber-500" />Anomalies</h5>
            <div className="space-y-1">
              {anomalies.map((a, i) => (
                <div key={i} className={`flex items-center justify-between py-1 px-2 rounded text-[11px] ${a.type === 'spike' ? 'bg-amber-50' : 'bg-red-50'}`}>
                  <span className="text-gray-600">{fmtDateFull(a.date)}</span>
                  <span className="font-semibold">{formatNum(a.value, kpi)} ({a.zscore}x std dev {a.type})</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  // ─── Sub-KPI Level: deepest drill-down with daily values
  const renderSubKPI = () => {
    const { kpi, owner, parentKPI } = current;
    const ownerColor = OWNER_COLORS[owner.name] || '#6366F1';
    const chartValues = kpi.values.filter(v => v.value !== null);
    const toChartPct = val => kpi.isPercentage ? Math.round((kpi.isDecimal ? val * 100 : val) * 100) / 100 : val;

    return (
      <div className="space-y-3">
        <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3">
          <p className="text-[9px] text-indigo-400 uppercase font-semibold">Sub-KPI of {parentKPI?.name || 'Parent'}</p>
          <h4 className="text-sm font-bold text-gray-800 mt-0.5">{kpi.name}</h4>
          <div className="flex items-center gap-4 mt-1.5">
            <span className="text-[11px] text-gray-500">Avg: <strong>{formatNum(kpi.avg, kpi)}</strong></span>
            <span className="text-[11px] text-gray-500">Latest: <strong>{formatNum(kpi.latest, kpi)}</strong></span>
            <span className="text-[11px] text-gray-500">Points: <strong>{kpi.dataPoints}</strong></span>
          </div>
        </div>

        {/* Trend chart */}
        <div className="chart-container bg-white">
          <LineChart
            title={`${kpi.name} — Daily Values`}
            labels={chartValues.map(v => fmtDate(v.date))}
            datasets={[{ label: kpi.name, data: chartValues.map(v => toChartPct(v.value)), color: ownerColor, fill: true }]}
            height={200}
          />
        </div>

        {/* Raw daily data table (order-level equivalent) */}
        <div className="bg-white rounded-lg border border-gray-100 overflow-hidden">
          <div className="px-3 py-2 bg-gray-50/80 border-b border-gray-100">
            <h5 className="text-[10px] font-semibold text-gray-500 uppercase">Daily Values — Order Level Detail</h5>
          </div>
          <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
            <table className="w-full text-[10px]">
              <thead className="sticky top-0 bg-white">
                <tr>
                  <th className="px-2 py-1.5 text-left font-semibold text-gray-600">Date</th>
                  <th className="px-2 py-1.5 text-right font-semibold text-gray-600">Value</th>
                  <th className="px-2 py-1.5 text-right font-semibold text-gray-600">Raw</th>
                  <th className="px-2 py-1.5 text-center font-semibold text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {kpi.values.slice().reverse().map((v, i) => {
                  const isLow = v.value !== null && kpi.isPercentage && scoreVal(v.value, kpi) < 0.6;
                  return (
                    <tr key={i} className={`${isLow ? 'bg-red-50' : i % 2 ? 'bg-gray-50/20' : ''}`}>
                      <td className="px-2 py-1 text-gray-700">{fmtDateFull(v.date)}</td>
                      <td className={`px-2 py-1 text-right font-medium ${isLow ? 'text-red-600 font-bold' : 'text-gray-800'}`}>
                        {v.value !== null ? formatNum(v.value, kpi) : '-'}
                      </td>
                      <td className="px-2 py-1 text-right text-gray-400">{v.raw != null ? String(v.raw) : '-'}</td>
                      <td className="px-2 py-1 text-center">
                        {v.value === null ? (
                          <span className="text-[9px] text-gray-300">{v.raw || '-'}</span>
                        ) : isLow ? (
                          <span className="text-[9px] text-red-500 font-semibold">LOW</span>
                        ) : (
                          <span className="text-[9px] text-emerald-500">OK</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-50 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Modal Header */}
        <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Layers className="w-4 h-4 text-indigo-500 flex-shrink-0" />
            <h3 className="text-sm font-bold text-gray-800">Drill-Down Analysis</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
        </div>

        {/* Breadcrumb */}
        <div className="bg-white border-b border-gray-50 px-4 py-2 flex items-center gap-1 overflow-x-auto flex-shrink-0">
          {path.map((p, i) => (
            <React.Fragment key={i}>
              {i > 0 && <ChevronRight className="w-3 h-3 text-gray-300 flex-shrink-0" />}
              <button
                onClick={() => i < path.length - 1 && navigateBack(i)}
                className={`text-[11px] px-2 py-0.5 rounded whitespace-nowrap transition-colors ${
                  i === path.length - 1
                    ? 'bg-indigo-100 text-indigo-700 font-semibold'
                    : 'text-gray-500 hover:text-indigo-600 hover:bg-indigo-50'
                }`}
              >
                {p.label}
              </button>
            </React.Fragment>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {current.level === 'summary' && renderSummary()}
          {current.level === 'team' && renderTeam()}
          {current.level === 'kpi' && renderKPI()}
          {current.level === 'subkpi' && renderSubKPI()}
        </div>

        {/* Footer with back button */}
        {path.length > 1 && (
          <div className="bg-white border-t border-gray-100 px-4 py-2 flex items-center flex-shrink-0">
            <button
              onClick={() => navigateBack(path.length - 2)}
              className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-indigo-600 transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />Back to {path[path.length - 2].label}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Trends Tab ──────────────────────────────────────────────────────────────

function TrendsTab({ filteredOwners, dateKeys }) {
  const [selectedOwner, setSelectedOwner] = useState('all');
  const [selectedKPIType, setSelectedKPIType] = useState('percentage');
  const [drillDown, setDrillDown] = useState(null);

  const owners = selectedOwner === 'all' ? filteredOwners : filteredOwners.filter(o => o.name === selectedOwner);
  const kpis = owners.flatMap(o =>
    o.kpis.filter(k => !k.isSubKPI && k.numericValues.length >= 5 && (selectedKPIType === 'percentage' ? k.isPercentage : selectedKPIType === 'count' ? !k.isPercentage && !k.isCurrency : k.isCurrency))
      .map(k => ({ ...k, owner: o.name, ownerObj: o }))
  );

  // Select top 5 KPIs for chart
  const chartKPIs = kpis.slice(0, 5);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 bg-white rounded-xl border border-gray-100 p-2" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
        <Filter className="w-3.5 h-3.5 text-gray-400" />
        <select value={selectedOwner} onChange={e => setSelectedOwner(e.target.value)} className="px-2 py-1 border border-gray-200 rounded-md text-[11px] bg-white">
          <option value="all">All Employees</option>
          {filteredOwners.map(o => <option key={o.name} value={o.name}>{o.name}</option>)}
        </select>
        <select value={selectedKPIType} onChange={e => setSelectedKPIType(e.target.value)} className="px-2 py-1 border border-gray-200 rounded-md text-[11px] bg-white">
          <option value="percentage">Percentage KPIs</option>
          <option value="count">Count KPIs</option>
          <option value="currency">Value KPIs</option>
        </select>
        <span className="text-[10px] text-gray-400 ml-auto">{kpis.length} KPIs found</span>
      </div>

      {/* Trend line chart */}
      {chartKPIs.length > 0 && (
        <div className="chart-container">
          <LineChart
            title={`KPI Trends - ${selectedKPIType === 'percentage' ? 'Percentage' : selectedKPIType === 'count' ? 'Count' : 'Value'} Metrics`}
            labels={dateKeys.map(dk => fmtDate(dk.date))}
            datasets={chartKPIs.map((kpi, i) => {
              const dataMap = {};
              kpi.values.forEach(v => { if (v.value !== null) dataMap[fmtDate(v.date)] = kpi.isPercentage ? (kpi.isDecimal ? v.value * 100 : v.value) : v.value; });
              return {
                label: `${kpi.owner}: ${kpi.name.length > 30 ? kpi.name.slice(0, 27) + '...' : kpi.name}`,
                data: dateKeys.map(dk => dataMap[fmtDate(dk.date)] ?? null),
                color: COLORS[i],
                fill: false,
                spanGaps: true,
              };
            })}
            height={280}
          />
        </div>
      )}

      {/* KPI Cards Grid — Click to drill down */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {kpis.map((kpi, i) => {
          const trend = calcTrend(kpi.numericValues);
          const isLow = kpi.isPercentage && kpi.avg !== null && scoreVal(kpi.avg, kpi) < 0.7;
          return (
            <button
              key={i}
              onClick={() => {
                const ownerObj = kpi.ownerObj || filteredOwners.find(o => o.name === kpi.owner);
                const kpiObj = ownerObj?.kpis.find(k => k.name === kpi.name && !k.isSubKPI);
                if (ownerObj && kpiObj) setDrillDown({ owner: ownerObj, kpi: kpiObj });
              }}
              className={`bg-white rounded-xl border p-3 hover:shadow-md transition-shadow text-left ${isLow ? 'border-red-200 ring-1 ring-red-100' : 'border-gray-100'}`}
              style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold text-gray-700 truncate" title={kpi.name}>{kpi.name}</p>
                  <p className="text-[9px] text-gray-400">{kpi.owner}</p>
                </div>
                <TrendBadge trend={trend.direction} pctChange={trend.pctChange} />
              </div>
              <div className="flex items-end justify-between">
                <div>
                  <p className={`text-lg font-bold ${isLow ? 'text-red-600' : 'text-gray-900'}`}>{formatNum(kpi.latest, kpi)}</p>
                  <p className="text-[9px] text-gray-400">Avg: {formatNum(kpi.avg, kpi)}</p>
                </div>
                <MiniSparkline values={kpi.values} color={OWNER_COLORS[kpi.owner] || COLORS[i % COLORS.length]} />
              </div>
              {isLow && <p className="text-[9px] text-red-400 mt-1 flex items-center gap-0.5"><AlertTriangle className="w-2.5 h-2.5" />Below target — click to view breakdown</p>}
            </button>
          );
        })}
      </div>

      {/* Drill-Down Modal */}
      {drillDown && (
        <MultiLevelDrillDown
          owners={filteredOwners}
          dateKeys={dateKeys}
          initialOwner={drillDown.owner}
          initialKPI={drillDown.kpi}
          onClose={() => setDrillDown(null)}
        />
      )}
    </div>
  );
}

// ─── Leaderboard Tab ─────────────────────────────────────────────────────────

function LeaderboardTab({ filteredOwners }) {
  const scores = filteredOwners.map(o => ({ ...calcOwnerScore(o), name: o.name, kpis: o.kpis })).sort((a, b) => b.score - a.score);

  const medals = ['', '', ''];

  return (
    <div className="space-y-4">
      {/* Podium */}
      <div className="bg-gradient-to-br from-indigo-600 via-blue-600 to-violet-600 rounded-xl p-5 text-white">
        <h3 className="text-sm font-bold mb-4 flex items-center gap-2"><Trophy className="w-4 h-4" />Performance Leaderboard</h3>
        <div className="flex items-end justify-center gap-4">
          {scores.slice(0, 3).map((s, i) => {
            const heights = [140, 120, 100];
            const sizes = ['text-2xl', 'text-xl', 'text-lg'];
            const order = [1, 0, 2];
            const sorted = [scores[1], scores[0], scores[2]].filter(Boolean);
            const item = sorted[i];
            if (!item) return null;
            return (
              <div key={item.name} className="flex flex-col items-center" style={{ order: order[i] }}>
                <span className="text-2xl mb-1">{medals[scores.indexOf(item)]}</span>
                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white font-bold mb-1">{item.name.charAt(0)}</div>
                <p className="text-[11px] font-semibold text-white/90">{item.name}</p>
                <div className={`w-20 rounded-t-lg bg-white/20 backdrop-blur flex items-center justify-center mt-1`} style={{ height: heights[scores.indexOf(item)] || 80 }}>
                  <span className={`${sizes[scores.indexOf(item)] || 'text-lg'} font-bold`}>{item.score}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Full Rankings Table */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50/80 border-b border-gray-100">
              <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase w-12">Rank</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Employee</th>
              <th className="px-3 py-2 text-center text-[10px] font-semibold text-gray-500 uppercase">Score</th>
              <th className="px-3 py-2 text-center text-[10px] font-semibold text-gray-500 uppercase">Grade</th>
              <th className="px-3 py-2 text-center text-[10px] font-semibold text-gray-500 uppercase">KPIs</th>
              <th className="px-3 py-2 text-center text-[10px] font-semibold text-gray-500 uppercase">Trend</th>
              <th className="px-3 py-2 text-center text-[10px] font-semibold text-gray-500 uppercase">Progress</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {scores.map((s, i) => (
              <tr key={s.name} className={`hover:bg-blue-50/30 ${i % 2 ? 'bg-gray-50/20' : ''}`}>
                <td className="px-3 py-2.5">
                  <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold ${i < 3 ? 'bg-gradient-to-br from-amber-400 to-amber-500 text-white' : 'bg-gray-100 text-gray-600'}`}>{i + 1}</span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[10px] font-bold" style={{ background: OWNER_COLORS[s.name] || '#6366F1' }}>{s.name.charAt(0)}</div>
                    <span className="text-[12px] font-semibold text-gray-800">{s.name}</span>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-center"><span className="text-sm font-bold text-gray-900">{s.score}%</span></td>
                <td className="px-3 py-2.5 text-center"><GradeBadge grade={s.grade} /></td>
                <td className="px-3 py-2.5 text-center"><span className="text-[11px] text-gray-600">{s.totalKPIs}</span></td>
                <td className="px-3 py-2.5 text-center"><TrendBadge trend={s.trending} /></td>
                <td className="px-3 py-2.5">
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div className={`h-2 rounded-full transition-all ${s.score >= 80 ? 'bg-emerald-500' : s.score >= 60 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${Math.min(s.score, 100)}%` }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* KPI-level champions */}
      <div className="bg-white rounded-xl border border-gray-100 p-3" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
        <h4 className="text-[11px] font-bold text-gray-700 flex items-center gap-1.5 mb-2"><Star className="w-3.5 h-3.5 text-amber-500" />KPI Champions - Best in Each Category</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {(() => {
            const kpiChampions = {};
            filteredOwners.forEach(o => {
              o.kpis.filter(k => !k.isSubKPI && k.isPercentage && k.avg !== null).forEach(k => {
                if (!kpiChampions[k.name] || k.avg > kpiChampions[k.name].avg) {
                  kpiChampions[k.name] = { ...k, owner: o.name };
                }
              });
            });
            return Object.values(kpiChampions).sort((a, b) => b.avg - a.avg).slice(0, 9).map((ch, i) => (
              <div key={i} className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-amber-50/50">
                <Medal className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-medium text-gray-700 truncate">{ch.name}</p>
                  <p className="text-[9px] text-gray-400">{ch.owner} - {(ch.avg * 100).toFixed(1)}%</p>
                </div>
              </div>
            ));
          })()}
        </div>
      </div>
    </div>
  );
}

// ─── AI Insights Tab ─────────────────────────────────────────────────────────

function InsightsTab({ filteredOwners, dateKeys }) {
  const [drillDown, setDrillDown] = useState(null);
  const insights = useMemo(() => generateInsights(filteredOwners), [filteredOwners]);

  const criticalCount = insights.filter(i => i.severity === 'critical').length;
  const warningCount = insights.filter(i => i.severity === 'warning').length;
  const positiveCount = insights.filter(i => i.severity === 'good').length;

  const iconMap = { warning: AlertTriangle, positive: CheckCircle, anomaly: ShieldAlert };
  const colorMap = { critical: 'border-red-200 bg-red-50', warning: 'border-amber-200 bg-amber-50', good: 'border-emerald-200 bg-emerald-50' };
  const iconColorMap = { critical: 'text-red-500', warning: 'text-amber-500', good: 'text-emerald-500' };

  // Generate improvement suggestions
  const suggestions = useMemo(() => {
    const sugs = [];
    filteredOwners.forEach(o => {
      const lowKPIs = o.kpis.filter(k => !k.isSubKPI && k.isPercentage && k.avg !== null && scoreVal(k.avg, k) < 0.7);
      if (lowKPIs.length > 0) {
        sugs.push({
          owner: o.name,
          message: `Focus on improving ${lowKPIs.length} underperforming KPI${lowKPIs.length > 1 ? 's' : ''}: ${lowKPIs.slice(0, 3).map(k => k.name).join(', ')}`,
          priority: lowKPIs.length > 3 ? 'high' : 'medium',
        });
      }
      const declining = o.kpis.filter(k => !k.isSubKPI && k.numericValues.length >= 7 && calcTrend(k.numericValues).direction === 'down');
      if (declining.length > 2) {
        sugs.push({
          owner: o.name,
          message: `Multiple KPIs declining for ${o.name}. Schedule a performance review to address: ${declining.slice(0, 3).map(k => k.name).join(', ')}`,
          priority: 'high',
        });
      }
    });
    return sugs;
  }, [filteredOwners]);

  // Predictive summary
  const predictions = useMemo(() => {
    const preds = [];
    filteredOwners.forEach(o => {
      o.kpis.filter(k => !k.isSubKPI && k.isPercentage && k.numericValues.length >= 10).forEach(k => {
        const fc = linearForecast(k.numericValues);
        if (fc.length > 0) {
          const currentAvg = k.avg;
          const forecastAvg = fc.reduce((a, b) => a + b, 0) / fc.length;
          const change = currentAvg ? ((forecastAvg - currentAvg) / currentAvg * 100) : 0;
          if (Math.abs(change) > 5) {
            preds.push({
              owner: o.name, kpi: k.name,
              current: currentAvg, forecast: forecastAvg,
              direction: change > 0 ? 'improve' : 'decline',
              change: Math.round(Math.abs(change) * 10) / 10,
            });
          }
        }
      });
    });
    return preds.sort((a, b) => b.change - a.change).slice(0, 8);
  }, [filteredOwners]);

  return (
    <div className="space-y-4">
      {/* AI Header */}
      <div className="bg-gradient-to-r from-violet-600 to-indigo-600 rounded-xl p-4 text-white">
        <div className="flex items-center gap-2 mb-2">
          <Brain className="w-5 h-5" />
          <h3 className="text-sm font-bold">AI-Powered Performance Insights</h3>
        </div>
        <p className="text-violet-200 text-[11px]">Automated analysis of {filteredOwners.length} employees across {filteredOwners.reduce((s, o) => s + o.kpis.filter(k => !k.isSubKPI).length, 0)} KPIs</p>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div className="bg-white/10 rounded-lg p-2 text-center">
            <p className="text-red-200 text-[9px] uppercase">Critical</p>
            <p className="text-xl font-bold">{criticalCount}</p>
          </div>
          <div className="bg-white/10 rounded-lg p-2 text-center">
            <p className="text-amber-200 text-[9px] uppercase">Warnings</p>
            <p className="text-xl font-bold">{warningCount}</p>
          </div>
          <div className="bg-white/10 rounded-lg p-2 text-center">
            <p className="text-emerald-200 text-[9px] uppercase">Positive</p>
            <p className="text-xl font-bold">{positiveCount}</p>
          </div>
        </div>
      </div>

      {/* Recommendations */}
      {suggestions.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-3" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <h4 className="text-[11px] font-bold text-gray-700 flex items-center gap-1.5 mb-2"><Lightbulb className="w-3.5 h-3.5 text-amber-500" />Smart Recommendations</h4>
          <div className="space-y-2">
            {suggestions.map((s, i) => (
              <div key={i} className={`flex items-start gap-2 p-2 rounded-lg ${s.priority === 'high' ? 'bg-red-50 border border-red-100' : 'bg-amber-50 border border-amber-100'}`}>
                <Zap className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${s.priority === 'high' ? 'text-red-500' : 'text-amber-500'}`} />
                <div>
                  <p className="text-[11px] text-gray-700"><span className="font-semibold">{s.owner}:</span> {s.message}</p>
                  <span className={`text-[9px] font-semibold uppercase ${s.priority === 'high' ? 'text-red-600' : 'text-amber-600'}`}>{s.priority} priority</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Predictions */}
      {predictions.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-3" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <h4 className="text-[11px] font-bold text-gray-700 flex items-center gap-1.5 mb-2"><Zap className="w-3.5 h-3.5 text-violet-500" />Predictive Analytics - Next 7 Days</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {predictions.map((p, i) => (
              <div key={i} className={`flex items-center justify-between p-2 rounded-lg ${p.direction === 'improve' ? 'bg-emerald-50' : 'bg-red-50'}`}>
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-gray-700 truncate">{p.kpi}</p>
                  <p className="text-[9px] text-gray-400">{p.owner}</p>
                </div>
                <div className="flex items-center gap-1">
                  {p.direction === 'improve'
                    ? <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500" />
                    : <ArrowDownRight className="w-3.5 h-3.5 text-red-500" />}
                  <span className={`text-[11px] font-bold ${p.direction === 'improve' ? 'text-emerald-600' : 'text-red-600'}`}>
                    {p.change}% {p.direction === 'improve' ? 'up' : 'down'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All Insights */}
      <div className="space-y-2">
        <h4 className="text-[11px] font-bold text-gray-700 flex items-center gap-1.5"><Activity className="w-3.5 h-3.5 text-blue-500" />All Insights ({insights.length})</h4>
        {insights.slice(0, 20).map((ins, i) => {
          const Icon = iconMap[ins.type] || Info;
          return (
            <button
              key={i}
              onClick={() => {
                const ownerObj = filteredOwners.find(o => o.name === ins.owner);
                const kpiObj = ownerObj?.kpis.find(k => k.name === ins.kpi && !k.isSubKPI);
                if (ownerObj && kpiObj) setDrillDown({ owner: ownerObj, kpi: kpiObj });
              }}
              className={`w-full flex items-start gap-2 p-2.5 rounded-lg border text-left hover:ring-2 hover:ring-indigo-200 transition-all ${colorMap[ins.severity] || colorMap.warning}`}
            >
              <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${iconColorMap[ins.severity] || iconColorMap.warning}`} />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium text-gray-800">{ins.message}</p>
                {ins.recommendation && <p className="text-[10px] text-gray-500 mt-0.5">{ins.recommendation}</p>}
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[9px] text-gray-400">{ins.owner}</span>
                  <span className={`text-[9px] font-semibold uppercase ${ins.severity === 'critical' ? 'text-red-600' : ins.severity === 'warning' ? 'text-amber-600' : 'text-emerald-600'}`}>{ins.severity}</span>
                  <span className="text-[9px] text-indigo-400 ml-auto">Click to drill down</span>
                </div>
              </div>
            </button>
          );
        })}
        {insights.length > 20 && <p className="text-[10px] text-gray-400 text-center">+{insights.length - 20} more insights</p>}
      </div>

      {/* Drill-Down Modal */}
      {drillDown && (
        <MultiLevelDrillDown
          owners={filteredOwners}
          dateKeys={dateKeys}
          initialOwner={drillDown.owner}
          initialKPI={drillDown.kpi}
          onClose={() => setDrillDown(null)}
        />
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function KPIMatrix() {
  const [activeTab, setActiveTab] = useState('overview');
  const [rawData, setRawData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastFetched, setLastFetched] = useState(null);
  const [selectedEmployee, setSelectedEmployee] = useState('all');
  const [dateRange, setDateRange] = useState(['', '']);
  const [searchQ, setSearchQ] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let json = null;
      // Try proxy first (works on Netlify), then direct API
      const urls = ['/api/kpi', KPI_API];
      for (const url of urls) {
        try {
          const res = await fetch(url, { redirect: 'follow' });
          if (!res.ok) continue;
          const ct = res.headers.get('content-type') || '';
          if (!ct.includes('json')) continue;
          json = await res.json();
          break;
        } catch { continue; }
      }
      if (!json) throw new Error('Failed to fetch KPI data from all sources');
      setRawData(Array.isArray(json) ? json : json.data || json);
      setLastFetched(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    const timer = setInterval(fetchData, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [fetchData]);

  const parsed = useMemo(() => rawData ? parseApiData(rawData) : { owners: [], dateKeys: [] }, [rawData]);

  // Filter by date range
  const filteredDateKeys = useMemo(() => {
    if (!dateRange[0] && !dateRange[1]) return parsed.dateKeys;
    const start = dateRange[0] ? new Date(dateRange[0]) : null;
    const end = dateRange[1] ? new Date(dateRange[1]) : null;
    return parsed.dateKeys.filter(dk => {
      if (start && dk.date < start) return false;
      if (end && dk.date > end) return false;
      return true;
    });
  }, [parsed.dateKeys, dateRange]);

  const filteredOwners = useMemo(() => {
    let owners = parsed.owners;
    if (selectedEmployee !== 'all') owners = owners.filter(o => o.name === selectedEmployee);
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase();
      owners = owners.map(o => ({
        ...o,
        kpis: o.kpis.filter(k => k.name.toLowerCase().includes(q) || k.fullName.toLowerCase().includes(q)),
      })).filter(o => o.kpis.length > 0);
    }
    // Apply date range filter to KPI values
    if (dateRange[0] || dateRange[1]) {
      const start = dateRange[0] ? new Date(dateRange[0]) : null;
      const end = dateRange[1] ? new Date(dateRange[1]) : null;
      owners = owners.map(o => ({
        ...o,
        kpis: o.kpis.map(k => {
          const filteredValues = k.values.filter(v => {
            if (start && v.date < start) return false;
            if (end && v.date > end) return false;
            return true;
          });
          const nums = filteredValues.map(v => v.value).filter(v => v !== null);
          return {
            ...k,
            values: filteredValues,
            numericValues: nums,
            avg: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null,
            latest: nums.length ? nums[nums.length - 1] : null,
            min: nums.length ? Math.min(...nums) : null,
            max: nums.length ? Math.max(...nums) : null,
            dataPoints: nums.length,
          };
        }),
      }));
    }
    return owners;
  }, [parsed.owners, selectedEmployee, searchQ, dateRange]);

  // Loading state
  if (loading && !rawData) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-3" />
        <p className="text-gray-500 text-sm">Loading KPI data...</p>
        <p className="text-gray-300 text-[10px] mt-1">Fetching from Google Sheets</p>
      </div>
    );
  }

  if (error && !rawData) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <XCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
        <p className="text-red-600 font-medium text-sm">Failed to load KPI data</p>
        <p className="text-red-400 text-xs mt-1">{error}</p>
        <button onClick={fetchData} className="btn-primary mt-3 text-xs">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 rounded-xl p-4 text-white">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-sm font-bold flex items-center gap-2"><BarChart3 className="w-4 h-4" />KPI Performance Matrix</h3>
            <p className="text-blue-200 text-[11px] mt-0.5">{parsed.owners.length} team members | {parsed.dateKeys.length} days tracked | AI-powered analytics</p>
          </div>
          <div className="flex items-center gap-2">
            {lastFetched && <span className="text-[9px] text-blue-200"><Clock className="w-3 h-3 inline mr-0.5" />{lastFetched.toLocaleTimeString()}</span>}
            <button onClick={fetchData} disabled={loading} className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-40">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Sub-tabs */}
        <div className="flex gap-1 mt-3 overflow-x-auto">
          {SUB_TABS.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all whitespace-nowrap ${
                  activeTab === tab.key ? 'bg-white text-indigo-700 shadow-md' : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-wrap items-center gap-2 bg-white rounded-xl border border-gray-100 px-3 py-2" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
        <Filter className="w-3.5 h-3.5 text-gray-400" />
        <select value={selectedEmployee} onChange={e => setSelectedEmployee(e.target.value)} className="px-2 py-1 border border-gray-200 rounded-md text-[11px] bg-white focus:ring-2 focus:ring-blue-500/30">
          <option value="all">All Employees</option>
          {parsed.owners.map(o => <option key={o.name} value={o.name}>{o.name}</option>)}
        </select>
        <DateRangeFilter dateKeys={parsed.dateKeys} dateRange={dateRange} setDateRange={setDateRange} />
        <div className="relative ml-auto">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
          <input
            type="text"
            placeholder="Search KPIs..."
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            className="pl-7 pr-3 py-1 border border-gray-200 rounded-md text-[11px] w-48 focus:ring-2 focus:ring-blue-500/30 bg-white"
          />
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && <OverviewTab owners={parsed.owners} dateKeys={filteredDateKeys} filteredOwners={filteredOwners} />}
      {activeTab === 'employees' && <EmployeeTab filteredOwners={filteredOwners} dateKeys={filteredDateKeys} />}
      {activeTab === 'trends' && <TrendsTab filteredOwners={filteredOwners} dateKeys={filteredDateKeys} />}
      {activeTab === 'leaderboard' && <LeaderboardTab filteredOwners={filteredOwners} />}
      {activeTab === 'insights' && <InsightsTab filteredOwners={filteredOwners} dateKeys={filteredDateKeys} />}
    </div>
  );
}
