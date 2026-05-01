import React, { useState, useRef } from 'react';
import {
  XMarkIcon,
  DocumentTextIcon,
  PhotoIcon,
  DocumentIcon,
  CloudArrowUpIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import FileExplorerModal from '../modules/fileExplorer/index.js';

/**
 * FileSelectionDialog Component
 * Modal for uploading files with mode selection (content vs reference)
 */
function FileSelectionDialog({ isOpen, onClose, agentId, onSuccess }) {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [mode, setMode] = useState('content'); // 'content' or 'reference'
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [showFileExplorer, setShowFileExplorer] = useState(false);
  const fileInputRef = useRef(null);

  if (!isOpen) return null;

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      setSelectedFiles(prev => [...prev, ...files]);
    }
    // Reset input so same file can be selected again
    e.target.value = '';
  };

  const removeFile = (index) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleBrowseClick = () => {
    fileInputRef.current?.click();
  };

  const handleServerBrowseClick = () => {
    setShowFileExplorer(true);
  };

  const handleFileExplorerSelect = (path, item) => {
    // Create a pseudo-file object for server files
    const pseudoFile = {
      name: item.name,
      path: path,
      size: item.size || 0,
      isServerFile: true
    };
    setSelectedFiles(prev => [...prev, pseudoFile]);
    setShowFileExplorer(false);
  };

  const uploadSingleFile = async (file) => {
    let filePath;
    let fileName = file.name;

    // For server files (from FileExplorer), use the path directly
    if (file.isServerFile) {
      filePath = file.path;
    } else {
      // For local files, we need to handle them differently
      if (file.path) {
        filePath = file.path;
      } else if (file.webkitRelativePath) {
        filePath = file.webkitRelativePath;
      } else {
        // Fallback: use a temporary path indicator
        filePath = `/tmp/${file.name}`;

        // For content mode, we need to upload the actual file content
        if (mode === 'content') {
          const fileContent = await readFileAsText(file);
          const tempResponse = await fetch(`${window.location.origin}/api/files/upload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileName: file.name,
              content: fileContent,
              projectDir: '/tmp/loxia-uploads'
            })
          });

          if (!tempResponse.ok) {
            throw new Error('Failed to upload file content');
          }

          const tempData = await tempResponse.json();
          filePath = tempData.path || `/tmp/loxia-uploads/${file.name}`;
        } else {
          throw new Error('Reference mode requires selecting a file from the server');
        }
      }
    }

    // Upload file attachment
    const response = await fetch(`${window.location.origin}/api/agents/${agentId}/attachments/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath, mode, fileName })
    });

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || 'Failed to upload file');
    }
    return data;
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) {
      toast.error('Please select at least one file');
      return;
    }

    if (!agentId) {
      toast.error('No agent selected');
      return;
    }

    setUploading(true);
    setUploadProgress({ current: 0, total: selectedFiles.length });

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      setUploadProgress({ current: i + 1, total: selectedFiles.length });

      try {
        await uploadSingleFile(file);
        successCount++;
      } catch (error) {
        console.error(`Upload error for ${file.name}:`, error);
        failCount++;
        toast.error(`Failed to upload ${file.name}: ${error.message}`);
      }
    }

    setUploading(false);
    setUploadProgress({ current: 0, total: 0 });

    if (successCount > 0) {
      toast.success(`${successCount} file${successCount > 1 ? 's' : ''} uploaded successfully!`);
      onSuccess?.();
    }

    if (failCount === 0) {
      handleClose();
    }
  };

  const readFileAsText = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  };

  const handleClose = () => {
    if (!uploading) {
      setSelectedFiles([]);
      setMode('content');
      setUploadProgress({ current: 0, total: 0 });
      onClose();
    }
  };

  const getFileIcon = (file) => {
    if (!file) return DocumentIcon;
    const name = file.name.toLowerCase();
    if (name.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/)) return PhotoIcon;
    if (name.match(/\.(txt|md|json|js|jsx|ts|tsx|py|java|c|cpp|h|css|html)$/)) return DocumentTextIcon;
    return DocumentIcon;
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Math.round(bytes / Math.pow(k, i) * 100) / 100} ${sizes[i]}`;
  };

  // Check for files that are too large
  const hasFileTooLarge = selectedFiles.some(f => f.size > 10 * 1024 * 1024);
  const hasLargeFiles = selectedFiles.some(f => f.size > 1024 * 1024 && f.size <= 10 * 1024 * 1024);
  const totalSize = selectedFiles.reduce((sum, f) => sum + (f.size || 0), 0);

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Upload File Attachments
            </h2>
            <button
              onClick={handleClose}
              disabled={uploading}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="p-4 space-y-4 overflow-y-auto flex-1">
            {/* File Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Select Files {selectedFiles.length > 0 && `(${selectedFiles.length} selected)`}
              </label>

              {/* Drop zone / Add more files */}
              <div className="space-y-2">
                <button
                  onClick={handleBrowseClick}
                  disabled={uploading}
                  className="w-full flex items-center justify-center px-4 py-6 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-loxia-500 dark:hover:border-loxia-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <div className="text-center">
                    <CloudArrowUpIcon className="w-10 h-10 mx-auto text-gray-400 mb-2" />
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {selectedFiles.length === 0 ? 'Click to select files' : 'Click to add more files'}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                      Max 10MB per file
                    </p>
                  </div>
                </button>

                <button
                  onClick={handleServerBrowseClick}
                  disabled={uploading}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-sm text-gray-700 dark:text-gray-300 transition-colors"
                >
                  Or browse server files
                </button>
              </div>

              {/* Selected files list */}
              {selectedFiles.length > 0 && (
                <div className="mt-3 space-y-2 max-h-48 overflow-y-auto">
                  {selectedFiles.map((file, index) => {
                    const FileIcon = getFileIcon(file);
                    const isTooLarge = file.size > 10 * 1024 * 1024;
                    return (
                      <div
                        key={`${file.name}-${index}`}
                        className={`flex items-center space-x-3 p-2 rounded-lg border ${
                          isTooLarge
                            ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                            : 'bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        <FileIcon className={`w-6 h-6 flex-shrink-0 ${isTooLarge ? 'text-red-500' : 'text-loxia-600 dark:text-loxia-400'}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                            {file.name}
                          </p>
                          <p className={`text-xs ${isTooLarge ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
                            {formatFileSize(file.size)} {isTooLarge && '(too large)'}
                          </p>
                        </div>
                        <button
                          onClick={() => removeFile(index)}
                          disabled={uploading}
                          className="text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors p-1"
                        >
                          <XMarkIcon className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Total size indicator */}
              {selectedFiles.length > 1 && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  Total: {formatFileSize(totalSize)}
                </p>
              )}

              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>

            {/* Mode Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Upload Mode
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setMode('content')}
                  disabled={uploading}
                  className={`px-4 py-3 rounded-lg border-2 transition-all ${
                    mode === 'content'
                      ? 'border-loxia-500 bg-loxia-50 dark:bg-loxia-900/20 text-loxia-700 dark:text-loxia-300'
                      : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500 text-gray-700 dark:text-gray-300'
                  }`}
                >
                  <div className="text-sm font-medium">📝 Content</div>
                  <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    Full file injected
                  </div>
                </button>
                <button
                  onClick={() => setMode('reference')}
                  disabled={uploading}
                  className={`px-4 py-3 rounded-lg border-2 transition-all ${
                    mode === 'reference'
                      ? 'border-loxia-500 bg-loxia-50 dark:bg-loxia-900/20 text-loxia-700 dark:text-loxia-300'
                      : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500 text-gray-700 dark:text-gray-300'
                  }`}
                >
                  <div className="text-sm font-medium">📎 Reference</div>
                  <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    Path only
                  </div>
                </button>
              </div>
            </div>

            {/* Warnings */}
            {hasFileTooLarge && (
              <div className="flex items-start space-x-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <ExclamationTriangleIcon className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-red-700 dark:text-red-300">
                  <p className="font-medium">Some files are too large</p>
                  <p className="text-xs mt-1">Files over 10MB will be skipped. Remove them or use reference mode.</p>
                </div>
              </div>
            )}

            {hasLargeFiles && !hasFileTooLarge && mode === 'content' && (
              <div className="flex items-start space-x-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                <ExclamationTriangleIcon className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-yellow-700 dark:text-yellow-300">
                  <p className="font-medium">Large files warning</p>
                  <p className="text-xs mt-1">Some files will consume significant tokens. Consider using reference mode for large files.</p>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between p-4 border-t border-gray-200 dark:border-gray-700">
            {/* Upload progress */}
            {uploading && uploadProgress.total > 0 && (
              <div className="text-sm text-gray-600 dark:text-gray-400">
                Uploading {uploadProgress.current} of {uploadProgress.total}...
              </div>
            )}
            {!uploading && <div />}

            <div className="flex items-center space-x-3">
              <button
                onClick={handleClose}
                disabled={uploading}
                className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleUpload}
                disabled={selectedFiles.length === 0 || uploading}
                className="px-4 py-2 text-sm bg-loxia-600 text-white rounded-lg hover:bg-loxia-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
              >
                {uploading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    <span>Uploading...</span>
                  </>
                ) : (
                  <>
                    <CloudArrowUpIcon className="w-4 h-4" />
                    <span>Upload {selectedFiles.length > 1 ? `(${selectedFiles.length})` : ''}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* File Explorer Modal */}
      <FileExplorerModal
        isOpen={showFileExplorer}
        onClose={() => setShowFileExplorer(false)}
        onSelectPath={handleFileExplorerSelect}
        title="Select File from Server"
        directoriesOnly={false}
        allowMultiSelect={false}
      />
    </>
  );
}

export default FileSelectionDialog;
