import React from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Bar, Line, Pie, Doughnut } from 'react-chartjs-2';
import { COLORS } from '../utils/index';

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler
);

ChartJS.defaults.font.family = 'Inter, system-ui, sans-serif';
ChartJS.defaults.font.size = 11;
ChartJS.defaults.plugins.legend.labels.usePointStyle = true;
ChartJS.defaults.plugins.legend.labels.pointStyleWidth = 8;
ChartJS.defaults.plugins.legend.labels.boxHeight = 6;

const defaultBarOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#1e293b',
      titleFont: { size: 11, weight: '600' },
      bodyFont: { size: 10 },
      padding: 8,
      cornerRadius: 6,
      boxPadding: 4,
    },
  },
  scales: {
    x: {
      grid: { display: false },
      ticks: { font: { size: 10 }, maxRotation: 45 },
      border: { display: false },
    },
    y: {
      grid: { color: '#f1f5f9', drawBorder: false },
      ticks: { font: { size: 10 }, padding: 4 },
      border: { display: false },
    },
  },
};

const defaultLineOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'top', labels: { font: { size: 10 }, padding: 12 } },
    tooltip: {
      backgroundColor: '#1e293b',
      titleFont: { size: 11, weight: '600' },
      bodyFont: { size: 10 },
      padding: 8,
      cornerRadius: 6,
    },
  },
  scales: {
    x: { grid: { display: false }, ticks: { font: { size: 10 } }, border: { display: false } },
    y: { grid: { color: '#f1f5f9', drawBorder: false }, ticks: { font: { size: 10 }, padding: 4 }, border: { display: false } },
  },
  elements: { line: { tension: 0.35, borderWidth: 2 }, point: { radius: 2.5, hoverRadius: 5 } },
};

const defaultPieOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'right', labels: { padding: 10, font: { size: 10 }, usePointStyle: true, pointStyleWidth: 8 } },
    tooltip: {
      backgroundColor: '#1e293b',
      titleFont: { size: 11, weight: '600' },
      bodyFont: { size: 10 },
      padding: 8,
      cornerRadius: 6,
    },
  },
};

export function BarChart({ labels, datasets, title, height = 220, options = {}, stacked = false }) {
  const mergedOptions = {
    ...defaultBarOptions,
    ...options,
    ...(stacked && {
      scales: {
        ...defaultBarOptions.scales,
        x: { ...defaultBarOptions.scales.x, stacked: true },
        y: { ...defaultBarOptions.scales.y, stacked: true },
      },
    }),
    plugins: {
      ...defaultBarOptions.plugins,
      ...options.plugins,
      title: title ? { display: true, text: title, font: { size: 12, weight: '600' }, color: '#374151', padding: { bottom: 10 } } : undefined,
    },
  };

  const data = {
    labels,
    datasets: datasets.map((ds, i) => ({
      backgroundColor: ds.color || COLORS[i],
      borderRadius: 4,
      barThickness: labels && labels.length > 10 ? undefined : 'flex',
      maxBarThickness: 40,
      ...ds,
    })),
  };

  return (
    <div style={{ height }}>
      <Bar data={data} options={mergedOptions} />
    </div>
  );
}

export function LineChart({ labels, datasets, title, height = 220, options = {} }) {
  const mergedOptions = {
    ...defaultLineOptions,
    ...options,
    plugins: {
      ...defaultLineOptions.plugins,
      ...options.plugins,
      title: title ? { display: true, text: title, font: { size: 12, weight: '600' }, color: '#374151', padding: { bottom: 10 } } : undefined,
    },
  };

  const data = {
    labels,
    datasets: datasets.map((ds, i) => ({
      borderColor: ds.color || COLORS[i],
      backgroundColor: (ds.color || COLORS[i]) + '15',
      fill: ds.fill ?? false,
      ...ds,
    })),
  };

  return (
    <div style={{ height }}>
      <Line data={data} options={mergedOptions} />
    </div>
  );
}

export function PieChart({ labels, data: values, title, height = 220, options = {} }) {
  const mergedOptions = {
    ...defaultPieOptions,
    ...options,
    plugins: {
      ...defaultPieOptions.plugins,
      ...options.plugins,
      title: title ? { display: true, text: title, font: { size: 12, weight: '600' }, color: '#374151', padding: { bottom: 6 } } : undefined,
    },
  };

  const data = {
    labels,
    datasets: [
      {
        data: values,
        backgroundColor: COLORS.slice(0, labels.length),
        borderWidth: 2,
        borderColor: '#fff',
      },
    ],
  };

  return (
    <div style={{ height }}>
      <Pie data={data} options={mergedOptions} />
    </div>
  );
}

export function DoughnutChart({ labels, data: values, title, height = 220, options = {} }) {
  const mergedOptions = {
    ...defaultPieOptions,
    ...options,
    cutout: '65%',
    plugins: {
      ...defaultPieOptions.plugins,
      ...options.plugins,
      title: title ? { display: true, text: title, font: { size: 12, weight: '600' }, color: '#374151', padding: { bottom: 6 } } : undefined,
    },
  };

  const data = {
    labels,
    datasets: [
      {
        data: values,
        backgroundColor: COLORS.slice(0, labels.length),
        borderWidth: 2,
        borderColor: '#fff',
        spacing: 1,
      },
    ],
  };

  return (
    <div style={{ height }}>
      <Doughnut data={data} options={mergedOptions} />
    </div>
  );
}
