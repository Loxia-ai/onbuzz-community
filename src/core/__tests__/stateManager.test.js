/**
 * StateManager - Comprehensive unit tests (target: 80%+ line coverage)
 * Tests directory initialization, state persistence, project state management,
 * agent index operations, resume/restore flows, and error handling.
 */
import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger, createMockConfig } from '../../__test-utils__/mockFactories.js';

// ── Mock fs ──────────────────────────────────────────────────────────────────
const mockMkdir = jest.fn().mockResolvedValue(undefined);
const mockReadFile = jest.fn().mockResolvedValue('{}');
const mockWriteFile = jest.fn().mockResolvedValue(undefined);
const mockUnlink = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('fs', () => ({
  promises: {
    mkdir: mockMkdir,
    readFile: mockReadFile,
    writeFile: mockWriteFile,
    unlink: mockUnlink
  }
}));

// ── Mock userDataDir ─────────────────────────────────────────────────────────
const mockGetUserDataPaths = jest.fn().mockReturnValue({
  base: '/mock/userdata',
  state: '/mock/userdata/state',
  agents: '/mock/userdata/state/agents',
  logs: '/mock/userdata/logs'
});
const mockEnsureUserDataDirs = jest.fn().mockResolvedValue({
  base: '/mock/userdata',
  state: '/mock/userdata/state',
  agents: '/mock/userdata/state/agents'
});

jest.unstable_mockModule('../../utilities/userDataDir.js', () => ({
  getUserDataPaths: mockGetUserDataPaths,
  ensureUserDataDirs: mockEnsureUserDataDirs
}));

