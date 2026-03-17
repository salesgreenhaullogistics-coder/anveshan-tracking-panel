import React, { useCallback, useState } from 'react';
import { Upload, FileSpreadsheet, X, Check } from 'lucide-react';
import { readExcelFile } from '../utils/index';

export default function FileUpload({ onDataLoaded, accept = '.xlsx,.xls,.csv', label = 'Upload File' }) {
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleFile = useCallback(
    async (file) => {
      if (!file) return;
      setLoading(true);
      setError('');
      setFileName(file.name);
      try {
        const data = await readExcelFile(file);
        onDataLoaded?.(data, file.name);
      } catch (err) {
        setError('Failed to read file: ' + err.message);
      } finally {
        setLoading(false);
      }
    },
    [onDataLoaded]
  );

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      handleFile(file);
    },
    [handleFile]
  );

  const onInputChange = useCallback(
    (e) => {
      const file = e.target.files[0];
      handleFile(file);
    },
    [handleFile]
  );

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
        dragging ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      <Upload className="w-8 h-8 text-gray-400 mx-auto mb-3" />
      <p className="text-sm text-gray-600 mb-1">{label}</p>
      <p className="text-xs text-gray-400 mb-4">Drag & drop or click to browse</p>
      <label className="btn-primary cursor-pointer inline-flex items-center gap-2">
        <FileSpreadsheet className="w-4 h-4" />
        Choose File
        <input type="file" accept={accept} onChange={onInputChange} className="hidden" />
      </label>
      {fileName && (
        <div className="mt-3 flex items-center justify-center gap-2 text-sm">
          {loading ? (
            <span className="text-gray-500">Processing...</span>
          ) : error ? (
            <span className="text-red-500 flex items-center gap-1">
              <X className="w-4 h-4" /> {error}
            </span>
          ) : (
            <span className="text-green-600 flex items-center gap-1">
              <Check className="w-4 h-4" /> {fileName}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
