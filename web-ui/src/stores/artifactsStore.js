import { create } from 'zustand';

/**
 * Artifacts Store — tracks files written by agents via the filesystem tool.
 * Each file has a version history with content, timestamp, and source message ID.
 */
const useArtifactsStore = create((set, get) => ({
  // Map<filePath, { displayPath, versions: [{id, content, timestamp, messageId, action}] }>
  artifacts: new Map(),

  // UI state
  selectedFile: null,
  selectedVersion: null,
  panelOpen: false,
  searchFilter: '',
  previewMode: 'preview', // 'code' | 'preview'

  // Working directory for path normalization
  workingDirectory: '',

  setWorkingDirectory: (dir) => set({ workingDirectory: dir }),

  addArtifact: (filePath, content, messageId, action, timestamp) => {
    const { artifacts, workingDirectory } = get();
    const newMap = new Map(artifacts);

    // Normalize display path — strip working directory prefix
    let displayPath = filePath;
    if (workingDirectory) {
      const normalizedWd = workingDirectory.replace(/\\/g, '/').replace(/\/$/, '');
      const normalizedFp = filePath.replace(/\\/g, '/');
      if (normalizedFp.startsWith(normalizedWd + '/')) {
        displayPath = normalizedFp.slice(normalizedWd.length + 1);
      } else if (normalizedFp.startsWith(normalizedWd + '\\')) {
        displayPath = normalizedFp.slice(normalizedWd.length + 1);
      }
    }
    // Also normalize backslashes for display
    displayPath = displayPath.replace(/\\/g, '/');

    const existing = newMap.get(filePath);
    const version = {
      id: `v-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      content,
      timestamp: timestamp || new Date().toISOString(),
      messageId,
      action: action || 'write',
    };

    if (existing) {
      // Deduplicate: skip if content identical to latest version
      const latest = existing.versions[existing.versions.length - 1];
      if (latest && latest.content === content) return;

      existing.versions.push(version);
    } else {
      newMap.set(filePath, {
        displayPath,
        versions: [version],
      });
    }

    set({ artifacts: newMap });
  },

  selectFile: (filePath) => {
    const { artifacts } = get();
    const entry = artifacts.get(filePath);
    set({
      selectedFile: filePath,
      selectedVersion: entry ? entry.versions.length - 1 : 0, // default to latest
      previewMode: hasRenderablePreview(filePath) ? 'preview' : 'code',
    });
  },

  selectVersion: (index) => set({ selectedVersion: index }),

  togglePanel: () => {
    const { panelOpen } = get();
    set({ panelOpen: !panelOpen });
  },

  openPanel: () => set({ panelOpen: true }),

  closePanel: () => set({ panelOpen: false }),

  setSearchFilter: (query) => set({ searchFilter: query }),

  setPreviewMode: (mode) => set({ previewMode: mode }),

  clearArtifacts: () => set({
    artifacts: new Map(),
    selectedFile: null,
    selectedVersion: null,
    searchFilter: '',
  }),

  // Load artifacts from backend data (pushed via WebSocket or fetched via API)
  // Backend stores artifacts as plain object { [filePath]: { displayPath, versions } }
  loadFromBackend: (artifactsObj, workingDirectory) => {
    const { selectedFile, selectedVersion, searchFilter } = get();
    const newMap = new Map();
    if (artifactsObj && typeof artifactsObj === 'object') {
      for (const [filePath, entry] of Object.entries(artifactsObj)) {
        if (entry && entry.versions && entry.versions.length > 0) {
          newMap.set(filePath, {
            displayPath: entry.displayPath || filePath.replace(/\\/g, '/'),
            versions: entry.versions,
          });
        }
      }
    }

    // Preserve selection if the selected file still exists
    const preserveSelection = selectedFile && newMap.has(selectedFile);
    const newEntry = preserveSelection ? newMap.get(selectedFile) : null;

    set({
      artifacts: newMap,
      workingDirectory: workingDirectory || get().workingDirectory,
      // Keep selection if file still exists, auto-select latest version
      selectedFile: preserveSelection ? selectedFile : null,
      selectedVersion: preserveSelection ? newEntry.versions.length - 1 : null,
      searchFilter,
    });
  },

  // Fetch artifacts from the backend API (used on agent switch)
  fetchFromAPI: async (agentId) => {
    try {
      const response = await fetch(`/api/agents/${agentId}/artifacts`);
      if (!response.ok) return;
      const data = await response.json();
      if (data.success && data.artifacts) {
        get().loadFromBackend(data.artifacts, data.workingDirectory);
      }
    } catch (e) {
      console.warn('Failed to fetch artifacts from API:', e.message);
    }
  },

  // Get filtered + sorted artifact list
  getFilteredArtifacts: () => {
    const { artifacts, searchFilter } = get();
    const entries = Array.from(artifacts.entries());
    const filtered = searchFilter
      ? entries.filter(([, v]) => v.displayPath.toLowerCase().includes(searchFilter.toLowerCase()))
      : entries;
    // Sort by most recently modified (latest version timestamp)
    filtered.sort((a, b) => {
      const aTime = a[1].versions[a[1].versions.length - 1]?.timestamp || '';
      const bTime = b[1].versions[b[1].versions.length - 1]?.timestamp || '';
      return bTime.localeCompare(aTime);
    });
    return filtered;
  },
}));

/**
 * Extract filesystem write/append actions from a message's content string.
 * Parses ```json { "toolId": "filesystem", ... } ``` blocks.
 */
export function extractFilesystemWritesFromContent(content) {
  if (!content || typeof content !== 'string') return [];

  const results = [];
  const jsonPattern = /```json\s*(\{[\s\S]*?\})\s*```/g;
  let match;

  while ((match = jsonPattern.exec(content)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const toolId = (data.toolId || data.tool || '').toLowerCase();
      if (toolId !== 'filesystem') continue;

      // Handle actions array format
      if (data.actions && Array.isArray(data.actions)) {
        for (const action of data.actions) {
          const type = action.type || action.action;
          if (type === 'write' || type === 'append') {
            const filePath = action.filePath || action['file-path'];
            if (filePath && action.content) {
              results.push({ type, filePath, content: action.content });
            }
          }
        }
      }

      // Handle parameters format (single action)
      if (data.parameters) {
        const params = data.parameters;
        const type = params.type || params.action;
        if (type === 'write' || type === 'append') {
          const filePath = params.filePath || params['file-path'];
          if (filePath && params.content) {
            results.push({ type, filePath, content: params.content });
          }
        }
      }
    } catch {
      // Not valid JSON, skip
    }
  }

  return results;
}

// Helper: check if a file extension supports rendered preview
export function hasRenderablePreview(filePath) {
  if (!filePath) return false;
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ['html', 'htm', 'md', 'mdx', 'svg', 'json', 'css'].includes(ext);
}

// Helper: get file extension
export function getFileExtension(filePath) {
  if (!filePath) return '';
  const parts = filePath.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

// Helper: get file name from path
export function getFileName(filePath) {
  if (!filePath) return '';
  return filePath.replace(/\\/g, '/').split('/').pop() || filePath;
}

// Helper: relative time
export function timeAgo(timestamp) {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Register on window for cross-store access (avoids circular imports with appStore)
if (typeof window !== 'undefined') {
  window.__artifactsStore = useArtifactsStore;
}

export default useArtifactsStore;
