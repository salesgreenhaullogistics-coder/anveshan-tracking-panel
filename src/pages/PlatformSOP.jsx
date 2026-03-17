import React, { useState } from 'react';
import { FileCheck, Upload, Download, Eye, Trash2, File } from 'lucide-react';
import KPICard from '../components/KPICard';

export default function PlatformSOP() {
  const [documents, setDocuments] = useState([
    { id: 1, name: 'Amazon SOP', type: 'Platform SOP', platform: 'Amazon', uploadDate: '2024-01-15', size: '2.4 MB' },
    { id: 2, name: 'Flipkart Agreement', type: 'Logistics Agreement', platform: 'Flipkart', uploadDate: '2024-02-10', size: '1.8 MB' },
    { id: 3, name: 'Myntra SOP', type: 'Platform SOP', platform: 'Myntra', uploadDate: '2024-03-05', size: '3.1 MB' },
  ]);
  const [filterPlatform, setFilterPlatform] = useState('');
  const [filterType, setFilterType] = useState('');

  const filtered = documents.filter((doc) => {
    if (filterPlatform && doc.platform !== filterPlatform) return false;
    if (filterType && doc.type !== filterType) return false;
    return true;
  });

  const platforms = [...new Set(documents.map((d) => d.platform))];
  const types = [...new Set(documents.map((d) => d.type))];

  const handleUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const newDoc = {
      id: Date.now(),
      name: file.name,
      type: 'Platform SOP',
      platform: 'Unassigned',
      uploadDate: new Date().toISOString().split('T')[0],
      size: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
      file,
    };
    setDocuments((prev) => [...prev, newDoc]);
  };

  const handleDelete = (id) => {
    setDocuments((prev) => prev.filter((d) => d.id !== id));
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KPICard title="Total Documents" value={documents.length} icon={FileCheck} color="blue" />
        <KPICard title="SOPs" value={documents.filter((d) => d.type === 'Platform SOP').length} icon={File} color="green" />
        <KPICard title="Agreements" value={documents.filter((d) => d.type === 'Logistics Agreement').length} icon={FileCheck} color="indigo" />
      </div>

      {/* Filters & Upload */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-center gap-3">
        <select
          value={filterPlatform}
          onChange={(e) => setFilterPlatform(e.target.value)}
          className="filter-select"
        >
          <option value="">All Platforms</option>
          {platforms.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="filter-select"
        >
          <option value="">All Types</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <label className="btn-primary cursor-pointer flex items-center gap-1.5 ml-auto">
          <Upload className="w-4 h-4" />
          Upload Document
          <input type="file" accept=".pdf,.doc,.docx" onChange={handleUpload} className="hidden" />
        </label>
      </div>

      {/* Document Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((doc) => (
          <div key={doc.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 hover:shadow-md transition-shadow">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-primary-50 rounded-lg">
                <File className="w-6 h-6 text-primary-600" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-gray-900 truncate">{doc.name}</h3>
                <p className="text-xs text-gray-500 mt-0.5">{doc.type}</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="badge badge-blue">{doc.platform}</span>
                  <span className="text-[10px] text-gray-400">{doc.size}</span>
                </div>
                <p className="text-[10px] text-gray-400 mt-1">Uploaded: {doc.uploadDate}</p>
              </div>
            </div>
            <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
              <button className="btn-secondary text-xs flex items-center gap-1 flex-1">
                <Eye className="w-3.5 h-3.5" /> View
              </button>
              <button className="btn-secondary text-xs flex items-center gap-1 flex-1">
                <Download className="w-3.5 h-3.5" /> Download
              </button>
              <button
                onClick={() => handleDelete(doc.id)}
                className="px-2 py-1 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <FileCheck className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No documents found</p>
        </div>
      )}
    </div>
  );
}
