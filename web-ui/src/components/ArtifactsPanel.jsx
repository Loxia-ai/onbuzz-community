/**
 * ArtifactsPanel — Right-side collapsible panel showing all files
 * written by the agent, with version history and live preview.
 *
 * PERFORMANCE: Uses granular Zustand selectors, React.memo on heavy
 * components, and lazy-loads SyntaxHighlighter only when needed.
 */

import React, { useMemo, useCallback, useRef, memo, lazy, Suspense } from 'react';
import {
  XMarkIcon,
  MagnifyingGlassIcon,
  DocumentIcon,
  DocumentTextIcon,
  ClipboardDocumentIcon,
  CheckIcon,
  CodeBracketIcon,
  EyeIcon,
} from '@heroicons/react/24/outline';
import { ArchiveBoxIcon } from '@heroicons/react/24/solid';
import useArtifactsStore, {
  hasRenderablePreview,
  getFileExtension,
  getFileName,
  timeAgo,
} from '../stores/artifactsStore';
// widget-module: section + sheet rendering widget artifacts (versioned).
// Removing the widget module = delete this import + the two component
// references below in the JSX.
import WidgetArtifactsSection from '../modules/widget/WidgetArtifactsSection.jsx';
import WidgetSheet from '../modules/widget/WidgetSheet.jsx';

// ─── Lazy-load heavy syntax highlighter (only when preview opens) ───────────

const SyntaxHighlighter = lazy(() =>
  import('react-syntax-highlighter').then(mod => ({ default: mod.Prism }))
);
const getOneDark = () => import('react-syntax-highlighter/dist/esm/styles/prism').then(m => m.oneDark);
let _oneDarkCache = null;

function useSyntaxStyle() {
  const [style, setStyle] = React.useState(_oneDarkCache);
  React.useEffect(() => {
    if (!_oneDarkCache) {
      getOneDark().then(s => { _oneDarkCache = s; setStyle(s); });
    }
  }, []);
  return style;
}

// ─── Language map ───────────────────────────────────────────────────────────

const EXT_LANG = {
  js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx', mjs: 'javascript', cjs: 'javascript',
  html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
  json: 'json', xml: 'xml', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  py: 'python', java: 'java', c: 'c', cpp: 'cpp', h: 'c', cs: 'csharp',
  go: 'go', rs: 'rust', rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin',
  sh: 'bash', bash: 'bash', ps1: 'powershell', bat: 'batch',
  md: 'markdown', mdx: 'markdown', sql: 'sql', graphql: 'graphql',
  env: 'bash', gitignore: 'git', ini: 'ini', prisma: 'graphql',
};

function getLang(filePath) {
  return EXT_LANG[getFileExtension(filePath)] || 'text';
}

// ─── File type icon color ───────────────────────────────────────────────────

const FILE_COLORS = {
  js: 'text-yellow-500', jsx: 'text-cyan-500', ts: 'text-blue-500', tsx: 'text-blue-400',
  html: 'text-orange-500', htm: 'text-orange-500', css: 'text-purple-500', scss: 'text-pink-500',
  json: 'text-green-500', md: 'text-gray-400', py: 'text-green-400', prisma: 'text-indigo-400',
  sql: 'text-amber-500', svg: 'text-emerald-400', xml: 'text-orange-400',
  java: 'text-red-500', go: 'text-cyan-400', rs: 'text-orange-600', rb: 'text-red-400',
  cpp: 'text-blue-600', c: 'text-blue-500', h: 'text-blue-400',
};

function getFileColor(filePath) {
  return FILE_COLORS[getFileExtension(filePath)] || 'text-gray-400';
}

// ─── Copy button ────────────────────────────────────────────────────────────

const CopyButton = memo(function CopyButton({ text }) {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);

  return (
    <button onClick={handleCopy} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors" title="Copy to clipboard">
      {copied
        ? <CheckIcon className="w-3.5 h-3.5 text-green-500" />
        : <ClipboardDocumentIcon className="w-3.5 h-3.5 text-gray-400" />
      }
    </button>
  );
});

// ─── Code preview (memoized to avoid re-highlighting on unrelated changes) ──

const CodePreview = memo(function CodePreview({ content, language }) {
  const style = useSyntaxStyle();
  if (!style) return <div className="p-4 text-xs text-gray-400">Loading...</div>;

  return (
    <Suspense fallback={<div className="p-4 text-xs text-gray-400">Loading highlighter...</div>}>
      <SyntaxHighlighter
        language={language}
        style={style}
        showLineNumbers
        customStyle={{ margin: 0, borderRadius: 0, fontSize: '11px', lineHeight: '1.5', minHeight: '100%' }}
        lineNumberStyle={{ minWidth: '2.5em', paddingRight: '1em', color: '#636d83' }}
      >
        {content}
      </SyntaxHighlighter>
    </Suspense>
  );
});

