import React, { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import {
  PaperClipIcon,
  XMarkIcon,
  EyeIcon,
  EyeSlashIcon,
  DocumentTextIcon,
  PhotoIcon,
  DocumentIcon,
  TrashIcon,
  ArrowDownTrayIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  PlusIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';

/**
 * FileAttachmentsPanel Component
 * Shows all file attachments for the current agent with toggle/delete controls
 */
const FileAttachmentsPanel = forwardRef(({ agentId, onUploadClick, compact = false, className = '' }, ref) => {
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(true); // Collapsed by default
  const [popoverOpen, setPopoverOpen] = useState(false); // For compact mode popover
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { fileId, fileName }
  const [deleting, setDeleting] = useState(false);

  // Expose refresh method to parent
  useImperativeHandle(ref, () => ({
    refresh: () => {
      if (agentId) {
        loadAttachments();
      }
    }
  }));

  // Load attachments when agent changes
  useEffect(() => {
    if (agentId) {
      loadAttachments();
    } else {
      setAttachments([]);
      setLoading(false);
    }
  }, [agentId]);

  const loadAttachments = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${window.location.origin}/api/agents/${agentId}/attachments`);
      const data = await response.json();

      if (data.success) {
        setAttachments(data.attachments || []);
      } else {
        console.error('Failed to load attachments:', data.error);
        toast.error('Failed to load attachments');
      }
    } catch (error) {
      console.error('Error loading attachments:', error);
      toast.error('Failed to load attachments');
    } finally {
      setLoading(false);
    }
  };

  const toggleActive = async (fileId) => {
    try {
      const response = await fetch(`/api/attachments/${fileId}/toggle`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.success) {
        // Update local state
        setAttachments(attachments.map(att =>
          att.fileId === fileId ? { ...att, active: data.attachment.active } : att
        ));
        toast.success(`Attachment ${data.attachment.active ? 'activated' : 'deactivated'}`);

        // Optionally refresh to ensure sync
        loadAttachments();
      } else {
        toast.error(`Failed to toggle attachment: ${data.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error toggling attachment:', error);
      toast.error(`Failed to toggle attachment: ${error.message}`);
    }
  };

  const handleDeleteClick = (fileId, fileName) => {
    setDeleteConfirm({ fileId, fileName });
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;

    setDeleting(true);
    const { fileId, fileName } = deleteConfirm;

    try {
      const response = await fetch(`/api/attachments/${fileId}?agentId=${agentId}`, {
        method: 'DELETE'
      });
      const data = await response.json();

      if (data.success) {
        // Remove from local state
        setAttachments(attachments.filter(att => att.fileId !== fileId));
        toast.success(data.physicallyDeleted ? 'Attachment deleted' : 'Reference removed');
        setDeleteConfirm(null);
      } else {
        toast.error('Failed to delete attachment');
      }
    } catch (error) {
      console.error('Error deleting attachment:', error);
      toast.error('Failed to delete attachment');
    } finally {
      setDeleting(false);
    }
  };

  const cancelDelete = () => {
    setDeleteConfirm(null);
  };

  const getFileIcon = (contentType) => {
    if (contentType === 'image') return PhotoIcon;
    if (contentType === 'text') return DocumentTextIcon;
    return DocumentIcon;
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Math.round(bytes / Math.pow(k, i) * 100) / 100} ${sizes[i]}`;
  };

  const getSizeBadgeColor = (bytes) => {
    if (bytes < 100 * 1024) return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300';
    if (bytes < 1024 * 1024) return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300';
    return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300';
  };

  const activeCount = attachments.filter(a => a.active).length;
  const totalTokens = attachments
    .filter(a => a.active)
    .reduce((sum, a) => sum + (a.tokenEstimate || 0), 0);

  if (!agentId) {
    return null;
  }

  // Compact mode — inline chip with upward popover
  if (compact) {
    if (attachments.length === 0) return null;
    return (
      <div className={`relative inline-flex ${className}`}>
        <button
          onClick={() => setPopoverOpen(!popoverOpen)}
          className="flex items-center gap-1.5 px-2 py-1 text-xs rounded-md bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors border border-gray-200 dark:border-gray-600"
          title="View attachments"
        >
          <PaperClipIcon className="w-3.5 h-3.5" />
          <span>{activeCount} file{activeCount !== 1 ? 's' : ''}</span>
          {totalTokens > 0 && <span className="text-gray-400">~{totalTokens.toLocaleString()}t</span>}
        </button>
        <button
          onClick={onUploadClick}
          className="ml-1 p-1 text-gray-400 hover:text-loxia-600 dark:hover:text-loxia-400 rounded transition-colors"
          title="Upload file"
        >
          <PlusIcon className="w-3.5 h-3.5" />
        </button>

        {/* Upward popover */}
        {popoverOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setPopoverOpen(false)} />
            <div className="absolute bottom-full left-0 z-40 mb-2 w-80 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 max-h-64 overflow-y-auto">
              <div className="p-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  Attachments ({attachments.length})
                </span>
                <button onClick={() => setPopoverOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                  <XMarkIcon className="w-3.5 h-3.5" />
                </button>
              </div>
              {attachments.map((attachment) => {
                const FileIcon = getFileIcon(attachment.contentType);
                return (
                  <div key={attachment.fileId} className={`flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 ${!attachment.active ? 'opacity-50' : ''}`}>
                    <FileIcon className="w-3.5 h-3.5 flex-shrink-0 text-gray-400" />
                    <span className="truncate flex-1 text-gray-700 dark:text-gray-300">{attachment.fileName}</span>
                    <span className={`px-1 py-0.5 rounded text-[10px] ${getSizeBadgeColor(attachment.size)}`}>{formatFileSize(attachment.size)}</span>
                    <button onClick={() => toggleActive(attachment.fileId)} className={`p-0.5 rounded ${attachment.active ? 'text-green-500' : 'text-gray-400'}`} title={attachment.active ? 'Deactivate' : 'Activate'}>
                      {attachment.active ? <EyeIcon className="w-3 h-3" /> : <EyeSlashIcon className="w-3 h-3" />}
                    </button>
                    <button onClick={() => handleDeleteClick(attachment.fileId, attachment.fileName)} className="p-0.5 rounded text-gray-400 hover:text-red-500" title="Delete">
                      <TrashIcon className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
              <div className="p-2 border-t border-gray-200 dark:border-gray-700 text-[10px] text-gray-400 flex justify-between">
                <span>Active: {activeCount}/{attachments.length}</span>
                {totalTokens > 0 && <span>~{totalTokens.toLocaleString()} tokens</span>}
              </div>
            </div>
          </>
        )}

        {/* Delete Confirmation (reuse existing modal) */}
        {deleteConfirm && (
          <>
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" onClick={cancelDelete} />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
                <div className="p-6">
                  <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">Delete <strong>"{deleteConfirm.fileName}"</strong>?</p>
                  <div className="flex justify-end gap-2">
                    <button onClick={cancelDelete} className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700" disabled={deleting}>Cancel</button>
                    <button onClick={confirmDelete} className="px-3 py-1.5 text-xs text-white bg-red-600 hover:bg-red-700 rounded disabled:opacity-50" disabled={deleting}>{deleting ? 'Deleting...' : 'Delete'}</button>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={`bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="flex items-center space-x-2 text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-loxia-600 dark:hover:text-loxia-400 transition-colors"
        >
          {isCollapsed ? (
            <ChevronDownIcon className="w-4 h-4" />
          ) : (
            <ChevronUpIcon className="w-4 h-4" />
          )}
          <PaperClipIcon className="w-4 h-4" />
          <span>Attachments ({attachments.length})</span>
        </button>

        <button
          onClick={onUploadClick}
          className="p-1 text-loxia-600 hover:text-loxia-700 dark:text-loxia-400 dark:hover:text-loxia-300 hover:bg-loxia-50 dark:hover:bg-loxia-900/20 rounded transition-colors"
          title="Upload file"
        >
          <PlusIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Collapsed view - show summary */}
      {isCollapsed && attachments.length > 0 && (
        <div className="p-3">
          <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
            <div>Active: {activeCount}/{attachments.length}</div>
            {totalTokens > 0 && (
              <div>Tokens: ~{totalTokens.toLocaleString()}</div>
            )}
          </div>
        </div>
      )}

      {/* Expanded view - show full list */}
      {!isCollapsed && (
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {loading ? (
            <div className="p-6 text-center text-gray-500 dark:text-gray-400">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-loxia-600 mx-auto"></div>
              <p className="mt-2 text-sm">Loading attachments...</p>
            </div>
          ) : attachments.length === 0 ? (
            <div className="p-6 text-center text-gray-500 dark:text-gray-400">
              <PaperClipIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No attachments yet</p>
              <button
                onClick={onUploadClick}
                className="mt-3 text-sm text-loxia-600 hover:text-loxia-700 dark:text-loxia-400 dark:hover:text-loxia-300 font-medium"
              >
                Upload your first file
              </button>
            </div>
          ) : (
            attachments.map((attachment) => {
              const FileIcon = getFileIcon(attachment.contentType);

              return (
                <div
                  key={attachment.fileId}
                  className={`p-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                    !attachment.active ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex items-start space-x-3">
                    {/* File Icon */}
                    <div className={`flex-shrink-0 mt-0.5 ${
                      attachment.active
                        ? 'text-loxia-600 dark:text-loxia-400'
                        : 'text-gray-400'
                    }`}>
                      <FileIcon className="w-5 h-5" />
                    </div>

                    {/* File Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                            {attachment.fileName}
                          </p>
                          <div className="flex items-center space-x-2 mt-1">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getSizeBadgeColor(attachment.size)}`}>
                              {formatFileSize(attachment.size)}
                            </span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {attachment.mode === 'content' ? '📝 Content' : '📎 Reference'}
                            </span>
                            {attachment.tokenEstimate > 0 && (
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                ~{attachment.tokenEstimate.toLocaleString()} tokens
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center space-x-1 ml-2">
                          {/* Toggle Active */}
                          <button
                            onClick={() => toggleActive(attachment.fileId)}
                            className={`p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors ${
                              attachment.active
                                ? 'text-green-600 dark:text-green-400'
                                : 'text-gray-400'
                            }`}
                            title={attachment.active ? 'Deactivate' : 'Activate'}
                          >
                            {attachment.active ? (
                              <EyeIcon className="w-4 h-4" />
                            ) : (
                              <EyeSlashIcon className="w-4 h-4" />
                            )}
                          </button>

                          {/* Delete */}
                          <button
                            onClick={() => handleDeleteClick(attachment.fileId, attachment.fileName)}
                            className="p-1 rounded text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                            title="Delete"
                          >
                            <TrashIcon className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Footer with stats */}
      {!isCollapsed && attachments.length > 0 && (
        <div className="p-3 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700 rounded-b-lg">
          <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
            <span>Active: {activeCount}/{attachments.length}</span>
            {totalTokens > 0 && (
              <span>Total tokens: ~{totalTokens.toLocaleString()}</span>
            )}
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
            onClick={cancelDelete}
          />

          {/* Modal */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <div className="flex items-center mb-4">
                  <div className="w-12 h-12 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center mr-4">
                    <ExclamationTriangleIcon className="w-6 h-6 text-red-600 dark:text-red-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                      Delete Attachment
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      This action cannot be undone
                    </p>
                  </div>
                </div>

                <p className="text-gray-700 dark:text-gray-300 mb-6">
                  Are you sure you want to delete <strong>"{deleteConfirm.fileName}"</strong>?
                  This will permanently remove the attachment.
                </p>

                <div className="flex justify-end space-x-3">
                  <button
                    onClick={cancelDelete}
                    className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                    disabled={deleting}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmDelete}
                    className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                    disabled={deleting}
                  >
                    {deleting ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                        Deleting...
                      </>
                    ) : (
                      <>
                        <TrashIcon className="w-4 h-4 mr-2" />
                        Delete
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
});

FileAttachmentsPanel.displayName = 'FileAttachmentsPanel';

export default FileAttachmentsPanel;
