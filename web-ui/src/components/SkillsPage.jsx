import React, { useState, useEffect, useMemo } from 'react';
import {
  PlusIcon,
  ArrowDownTrayIcon,
  PencilSquareIcon,
  TrashIcon,
  LightBulbIcon,
  MagnifyingGlassIcon,
  DocumentTextIcon,
  XMarkIcon,
  FolderOpenIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import { api } from '../services/api.js';
import LoadingSpinner from './LoadingSpinner.jsx';
import FileExplorerModal from '../modules/fileExplorer/index.js';
import toast from 'react-hot-toast';

// --- Skill Form Modal (Create / Edit) ---
function SkillFormModal({ isOpen, onClose, onSave, skill = null }) {
  const isEdit = !!skill;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen) {
      if (skill) {
        setName(skill.name);
        setDescription(skill.description || '');
        // Load full content for editing
        api.getSkill(skill.name).then(res => {
          if (res.success) setContent(res.skill.content);
        }).catch(() => {});
      } else {
        setName('');
        setDescription('');
        setContent('');
      }
      setError(null);
    }
  }, [isOpen, skill]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  // Live section extraction
  const sections = useMemo(() => {
    if (!content) return [];
    return content.split('\n')
      .filter(l => l.trim().startsWith('## '))
      .map(l => l.trim().replace(/^#+\s*/, ''));
  }, [content]);

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    if (!content.trim()) { setError('Content is required'); return; }

    setSaving(true);
    setError(null);
    try {
      let result;
      if (isEdit) {
        result = await api.updateSkill(name, content, [], description.trim());
      } else {
        result = await api.createSkill(name.trim(), content, [], description.trim());
      }
      if (result.success) {
        toast.success(isEdit ? `Updated "${name}"` : `Created "${name}"`);
        onSave(result.skill);
        onClose();
      } else {
        setError(result.error || 'Failed to save');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {isEdit ? 'Edit Skill' : 'New Skill'}
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={e => { setName(e.target.value); setError(null); }}
                disabled={isEdit || saving}
                placeholder="e.g. code-review"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-loxia-500 text-sm font-mono disabled:opacity-50"
              />
              <p className="text-xs text-gray-400 mt-1">Kebab-case: lowercase letters, numbers, hyphens</p>
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
              <input
                type="text"
                value={description}
                onChange={e => { setDescription(e.target.value); setError(null); }}
                disabled={saving}
                placeholder="Brief summary of what this skill teaches the agent"
                maxLength={200}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-loxia-500 text-sm"
              />
              <p className="text-xs text-gray-400 mt-1">Shown to agents when browsing available skills</p>
            </div>

            {/* Content */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Content (Markdown)</label>
              <textarea
                value={content}
                onChange={e => { setContent(e.target.value); setError(null); }}
                disabled={saving}
                rows={16}
                placeholder={"# My Skill\n\nDescription of what this skill does.\n\n## Section One\n\nInstructions...\n\n## Section Two\n\nMore instructions..."}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-loxia-500 text-sm font-mono resize-y min-h-[200px]"
              />
              <div className="flex justify-between mt-1">
                <div className="flex flex-wrap gap-1.5">
                  {sections.map((s, i) => (
                    <span key={i} className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-loxia-100 dark:bg-loxia-900/30 text-loxia-700 dark:text-loxia-300">
                      {s}
                    </span>
                  ))}
                </div>
                <span className="text-xs text-gray-400 whitespace-nowrap ml-2">
                  {content.split('\n').length} lines
                </span>
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-5 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
            <button onClick={onClose} className="button-secondary">Close</button>
            <button onClick={handleSubmit} disabled={saving} className="button-primary">
              {saving ? <LoadingSpinner size="sm" /> : isEdit ? 'Save Changes' : 'Create Skill'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// --- Import Modal ---
function SkillImportModal({ isOpen, onClose, onImport }) {
  const [source, setSource] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showFileExplorer, setShowFileExplorer] = useState(false);
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const dragCounter = React.useRef(0);

  useEffect(() => {
    if (isOpen) { setSource(''); setName(''); setDescription(''); setError(null); setPreview(null); setIsDragging(false); dragCounter.current = 0; }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  // Load preview when source changes
  const loadPreview = async (src) => {
    if (!src.trim()) { setPreview(null); return; }
    setLoadingPreview(true);
    setError(null);
    try {
      const result = await api.previewSkillSource(src.trim());
      if (result.success) {
        setPreview(result.preview);
        const meta = result.preview.extractedMeta || {};
        if (!name.trim()) setName(meta.name || result.preview.derivedName || '');
        if (!description.trim()) setDescription(meta.description || '');
      } else {
        setPreview(null);
        setError(result.error || 'Could not preview source');
      }
    } catch (err) {
      setPreview(null);
      setError(err.message);
    } finally {
      setLoadingPreview(false);
    }
  };

  const selectSource = (src) => {
    setSource(src);
    setError(null);
    loadPreview(src);
  };

  const handleImport = async () => {
    const src = source.trim();
    if (!src) { setError('Source path is required'); return; }
    if (!description.trim()) { setError('Description is required'); return; }
    setImporting(true);
    setError(null);
    try {
      const result = await api.importSkill(src, name.trim() || null, description.trim());
      if (result.success) {
        toast.success(`Imported "${result.skill.name}"`);
        onImport(result.skill);
        setSource(''); setName(''); setDescription(''); setPreview(null);
      } else {
        setError(result.error || 'Import failed');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  // Drag and drop handlers
  const handleDragEnter = (e) => { e.preventDefault(); e.stopPropagation(); dragCounter.current++; setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); dragCounter.current--; if (dragCounter.current === 0) setIsDragging(false); };
  const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); };
  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false); dragCounter.current = 0;
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      const file = files[0];
      const droppedPath = file.path || file.webkitRelativePath?.split('/')[0] || file.name;
      if (droppedPath) selectSource(droppedPath);
    }
  };

  const handleExplorerSelect = (selectedPath) => {
    setShowFileExplorer(false);
    selectSource(selectedPath);
  };

  if (!isOpen) return null;

  const canImport = source.trim() && description.trim() && !importing && !loadingPreview;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Import Skill</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Drop zone — only show when no source selected */}
            {!source && (
              <div
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl p-6 text-center transition-all duration-200 ${
                  isDragging
                    ? 'border-loxia-500 bg-loxia-50 dark:bg-loxia-900/20 scale-[1.02]'
                    : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                }`}
              >
                <FolderOpenIcon className={`w-10 h-10 mx-auto mb-3 transition-colors ${isDragging ? 'text-loxia-500' : 'text-gray-400'}`} />
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {isDragging ? 'Drop here to import' : 'Drag & drop a folder or file here'}
                </p>
                <p className="text-xs text-gray-400 mb-3">or</p>
                <button type="button" onClick={() => setShowFileExplorer(true)} className="button-secondary text-sm inline-flex items-center gap-1.5">
                  <FolderOpenIcon className="w-4 h-4" /> Browse Files
                </button>
                <details className="mt-3 text-sm">
                  <summary className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer select-none">
                    Or type a path manually
                  </summary>
                  <div className="flex gap-2 mt-2">
                    <input
                      type="text"
                      value={source}
                      onChange={e => setSource(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && source.trim()) loadPreview(source); }}
                      placeholder="/path/to/skill-directory-or-file"
                      className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-loxia-500 text-sm font-mono"
                    />
                    <button onClick={() => selectSource(source)} disabled={!source.trim()} className="button-primary text-sm">Load</button>
                  </div>
                </details>
              </div>
            )}

            {/* Loading preview */}
            {loadingPreview && (
              <div className="flex items-center justify-center py-6">
                <LoadingSpinner size="sm" />
                <span className="ml-2 text-sm text-gray-500">Loading preview...</span>
              </div>
            )}

            {/* Preview — shown after source is selected */}
            {source && preview && !loadingPreview && (
              <>
                {/* Source path */}
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                  <FolderOpenIcon className="w-4 h-4 text-loxia-500 flex-shrink-0" />
                  <span className="text-sm font-mono text-gray-700 dark:text-gray-300 truncate flex-1">{source}</span>
                  <button onClick={() => { setSource(''); setPreview(null); setName(''); setDescription(''); }} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
                    <XMarkIcon className="w-4 h-4" />
                  </button>
                </div>

                {/* File list */}
                {preview.files?.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                      Files ({preview.files.length})
                    </h4>
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800 max-h-28 overflow-y-auto">
                      {preview.files.map((f, i) => (
                        <div key={i} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                          {f.isDirectory
                            ? <FolderOpenIcon className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" />
                            : <DocumentTextIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                          }
                          <span className={`font-mono text-xs ${f.name === 'skill.md' ? 'text-loxia-600 dark:text-loxia-400 font-medium' : 'text-gray-600 dark:text-gray-400'}`}>
                            {f.name}
                          </span>
                        </div>
                      ))}
                    </div>
                    {!preview.hasSkillMd && preview.isDirectory && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                        No skill.md found in this directory. Import will fail.
                      </p>
                    )}
                  </div>
                )}

                {/* Content preview */}
                {preview.content && (
                  <div>
                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                      Content Preview
                    </h4>
                    <pre className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-3 text-xs font-mono text-gray-700 dark:text-gray-300 max-h-48 overflow-y-auto whitespace-pre-wrap">
                      {preview.content}
                    </pre>
                  </div>
                )}

                {/* Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Skill Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="auto-derived from path"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-loxia-500 text-sm font-mono"
                  />
                </div>

                {/* Description (required) */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Description <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={description}
                    onChange={e => { setDescription(e.target.value); setError(null); }}
                    placeholder="Brief summary of what this skill teaches the agent"
                    maxLength={200}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-loxia-500 text-sm"
                  />
                  <p className="text-xs text-gray-400 mt-1">Shown to agents when browsing available skills</p>
                </div>
              </>
            )}

            {error && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}
          </div>

          <div className="p-5 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
            <button onClick={onClose} className="button-secondary">Close</button>
            <button onClick={handleImport} disabled={!canImport} className="button-primary">
              {importing ? <LoadingSpinner size="sm" /> : 'Import'}
            </button>
          </div>
        </div>
      </div>

      <FileExplorerModal
        isOpen={showFileExplorer}
        onClose={() => setShowFileExplorer(false)}
        onSelectPath={handleExplorerSelect}
        title="Select Skill File or Directory"
        directoriesOnly={false}
        allowMultiSelect={false}
      />
    </>
  );
}

// --- Delete Confirm Modal ---
function DeleteConfirmModal({ isOpen, skillName, onConfirm, onCancel }) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" onClick={onCancel} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <ExclamationTriangleIcon className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Delete Skill</h3>
              <p className="text-sm text-gray-500">This action cannot be undone.</p>
            </div>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-5">
            Delete <strong className="text-gray-900 dark:text-gray-100">{skillName}</strong> and all its files?
          </p>
          <div className="flex justify-end gap-3">
            <button onClick={onCancel} className="button-secondary">Cancel</button>
            <button onClick={onConfirm} className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors">
              Delete
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// --- Skill Card ---
function SkillCard({ skill, onEdit, onDelete }) {
  const formatDate = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const diffH = Math.floor((now - d) / 3600000);
    if (diffH < 1) return 'just now';
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `${diffD}d ago`;
    return d.toLocaleDateString();
  };

  return (
    <div className="group/card relative bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 hover:border-loxia-400 dark:hover:border-loxia-600 hover:shadow-md transition-all overflow-hidden">
      {/* Content */}
      <div className="pr-2">
        <div className="flex items-center gap-2 mb-1.5">
          <DocumentTextIcon className="w-4 h-4 text-loxia-500 flex-shrink-0" />
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate">{skill.name}</h3>
        </div>

        {skill.description && (
          <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2 mb-2">{skill.description}</p>
        )}

        {/* Section chips */}
        {skill.sections?.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {skill.sections.map((s, i) => (
              <span key={i} className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                {s.replace(/^#+\s*/, '')}
              </span>
            ))}
          </div>
        )}

        {/* Meta */}
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span>{skill.lineCount} lines</span>
          {skill.fileCount > 1 && <span>{skill.fileCount} files</span>}
          <span>{formatDate(skill.updatedAt)}</span>
        </div>
      </div>

      {/* Hover actions — slide in from right */}
      <div className="absolute inset-y-0 right-0 flex items-center gap-1 px-3
        bg-gradient-to-l from-white dark:from-gray-800 via-white/90 dark:via-gray-800/90 to-transparent
        translate-x-full opacity-0 group-hover/card:translate-x-0 group-hover/card:opacity-100
        transition-all duration-200">
        <button
          onClick={() => onEdit(skill)}
          className="p-1.5 rounded-lg text-gray-500 hover:text-loxia-600 hover:bg-loxia-50 dark:hover:bg-loxia-900/20 transition-colors"
          title="Edit"
        >
          <PencilSquareIcon className="w-4 h-4" />
        </button>
        <button
          onClick={() => onDelete(skill)}
          className="p-1.5 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          title="Delete"
        >
          <TrashIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// --- Main Page ---
export default function SkillsPage() {
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Modal states
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingSkill, setEditingSkill] = useState(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [deletingSkill, setDeletingSkill] = useState(null);

  const fetchSkills = async () => {
    try {
      const result = await api.listSkills();
      if (result.success) setSkills(result.skills);
    } catch (err) {
      toast.error('Failed to load skills');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSkills(); }, []);

  const filteredSkills = useMemo(() => {
    if (!searchQuery.trim()) return skills;
    const q = searchQuery.toLowerCase();
    return skills.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.description?.toLowerCase().includes(q) ||
      s.sections?.some(sec => sec.toLowerCase().includes(q))
    );
  }, [skills, searchQuery]);

  const handleSave = (saved) => {
    setSkills(prev => {
      const idx = prev.findIndex(s => s.name === saved.name);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], ...saved };
        return updated;
      }
      return [saved, ...prev];
    });
  };

  const handleDelete = async () => {
    if (!deletingSkill) return;
    try {
      const result = await api.deleteSkill(deletingSkill.name);
      if (result.success) {
        setSkills(prev => prev.filter(s => s.name !== deletingSkill.name));
        toast.success(`Deleted "${deletingSkill.name}"`);
      }
    } catch (err) {
      toast.error(err.message);
    }
    setDeletingSkill(null);
  };

  const handleImport = (imported) => {
    setSkills(prev => [imported, ...prev]);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <LightBulbIcon className="w-6 h-6 text-loxia-500" />
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Skills Library</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">Reusable instruction sets for your agents</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowImportModal(true)} className="button-secondary text-sm flex items-center gap-1.5">
              <ArrowDownTrayIcon className="w-4 h-4" />
              Import
            </button>
            <button onClick={() => { setEditingSkill(null); setShowFormModal(true); }} className="button-primary text-sm flex items-center gap-1.5">
              <PlusIcon className="w-4 h-4" />
              New Skill
            </button>
          </div>
        </div>

        {/* Search */}
        {skills.length > 0 && (
          <div className="relative max-w-md">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search skills..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-loxia-500 text-sm"
            />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <LoadingSpinner />
            <span className="ml-3 text-gray-500">Loading skills...</span>
          </div>
        ) : skills.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-16 h-16 rounded-full bg-loxia-50 dark:bg-loxia-900/20 flex items-center justify-center mb-4">
              <LightBulbIcon className="w-8 h-8 text-loxia-400" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">No skills yet</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center max-w-sm mb-4">
              Create reusable instruction sets that your agents can reference during conversations.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setShowImportModal(true)} className="button-secondary text-sm flex items-center gap-1.5">
                <ArrowDownTrayIcon className="w-4 h-4" /> Import
              </button>
              <button onClick={() => { setEditingSkill(null); setShowFormModal(true); }} className="button-primary text-sm flex items-center gap-1.5">
                <PlusIcon className="w-4 h-4" /> Create First Skill
              </button>
            </div>
          </div>
        ) : filteredSkills.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <MagnifyingGlassIcon className="w-8 h-8 text-gray-400 mb-3" />
            <p className="text-gray-500">No skills match "{searchQuery}"</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredSkills.map(skill => (
              <SkillCard
                key={skill.name}
                skill={skill}
                onEdit={s => { setEditingSkill(s); setShowFormModal(true); }}
                onDelete={s => setDeletingSkill(s)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      <SkillFormModal
        isOpen={showFormModal}
        onClose={() => { setShowFormModal(false); setEditingSkill(null); }}
        onSave={handleSave}
        skill={editingSkill}
      />
      <SkillImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImport={handleImport}
      />
      <DeleteConfirmModal
        isOpen={!!deletingSkill}
        skillName={deletingSkill?.name}
        onConfirm={handleDelete}
        onCancel={() => setDeletingSkill(null)}
      />
    </div>
  );
}