// ─── Rendered preview (memoized) ────────────────────────────────────────────

const RenderedPreview = memo(function RenderedPreview({ content, filePath }) {
  const ext = getFileExtension(filePath);

  if (ext === 'html' || ext === 'htm') {
    return <iframe srcDoc={content} sandbox="allow-scripts" className="w-full h-64 bg-white rounded border border-gray-200 dark:border-gray-700" title="HTML Preview" />;
  }
  if (ext === 'md' || ext === 'mdx') {
    // Lazy-load ReactMarkdown only when needed
    const ReactMarkdown = lazy(() => import('react-markdown'));
    return (
      <Suspense fallback={<div className="p-4 text-xs text-gray-400">Loading...</div>}>
        <div className="prose prose-sm dark:prose-invert max-w-none p-3 overflow-auto max-h-[400px]">
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>
      </Suspense>
    );
  }
  if (ext === 'svg') {
    return <div className="flex items-center justify-center p-4 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 max-h-64 overflow-hidden" dangerouslySetInnerHTML={{ __html: content }} />;
  }
  if (ext === 'json') {
    let formatted = content;
    try { formatted = JSON.stringify(JSON.parse(content), null, 2); } catch { /* keep original */ }
    return <CodePreview content={formatted} language="json" />;
  }
  if (ext === 'css') {
    const sampleHtml = `<!DOCTYPE html><html><head><style>${content}</style></head><body><div style="padding:16px;font-family:system-ui"><h1>Heading 1</h1><h2>Heading 2</h2><p>Paragraph text with <a href="#">a link</a>.</p><button>Button</button> <input placeholder="Input"/><ul><li>List item 1</li><li>List item 2</li></ul></div></body></html>`;
    return <iframe srcDoc={sampleHtml} sandbox="" className="w-full h-48 bg-white rounded border border-gray-200 dark:border-gray-700" title="CSS Preview" />;
  }
  return null;
});

// ─── File list item (memoized — only re-renders when its own props change) ──

