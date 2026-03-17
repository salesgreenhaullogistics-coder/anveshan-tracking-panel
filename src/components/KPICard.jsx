import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

const COLOR_MAP = {
  blue:   { bg: 'bg-blue-50',   icon: 'text-blue-500',   accent: 'from-blue-500 to-blue-600',   ring: 'ring-blue-100' },
  green:  { bg: 'bg-emerald-50', icon: 'text-emerald-500', accent: 'from-emerald-500 to-emerald-600', ring: 'ring-emerald-100' },
  red:    { bg: 'bg-red-50',    icon: 'text-red-500',    accent: 'from-red-500 to-red-600',    ring: 'ring-red-100' },
  yellow: { bg: 'bg-amber-50',  icon: 'text-amber-500',  accent: 'from-amber-500 to-amber-600',  ring: 'ring-amber-100' },
  purple: { bg: 'bg-violet-50', icon: 'text-violet-500', accent: 'from-violet-500 to-violet-600', ring: 'ring-violet-100' },
  indigo: { bg: 'bg-indigo-50', icon: 'text-indigo-500', accent: 'from-indigo-500 to-indigo-600', ring: 'ring-indigo-100' },
  cyan:   { bg: 'bg-cyan-50',   icon: 'text-cyan-500',   accent: 'from-cyan-500 to-cyan-600',   ring: 'ring-cyan-100' },
  orange: { bg: 'bg-orange-50', icon: 'text-orange-500', accent: 'from-orange-500 to-orange-600', ring: 'ring-orange-100' },
  gray:   { bg: 'bg-gray-50',   icon: 'text-gray-500',   accent: 'from-gray-500 to-gray-600',   ring: 'ring-gray-100' },
};

export default function KPICard({ title, value, subtitle, icon: Icon, color = 'blue', change, suffix = '' }) {
  const theme = COLOR_MAP[color] || COLOR_MAP.blue;

  return (
    <div className="kpi-card group">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${theme.bg} ring-1 ${theme.ring} flex-shrink-0`}>
          {Icon && <Icon className={`w-4 h-4 ${theme.icon}`} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider truncate">{title}</p>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <p className="text-lg font-bold text-gray-900 leading-tight">
              {typeof value === 'number' ? value.toLocaleString('en-IN') : value}
            </p>
            {suffix && <span className="text-[10px] font-medium text-gray-400">{suffix}</span>}
            {subtitle && <span className="text-[10px] font-medium text-gray-400">{subtitle}</span>}
          </div>
        </div>
        {change !== undefined && change !== null && (
          <span className={`flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${change >= 0 ? 'text-emerald-700 bg-emerald-50' : 'text-red-700 bg-red-50'}`}>
            {change >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {Math.abs(change)}%
          </span>
        )}
      </div>
    </div>
  );
}