const { default: StateManager } = await import('../stateManager.js');

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeSM(configOverrides = {}) {
  const config = createMockConfig(configOverrides);
  const logger = createMockLogger();
  const sm = new StateManager(config, logger);
  return { sm, config, logger };
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe('StateManager', () => {
  let sm, logger;

  beforeEach(() => {
    jest.clearAllMocks();
    ({ sm, logger } = makeSM());
  });

  // ─── Constructor ───────────────────────────────────────────────────────
  describe('constructor', () => {
    test('sets stateDirectory from userDataPaths', () => {
      expect(sm.stateDirectory).toBe('/mock/userdata/state');
    });

    test('sets state file paths', () => {
      expect(sm.stateFiles.projectState).toBe('project-state.json');
      expect(sm.stateFiles.agentIndex).toBe('agent-index.json');
    });

    test('sets stateVersion', () => {
      expect(sm.stateVersion).toBe('1.0.0');
    });
  });

  // ─── getStateDir / getAgentsDir ────────────────────────────────────────
  describe('getStateDir', () => {
    test('returns persistent state directory (ignores projectDir)', () => {
      expect(sm.getStateDir('/some/project')).toBe('/mock/userdata/state');
    });
  });

  describe('getAgentsDir', () => {
    test('returns agents directory', () => {
      expect(sm.getAgentsDir()).toBe('/mock/userdata/state/agents');
    });
  });

  // ─── initializeStateDirectory ──────────────────────────────────────────
  describe('initializeStateDirectory', () => {
    test('calls ensureUserDataDirs', async () => {
      await sm.initializeStateDirectory('/project');
      expect(mockEnsureUserDataDirs).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalled();
    });

    test('throws and logs error when ensureUserDataDirs fails', async () => {
      mockEnsureUserDataDirs.mockRejectedValueOnce(new Error('disk full'));
      await expect(sm.initializeStateDirectory('/project')).rejects.toThrow('disk full');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  // ─── loadProjectState ──────────────────────────────────────────────────
  describe('loadProjectState', () => {
    test('loads and returns project state from JSON file', async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify({ version: '1.0.0', projectDir: '/p' }));
      const state = await sm.loadProjectState('/project');
      expect(state.version).toBe('1.0.0');
    });

    test('creates default state when file does not exist', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));
      const state = await sm.loadProjectState('/project');
      expect(state.version).toBe('1.0.0');
      expect(state.activeAgents).toEqual([]);
      // Should have saved the default state
      expect(mockWriteFile).toHaveBeenCalled();
    });
  });

  // ─── saveProjectState ──────────────────────────────────────────────────
  describe('saveProjectState', () => {
    test('writes project state JSON to disk', async () => {
      await sm.saveProjectState('/project', { foo: 'bar' });
      expect(mockMkdir).toHaveBeenCalled();
      expect(mockWriteFile).toHaveBeenCalled();
      const writtenData = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(writtenData.foo).toBe('bar');
      expect(writtenData.lastModified).toBeDefined();
    });
  });

  // ─── getProjectState ──────────────────────────────────────────────────
  describe('getProjectState', () => {
    test('delegates to loadProjectState', async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify({ version: '1.0.0' }));
      const state = await sm.getProjectState('/project');
      expect(state.version).toBe('1.0.0');
    });
  });

  // ─── loadAgentIndex ────────────────────────────────────────────────────
  describe('loadAgentIndex', () => {
    test('returns parsed agent index', async () => {
      const index = { 'agent-1': { name: 'Agent1' } };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(index));
      const result = await sm.loadAgentIndex('/project');
      expect(result['agent-1'].name).toBe('Agent1');
    });

    test('returns empty object when file missing', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));
      const result = await sm.loadAgentIndex('/project');
      expect(result).toEqual({});
    });
  });

  // ─── updateAgentIndex ──────────────────────────────────────────────────
  describe('updateAgentIndex', () => {
    test('adds agent info to index and saves', async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify({}));
      const agent = {
        id: 'agent-test',
        name: 'Test',
        type: 'user-created',
        lastActivity: new Date().toISOString(),
        currentModel: 'model-x',
        status: 'active',
        capabilities: ['terminal']
      };
      await sm.updateAgentIndex(agent, '/project');
      expect(mockWriteFile).toHaveBeenCalled();
      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(written['agent-test'].name).toBe('Test');
      expect(written['agent-test'].stateFile).toContain('agent-test');
    });

    test('creates new index when loadJSON fails', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));
      const agent = { id: 'a1', name: 'A', type: 'system', lastActivity: '', currentModel: 'm', status: 'active', capabilities: [] };
      await sm.updateAgentIndex(agent, '/project');
      expect(mockWriteFile).toHaveBeenCalled();
    });
  });

  // ─── persistAgentState ─────────────────────────────────────────────────
  describe('persistAgentState', () => {
    test('saves agent state and conversations as separate files', async () => {
      // First call: updateAgentIndex -> loadJSON for index
      mockReadFile.mockResolvedValueOnce(JSON.stringify({}));

      const agent = {
        id: 'agent-persist',
        name: 'PersistAgent',
        type: 'user-created',
        conversations: {
          full: { messages: [{ role: 'user', content: 'hi' }] }
        },
        lastActivity: new Date().toISOString(),
        currentModel: 'model-x',
        status: 'active',
        capabilities: []
      };

      await sm.persistAgentState(agent);

      // Should have written state file and conversations file and index
      expect(mockWriteFile).toHaveBeenCalledTimes(3); // state, conversations, index
      const stateCall = mockWriteFile.mock.calls[0];
      expect(stateCall[0]).toContain('agent-persist-state.json');
      const convCall = mockWriteFile.mock.calls[1];
      expect(convCall[0]).toContain('agent-persist-conversations.json');
    });

    test('throws on write failure', async () => {
      mockWriteFile.mockRejectedValueOnce(new Error('write fail'));
      const agent = { id: 'fail', conversations: { full: {} }, name: 'F', type: 't', lastActivity: '', currentModel: 'm', status: 'a', capabilities: [] };
      await expect(sm.persistAgentState(agent)).rejects.toThrow('write fail');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  // ─── deleteAgentState ──────────────────────────────────────────────────
  describe('deleteAgentState', () => {
    test('unlinks state and conversations files', async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify({ 'agent-del': { name: 'Del' } }));
      await sm.deleteAgentState('agent-del');
      expect(mockUnlink).toHaveBeenCalledTimes(2);
    });

    test('handles ENOENT gracefully (files already missing)', async () => {
      const enoent = new Error('ENOENT');
      enoent.code = 'ENOENT';
      mockUnlink.mockRejectedValueOnce(enoent);
      mockUnlink.mockRejectedValueOnce(enoent);
      // removeFromAgentIndex calls loadJSON
      mockReadFile.mockResolvedValueOnce(JSON.stringify({}));
      await sm.deleteAgentState('agent-missing');
      // Should not throw
    });
  });

  // ─── resumeProject ────────────────────────────────────────────────────
  describe('resumeProject', () => {
    test('loads project state, agent index, and restores agents', async () => {
      // Setup mock responses in order:
      // 1. initializeStateDirectory -> ensureUserDataDirs (already mocked)
      // 2. loadProjectState -> loadJSON
      mockReadFile.mockResolvedValueOnce(JSON.stringify({ version: '1.0.0' }));
      // 3. loadAgentIndex -> loadJSON
      mockReadFile.mockResolvedValueOnce(JSON.stringify({}));
      // 4. restoreAsyncOperations -> loadJSON
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));
      // 5. restorePausedAgents -> loadJSON
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));
      // 6. restoreContextReferences -> loadJSON
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));
      // 7. saveLastSession -> saveJSON -> writeFile
      // (writeFile is already mocked)

      const result = await sm.resumeProject('/project');
      expect(result.resumedSuccessfully).toBe(true);
      expect(result.agents).toEqual([]);
      expect(result.asyncOperations).toEqual([]);
    });

    test('returns error state on failure', async () => {
      mockEnsureUserDataDirs.mockRejectedValueOnce(new Error('init fail'));
      const result = await sm.resumeProject('/project');
      expect(result.resumedSuccessfully).toBe(false);
      expect(result.error).toContain('init fail');
    });
  });

  // ─── saveJSON / loadJSON ───────────────────────────────────────────────
  describe('saveJSON (private)', () => {
    test('creates directory and writes JSON', async () => {
      await sm.saveJSON('/path/to/file.json', { key: 'value' });
      expect(mockMkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/path/to/file.json',
        expect.any(String),
        'utf8'
      );
    });
  });

  describe('loadJSON (private)', () => {
    test('reads and parses JSON', async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify({ x: 1 }));
      const result = await sm.loadJSON('/path/to/file.json');
      expect(result.x).toBe(1);
    });

    test('throws on corrupt JSON', async () => {
      mockReadFile.mockResolvedValueOnce('not-json{{{');
      await expect(sm.loadJSON('/bad.json')).rejects.toThrow();
    });

    test('throws on missing file', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));
      await expect(sm.loadJSON('/missing.json')).rejects.toThrow('ENOENT');
    });
  });

  // ─── restoreAsyncOperations ────────────────────────────────────────────
  describe('restoreAsyncOperations', () => {
    test('returns operations from stored data', async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify({ operations: [{ id: 'op1' }] }));
      const ops = await sm.restoreAsyncOperations('/project');
      expect(ops).toEqual([{ id: 'op1' }]);
    });

    test('returns empty array on missing file', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));
      const ops = await sm.restoreAsyncOperations('/project');
      expect(ops).toEqual([]);
    });
  });

  // ─── restorePausedAgents ───────────────────────────────────────────────
  describe('restorePausedAgents', () => {
    test('returns paused agents data and resumes expired', async () => {
      const past = new Date(Date.now() - 10000).toISOString();
      mockReadFile.mockResolvedValueOnce(JSON.stringify({
        pausedAgents: {
          'agent-1': { pausedAt: past, pausedUntil: past, reason: 'test' }
        }
      }));
      const result = await sm.restorePausedAgents('/project');
      // Expired agent should be moved to history
      expect(result.pausedAgents['agent-1']).toBeUndefined();
      expect(result.pauseHistory).toHaveLength(1);
    });

    test('returns defaults on missing file', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));
      const result = await sm.restorePausedAgents('/project');
      expect(result.pausedAgents).toEqual({});
      expect(result.pauseHistory).toEqual([]);
    });
  });

  // ─── restoreContextReferences ──────────────────────────────────────────
  describe('restoreContextReferences', () => {
    test('validates and returns references', async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify({
        references: [{ id: 'ref1', type: 'file' }]
      }));
      const result = await sm.restoreContextReferences('/project');
      expect(result.references).toHaveLength(1);
      expect(result.references[0].isValid).toBe(true);
    });

    test('returns defaults on missing file', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));
      const result = await sm.restoreContextReferences('/project');
      expect(result.references).toEqual([]);
    });
  });

  // ─── saveLastSession / loadLastSession ─────────────────────────────────
  describe('saveLastSession', () => {
    test('writes session data with savedAt timestamp', async () => {
      await sm.saveLastSession('/project', { agentCount: 2 });
      expect(mockWriteFile).toHaveBeenCalled();
      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(written.agentCount).toBe(2);
      expect(written.savedAt).toBeDefined();
      expect(written.projectDir).toBe('/project');
    });
  });

  // ─── createFlow edge-id stamping (renders arrows for templates) ────────
  describe('createFlow edge-id stamping', () => {
    test('stamps a stable id on every edge that arrives without one', async () => {
      // Templates + marketplace-installed flows arrive WITHOUT edge ids.
      // ReactFlow silently drops edges missing `id`, so the canvas
      // showed nodes-without-arrows for every freshly-loaded template
      // until this stamp ran.
      mockReadFile.mockResolvedValueOnce('{}');     // empty flow index
      const flowData = {
        name: 'arrow-test',
        nodes: [
          { id: 'a', type: 'agent', position: { x: 0, y: 0 } },
          { id: 'b', type: 'agent', position: { x: 200, y: 0 } },
        ],
        edges: [
          { source: 'a', sourceField: 'topic', target: 'b', targetField: 'topic' },
          { source: 'a', sourceField: 'extra', target: 'b', targetField: 'extra' },
        ],
      };
      const created = await sm.createFlow(flowData, '/proj');
      // Every edge now has an id.
      expect(created.edges).toHaveLength(2);
      expect(created.edges.every(e => typeof e.id === 'string' && e.id.length > 0)).toBe(true);
      // Ids reflect source/target/fields so they're stable across saves.
      expect(created.edges[0].id).toMatch(/^e-a:topic-b:topic-/);
      expect(created.edges[1].id).toMatch(/^e-a:extra-b:extra-/);
    });

    test('preserves existing edge ids — does NOT clobber them', async () => {
      mockReadFile.mockResolvedValueOnce('{}');
      const flowData = {
        name: 'preserve-test',
        nodes: [],
        edges: [
          { id: 'user-supplied-id', source: 'a', target: 'b' },
        ],
      };
      const created = await sm.createFlow(flowData, '/proj');
      expect(created.edges[0].id).toBe('user-supplied-id');
    });

    test('handles edges without sourceField/targetField (untyped flows)', async () => {
      mockReadFile.mockResolvedValueOnce('{}');
      const flowData = {
        name: 'untyped',
        nodes: [],
        edges: [{ source: 'a', target: 'b' }],
      };
      const created = await sm.createFlow(flowData, '/proj');
      expect(created.edges[0].id).toMatch(/^e-a-b-/);
    });

    test('persists createdBy when provided (used by platformcontrol create-flow)', async () => {
      mockReadFile.mockResolvedValueOnce('{}');
      const flow = await sm.createFlow({
        name: 'authored', nodes: [], edges: [], createdBy: 'agent-x'
      }, '/proj');
      expect(flow.createdBy).toBe('agent-x');
    });

    test('omits createdBy when not provided (UI-created flows stay minimal)', async () => {
      mockReadFile.mockResolvedValueOnce('{}');
      const flow = await sm.createFlow({ name: 'plain', nodes: [], edges: [] }, '/proj');
      expect(flow).not.toHaveProperty('createdBy');
    });
  });

  // ─── loadJSONResilient — corrupt file recovery ─────────────────────────
  describe('loadJSONResilient', () => {
    test('happy path: parses clean JSON without recovery', async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify({ ok: true }));
      const result = await sm.loadJSONResilient('/file.json', { fallback: true });
      expect(result.data).toEqual({ ok: true });
      expect(result.recovery).toBeNull();
      // Default not written when parse succeeds
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    test('missing file (ENOENT): recreates with default + reports not-found', async () => {
      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      mockReadFile.mockRejectedValueOnce(enoent);
      const result = await sm.loadJSONResilient('/file.json', { fresh: true });
      expect(result.data).toEqual({ fresh: true });
      expect(result.recovery.kind).toBe('not-found');
      expect(result.recovery.message).toMatch(/missing/i);
      expect(mockWriteFile).toHaveBeenCalled(); // default persisted
    });

    test('empty file: recreates with default + reports empty-recreated', async () => {
      mockReadFile.mockResolvedValueOnce('');
      const result = await sm.loadJSONResilient('/file.json', { skeleton: 1 });
      expect(result.data).toEqual({ skeleton: 1 });
      expect(result.recovery.kind).toBe('empty-recreated');
      expect(mockWriteFile).toHaveBeenCalled();
    });

    test('whitespace-only file: treated as empty', async () => {
      mockReadFile.mockResolvedValueOnce('   \n\n\t  ');
      const result = await sm.loadJSONResilient('/file.json', () => ({ defaulted: true }));
      expect(result.data).toEqual({ defaulted: true });
      expect(result.recovery.kind).toBe('empty-recreated');
    });

    test('trailing comma: auto-repaired in place', async () => {
      // Trailing comma before close brace — common hand-edit mistake.
      mockReadFile.mockResolvedValueOnce('{"a": 1, "b": [1, 2,],}');
      const result = await sm.loadJSONResilient('/file.json', null);
      expect(result.data).toEqual({ a: 1, b: [1, 2] });
      expect(result.recovery.kind).toBe('repaired');
      expect(mockWriteFile).toHaveBeenCalled(); // canonicalized form persisted
    });

    test('BOM-prefixed JSON: auto-repaired', async () => {
      const bom = String.fromCharCode(0xFEFF);
      mockReadFile.mockResolvedValueOnce(bom + '{"x": 7}');
      const result = await sm.loadJSONResilient('/file.json', null);
      expect(result.data).toEqual({ x: 7 });
      expect(result.recovery.kind).toBe('repaired');
    });

    test('partial JSON with junk after: salvages first balanced block', async () => {
      // Valid JSON followed by half a write (interrupted-flush scenario)
      mockReadFile.mockResolvedValueOnce('{"valid": true, "deep": {"nested": 1}}{"another": "broken');
      const result = await sm.loadJSONResilient('/file.json', { fallback: true });
      // The "junk after the JSON" repair path catches this — reports either
      // 'repaired' (cut) or 'partial' (salvaged), depending on which branch
      // matches first. Either is acceptable; data must be the valid prefix.
      expect(result.data).toEqual({ valid: true, deep: { nested: 1 } });
      expect(['repaired', 'partial']).toContain(result.recovery.kind);
    });

    test('completely unrepairable: returns default + archives original', async () => {
      mockReadFile.mockResolvedValueOnce('this is not json at all, no braces here');
      const result = await sm.loadJSONResilient('/file.json', { recovered: 'default' });
      expect(result.data).toEqual({ recovered: 'default' });
      expect(result.recovery.kind).toBe('unrepairable');
      expect(result.recovery.archivePath).toMatch(/\.corrupt-\d+\.json$/);
      // Two writes: archive + default replacement
      expect(mockWriteFile.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    test('persistRecreated=false: does not write default to disk', async () => {
      mockReadFile.mockResolvedValueOnce('');
      const result = await sm.loadJSONResilient(
        '/file.json',
        { skeleton: 1 },
        { persistRecreated: false }
      );
      expect(result.data).toEqual({ skeleton: 1 });
      expect(result.recovery.kind).toBe('empty-recreated');
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    test('non-ENOENT read error: bubbles up unchanged', async () => {
      mockReadFile.mockRejectedValueOnce(Object.assign(new Error('EACCES'), { code: 'EACCES' }));
      await expect(sm.loadJSONResilient('/file.json', {})).rejects.toThrow('EACCES');
    });

    test('control characters (NUL/0x08/0x1f) are stripped during repair', async () => {
      // Editor crash + partial write can leave random control chars
      // sprinkled through an otherwise valid JSON. The repair pass should
      // strip them and return clean data.
      const dirty = '{"a":  1, "b": [1,2]}';
      mockReadFile.mockResolvedValueOnce(dirty);
      const result = await sm.loadJSONResilient('/file.json', null);
      expect(result.data).toEqual({ a: 1, b: [1, 2] });
      expect(result.recovery.kind).toBe('repaired');
    });

    test('defaultValue as a function is invoked per-call with the file path', async () => {
      // Lazy default lets callers build expensive skeletons only when
      // needed (avoiding allocation on every happy-path load).
      const factory = jest.fn((p) => ({ created: 'lazy', path: p }));
      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      mockReadFile.mockRejectedValueOnce(enoent);
      const result = await sm.loadJSONResilient('/lazy/path.json', factory);
      expect(factory).toHaveBeenCalledTimes(1);
      expect(factory).toHaveBeenCalledWith('/lazy/path.json');
      expect(result.data).toEqual({ created: 'lazy', path: '/lazy/path.json' });
    });

    test('happy path: defaultValue function NOT invoked when file parses cleanly', async () => {
      // Avoid wasted allocation when the loader doesn't need the default.
      const factory = jest.fn(() => ({ never: 'used' }));
      mockReadFile.mockResolvedValueOnce('{"clean": true}');
      const result = await sm.loadJSONResilient('/file.json', factory);
      expect(factory).not.toHaveBeenCalled();
      expect(result.data).toEqual({ clean: true });
    });
  });

  // ─── _extractFirstJsonBlock — balanced-brace walker ─────────────────────
  describe('_extractFirstJsonBlock', () => {
    test('returns null for empty / no opening brace', () => {
      expect(sm._extractFirstJsonBlock('')).toBeNull();
      expect(sm._extractFirstJsonBlock('no braces here')).toBeNull();
      expect(sm._extractFirstJsonBlock(null)).toBeNull();
      expect(sm._extractFirstJsonBlock(undefined)).toBeNull();
    });

    test('extracts a simple balanced object', () => {
      expect(sm._extractFirstJsonBlock('{"a":1}')).toBe('{"a":1}');
    });

    test('skips leading prose / log noise before the first {', () => {
      const buf = '[2026-04-30] some log line\n{"agent":"a5"}\ntrailing junk';
      expect(sm._extractFirstJsonBlock(buf)).toBe('{"agent":"a5"}');
    });

    test('respects string literals — braces inside quotes do not affect depth', () => {
      const buf = '{"sql": "SELECT * WHERE x = \\"{open}\\""}';
      // The whole object is one balanced block; the inner braces are
      // inside a string and must NOT confuse the walker.
      expect(sm._extractFirstJsonBlock(buf)).toBe(buf);
    });

    test('handles escaped quotes in strings', () => {
      const buf = '{"msg":"say \\"hi\\""}';
      expect(sm._extractFirstJsonBlock(buf)).toBe(buf);
    });

    test('picks the FIRST balanced block when multiple are present', () => {
      const buf = '{"first":1}{"second":2}';
      expect(sm._extractFirstJsonBlock(buf)).toBe('{"first":1}');
    });

    test('returns null when braces never balance (truncated mid-object)', () => {
      const buf = '{"a": {"b": "incomplete';
      expect(sm._extractFirstJsonBlock(buf)).toBeNull();
    });

    test('handles deeply nested objects', () => {
      const buf = '{"l1":{"l2":{"l3":{"l4":{"l5":"deep"}}}}}';
      expect(sm._extractFirstJsonBlock(buf)).toBe(buf);
    });

    test('non-string input returns null (defensive)', () => {
      expect(sm._extractFirstJsonBlock(42)).toBeNull();
      expect(sm._extractFirstJsonBlock({})).toBeNull();
      expect(sm._extractFirstJsonBlock([])).toBeNull();
    });
  });

  // ─── restoreAgent — integration with the resilient loader ───────────────
  describe('restoreAgent (resilient state-file recovery)', () => {
    /**
     * Helper: arrange the two readFile calls restoreAgent makes (state
     * file + conversations file) plus the sub-call for checkAgentPauseStatus
     * (paused-agents file → ENOENT). Returns the agentInfo object that
     * matches what the agent index would have stored.
     */
    function arrangeRestore({ stateOutcome, conversationsOutcome }) {
      const enoent = (msg = 'ENOENT') => Object.assign(new Error(msg), { code: 'ENOENT' });
      // restoreAgent calls: readFile(stateFile), readFile(conversationsFile),
      // then checkAgentPauseStatus → readFile(pausedFile).
      const seq = [stateOutcome, conversationsOutcome, { reject: enoent('paused file missing') }];
      mockReadFile.mockReset();
      for (const o of seq) {
        if (o.reject) mockReadFile.mockRejectedValueOnce(o.reject);
        else          mockReadFile.mockResolvedValueOnce(o.resolve);
      }
      mockWriteFile.mockResolvedValue(undefined);
      return {
        agentId: 'agent-test-1',
        name: 'Test Agent',
        type: 'user-created',
        preferredModel: 'gpt-5',
        capabilities: ['filesystem'],
        stateFile: 'agents/agent-agent-test-1-state.json',
        conversationsFile: 'agents/agent-agent-test-1-conversations.json',
      };
    }

    test('happy path: clean files load with no recoveries attached', async () => {
      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      const stateJson = JSON.stringify({
        version: 2, agentId: 'agent-test-1',
        state: { id: 'agent-test-1', name: 'Test Agent', status: 'active', mode: 'chat' },
      });
      const convJson = JSON.stringify({
        version: 2, agentId: 'agent-test-1', conversations: { full: { messages: [] } },
      });
      const agentInfo = arrangeRestore({
        stateOutcome:         { resolve: stateJson },
        conversationsOutcome: { resolve: convJson },
      });
      const restored = await sm.restoreAgent('agent-test-1', agentInfo, '/proj');
      expect(restored.id).toBe('agent-test-1');
      expect(restored.name).toBe('Test Agent');
      // Recovery array exists but is empty.
      expect(restored._restoreRecoveries).toEqual([]);
    });

    test('missing state file: builds skeleton from agentInfo, attaches not-found recovery', async () => {
      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      const convJson = JSON.stringify({ version: 2, conversations: { full: { messages: [] } } });
      const agentInfo = arrangeRestore({
        stateOutcome:         { reject: enoent },
        conversationsOutcome: { resolve: convJson },
      });
      const restored = await sm.restoreAgent('agent-test-1', agentInfo, '/proj');
      // Skeleton derives identity from agentInfo, NOT from a missing file.
      expect(restored.id).toBe('agent-test-1');
      expect(restored.name).toBe('Test Agent');
      expect(restored.preferredModel).toBe('gpt-5');
      expect(restored.capabilities).toEqual(['filesystem']);
      expect(restored.taskList).toBeDefined();
      expect(restored.messageQueues).toBeDefined();
      // Recovery report flowed through.
      expect(restored._restoreRecoveries).toHaveLength(1);
      expect(restored._restoreRecoveries[0].kind).toBe('not-found');
      expect(restored._restoreRecoveries[0].label).toContain('agent state');
    });

    test('both state + conversations corrupt: produces 2 separate recovery reports', async () => {
      const agentInfo = arrangeRestore({
        // Empty file → empty-recreated
        stateOutcome:         { resolve: '' },
        // Garbage file → unrepairable
        conversationsOutcome: { resolve: 'not json at all, no braces' },
      });
      const restored = await sm.restoreAgent('agent-test-1', agentInfo, '/proj');
      expect(restored._restoreRecoveries).toHaveLength(2);
      const kinds = restored._restoreRecoveries.map(r => r.kind).sort();
      expect(kinds).toEqual(['empty-recreated', 'unrepairable']);
      // Labels distinguish which file was touched, so the toast is actionable.
      const labels = restored._restoreRecoveries.map(r => r.label);
      expect(labels.some(l => l.includes('agent state'))).toBe(true);
      expect(labels.some(l => l.includes('agent conversations'))).toBe(true);
    });

    test('partial salvage: recovery archives original + flags partial', async () => {
      // Valid prefix + corrupted tail (interrupted-flush style).
      const partialState = '{"version":2,"agentId":"agent-test-1","state":{"id":"agent-test-1","name":"Test Agent"}}{"truncated mid-object';
      const cleanConv = JSON.stringify({ version: 2, conversations: { full: { messages: [] } } });
      const agentInfo = arrangeRestore({
        stateOutcome:         { resolve: partialState },
        conversationsOutcome: { resolve: cleanConv },
      });
      const restored = await sm.restoreAgent('agent-test-1', agentInfo, '/proj');
      expect(restored.name).toBe('Test Agent');
      expect(restored._restoreRecoveries).toHaveLength(1);
      // 'repaired' (junk-after-JSON cut) and 'partial' (block salvage) are
      // both correct outcomes for this shape — accept either.
      expect(['repaired', 'partial']).toContain(restored._restoreRecoveries[0].kind);
    });
  });
});