const FileItem = memo(function FileItem({ filePath, displayPath, versionCount, latestTime, isSelected, onSelect }) {
  return (
    <button
      onClick={() => onSelect(filePath)}
      className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors border-l-2 ${
        isSelected
          ? 'bg-loxia-50 dark:bg-loxia-900/20 border-loxia-500'
          : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-800/50'
      }`}
    >
      <DocumentIcon className={`w-4 h-4 flex-shrink-0 ${getFileColor(filePath)}`} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
          {getFileName(displayPath)}
        </div>
        <div className="text-xs text-gray-400 dark:text-gray-500 truncate">
          {displayPath.includes('/') ? displayPath.split('/').slice(0, -1).join('/') : ''}
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span className="text-xs text-gray-400 dark:text-gray-500">{timeAgo(latestTime)}</span>
        {versionCount > 1 && (
          <span className="px-1.5 py-0.5 text-[10px] font-medium bg-loxia-100 text-loxia-700 dark:bg-loxia-900/30 dark:text-loxia-300 rounded-full">
            v{versionCount}
          </span>
        )}
      </div>
    </button>
  );
});

// ─── Version selector pills ─────────────────────────────────────────────────

const VersionSelector = memo(function VersionSelector({ versions, selectedIndex, onSelect }) {
  if (versions.length <= 1) return null;
  return (
    <div className="flex items-center gap-1 px-3 py-1.5 overflow-x-auto border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
      <span className="text-[10px] text-gray-400 dark:text-gray-500 mr-1 flex-shrink-0">Versions:</span>
      {versions.map((v, i) => (
        <button
          key={v.id}
          onClick={() => onSelect(i)}
          className={`px-2 py-0.5 text-[11px] font-medium rounded-full transition-colors flex-shrink-0 ${
            i === selectedIndex
              ? 'bg-loxia-600 text-white'
              : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
          }`}
          title={`${v.action} — ${new Date(v.timestamp).toLocaleTimeString()}`}
        >
          v{i + 1}
        </button>
      ))}
    </div>
  );
});

// ─── Preview pane (isolated from file list re-renders) ──────────────────────

const PreviewPane = memo(function PreviewPane({ selectedFile, selectedEntry, selectedVersion, previewMode, setPreviewMode, selectVersion }) {
  const currentVersion = selectedEntry?.versions?.[selectedVersion] || null;
  const canRenderPreview = selectedFile && hasRenderablePreview(selectedFile);

  if (!selectedEntry || !currentVersion) return null;

  return (
    <div className="flex-1 flex flex-col min-h-0 border-t border-gray-200 dark:border-gray-700">
      <VersionSelector versions={selectedEntry.versions} selectedIndex={selectedVersion} onSelect={selectVersion} />

      {/* Preview toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPreviewMode('code')}
            className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
              previewMode === 'code' ? 'bg-gray-700 text-white dark:bg-gray-600' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <CodeBracketIcon className="w-3 h-3 inline mr-0.5" />Code
          </button>
          {canRenderPreview && (
            <button
              onClick={() => setPreviewMode('preview')}
              className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
                previewMode === 'preview' ? 'bg-loxia-600 text-white' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              <EyeIcon className="w-3 h-3 inline mr-0.5" />Preview
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-400">{currentVersion.action} &middot; {timeAgo(currentVersion.timestamp)}</span>
          <CopyButton text={currentVersion.content} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {previewMode === 'preview' && canRenderPreview ? (
          <RenderedPreview content={currentVersion.content} filePath={selectedFile} />
        ) : (
          <CodePreview content={currentVersion.content} language={getLang(selectedFile)} />
        )}
      </div>
    </div>
  );
});

// ─── Main Panel ─────────────────────────────────────────────────────────────

export default function ArtifactsPanel({ onClose }) {
  // Granular selectors — only re-render when specific slices change
  const artifacts = useArtifactsStore(s => s.artifacts);
  const selectedFile = useArtifactsStore(s => s.selectedFile);
  const selectedVersion = useArtifactsStore(s => s.selectedVersion);
  const searchFilter = useArtifactsStore(s => s.searchFilter);
  const previewMode = useArtifactsStore(s => s.previewMode);
  const selectFile = useArtifactsStore(s => s.selectFile);
  const selectVersion = useArtifactsStore(s => s.selectVersion);
  const setSearchFilter = useArtifactsStore(s => s.setSearchFilter);
  const setPreviewMode = useArtifactsStore(s => s.setPreviewMode);

  // Memoize filtered list
  const filteredEntries = useMemo(() => {
    const entries = Array.from(artifacts.entries());
    const filtered = searchFilter
      ? entries.filter(([, v]) => v.displayPath.toLowerCase().includes(searchFilter.toLowerCase()))
      : entries;
    filtered.sort((a, b) => {
      const aTime = a[1].versions[a[1].versions.length - 1]?.timestamp || '';
      const bTime = b[1].versions[b[1].versions.length - 1]?.timestamp || '';
      return bTime.localeCompare(aTime);
    });
    return filtered;
  }, [artifacts, searchFilter]);

  const selectedEntry = selectedFile ? artifacts.get(selectedFile) : null;

  return (
    <div className="flex flex-col h-full w-[380px] border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <div className="flex items-center gap-2">
          <ArchiveBoxIcon className="w-4 h-4 text-loxia-600 dark:text-loxia-400" />
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Artifacts</span>
          {artifacts.size > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full">
              {artifacts.size}
            </span>
          )}
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors" title="Close panel">
          <XMarkIcon className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      {/* ── Search ─────────────────────────────────────────────── */}
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        <div className="relative">
          <MagnifyingGlassIcon className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Filter files..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md text-gray-700 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-loxia-500 focus:border-loxia-500"
          />
        </div>
      </div>

      {/* ── Widgets section (versioned widget artifacts) ───────── */}
      {/* widget-module: removing the widget feature = delete this. */}
      <WidgetArtifactsSection />

      {/* ── File List ──────────────────────────────────────────── */}
      <div className="flex-shrink-0 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800"
           style={{ maxHeight: selectedFile ? '35%' : '100%' }}>
        {filteredEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 px-4">
            <DocumentTextIcon className="w-8 h-8 text-gray-300 dark:text-gray-600 mb-2" />
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center">
              {artifacts.size === 0 ? 'No artifacts yet. Files written by the agent will appear here.' : 'No files match your filter.'}
            </p>
          </div>
        ) : (
          filteredEntries.map(([filePath, entry]) => (
            <FileItem
              key={filePath}
              filePath={filePath}
              displayPath={entry.displayPath}
              versionCount={entry.versions.length}
              latestTime={entry.versions[entry.versions.length - 1]?.timestamp}
              isSelected={filePath === selectedFile}
              onSelect={selectFile}
            />
          ))
        )}
      </div>

      {/* ── Preview (isolated component) ───────────────────────── */}
      <PreviewPane
        selectedFile={selectedFile}
        selectedEntry={selectedEntry}
        selectedVersion={selectedVersion}
        previewMode={previewMode}
        setPreviewMode={setPreviewMode}
        selectVersion={selectVersion}
      />

      {/* widget-module: full-size widget viewer, portal'd. */}
      <WidgetSheet />
    </div>
  );
}
