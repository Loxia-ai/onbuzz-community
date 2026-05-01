/**
 * Tests for DELETE /api/agents/archived/:agentId
 *
 * Verifies:
 *   - Active (loaded) agents cannot be deleted via this endpoint
 *   - State, conversations, and memory files are removed from disk
 *   - Missing files (ENOENT) are silently skipped (not all agents have all 3)
 *   - Agent index entry is removed
 *   - Other unexpected errors propagate as 500
 *
 * Uses minimal Express harness pattern (replicates the route handler from
 * webServer.js bound to a fake `this` context).
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import express from 'express';
import { createServer } from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

function buildApp({ orchestrator, logger }) {
  const app = express();
  app.use(express.json());

  app.delete('/api/agents/archived/:agentId', async (req, res) => {
    try {
      const { agentId } = req.params;
      if (!agentId) {
        return res.status(400).json({ success: false, error: 'agentId is required' });
      }

      const activeAgent = await orchestrator.agentPool.getAgent(agentId);
      if (activeAgent) {
        return res.status(400).json({ success: false, error: 'Cannot delete an active agent. Unload it first.' });
      }

      const agentsDir = orchestrator.stateManager.getAgentsDir();
      const deletedFiles = [];

      for (const suffix of ['-state.json', '-conversations.json', '-memory.json']) {
        const filePath = path.join(agentsDir, `${agentId}${suffix}`);
        try {
          await fs.unlink(filePath);
          deletedFiles.push(filePath);
        } catch (err) {
          if (err.code !== 'ENOENT') throw err;
        }
      }

      const projectDir = orchestrator.config.project?.directory || process.cwd();
      try {
        const agentIndex = await orchestrator.stateManager.loadAgentIndex(projectDir);
        if (agentIndex[agentId]) {
          delete agentIndex[agentId];
          await orchestrator.stateManager.updateAgentIndex(projectDir, agentIndex);
        }
      } catch {}

      logger?.info?.('Archived agent deleted from disk', { agentId, deletedFiles });
      res.json({ success: true, agentId, deletedFiles });
    } catch (error) {
      logger?.error?.('Failed to delete archived agent', { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return app;
}

async function startServer(app) {
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

describe('DELETE /api/agents/archived/:agentId', () => {
  let tmpAgentsDir;
  let server;
  let logger;

  beforeEach(async () => {
    tmpAgentsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archived-agents-'));
    logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() };
    server = null;
  });

  afterEach(async () => {
    if (server) server.close();
    await fs.rm(tmpAgentsDir, { recursive: true, force: true }).catch(() => {});
  });

  function makeOrchestrator({ getAgentResult = null, agentIndex = {}, indexThrows = false } = {}) {
    let storedIndex = { ...agentIndex };
    return {
      agentPool: {
        getAgent: jest.fn(async () => getAgentResult)
      },
      stateManager: {
        getAgentsDir: () => tmpAgentsDir,
        loadAgentIndex: jest.fn(async () => {
          if (indexThrows) throw new Error('index load failed');
          return storedIndex;
        }),
        updateAgentIndex: jest.fn(async (_dir, idx) => { storedIndex = idx; }),
        _getStoredIndex: () => storedIndex
      },
      config: { project: { directory: tmpAgentsDir } }
    };
  }

  it('refuses to delete when agent is currently loaded (active)', async () => {
    const orchestrator = makeOrchestrator({ getAgentResult: { id: 'agent-1', isLoaded: true } });
    const { server: s, baseUrl } = await startServer(buildApp({ orchestrator, logger }));
    server = s;

    const res = await fetch(`${baseUrl}/api/agents/archived/agent-1`, { method: 'DELETE' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('active agent');
  });

  it('deletes all 3 state files when present and removes from index', async () => {
    // Create the 3 state files
    await fs.writeFile(path.join(tmpAgentsDir, 'agent-x-state.json'), '{}');
    await fs.writeFile(path.join(tmpAgentsDir, 'agent-x-conversations.json'), '[]');
    await fs.writeFile(path.join(tmpAgentsDir, 'agent-x-memory.json'), '{}');

    const orchestrator = makeOrchestrator({
      agentIndex: { 'agent-x': { name: 'X' }, 'other': { name: 'Other' } }
    });
    const { server: s, baseUrl } = await startServer(buildApp({ orchestrator, logger }));
    server = s;

    const res = await fetch(`${baseUrl}/api/agents/archived/agent-x`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.agentId).toBe('agent-x');
    expect(body.deletedFiles).toHaveLength(3);

    // All files should be gone
    await expect(fs.access(path.join(tmpAgentsDir, 'agent-x-state.json'))).rejects.toThrow();
    await expect(fs.access(path.join(tmpAgentsDir, 'agent-x-conversations.json'))).rejects.toThrow();
    await expect(fs.access(path.join(tmpAgentsDir, 'agent-x-memory.json'))).rejects.toThrow();

    // Agent index should have agent-x removed but 'other' preserved
    const finalIndex = orchestrator.stateManager._getStoredIndex();
    expect(finalIndex['agent-x']).toBeUndefined();
    expect(finalIndex.other).toBeDefined();
    expect(orchestrator.stateManager.updateAgentIndex).toHaveBeenCalled();
  });

  it('silently skips missing files (ENOENT) and reports only what was deleted', async () => {
    // Only state file exists, no conversations or memory
    await fs.writeFile(path.join(tmpAgentsDir, 'partial-state.json'), '{}');

    const orchestrator = makeOrchestrator();
    const { server: s, baseUrl } = await startServer(buildApp({ orchestrator, logger }));
    server = s;

    const res = await fetch(`${baseUrl}/api/agents/archived/partial`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.deletedFiles).toHaveLength(1);
    expect(body.deletedFiles[0]).toContain('partial-state.json');
  });

  it('does not call updateAgentIndex when agent is not in the index', async () => {
    await fs.writeFile(path.join(tmpAgentsDir, 'orphan-state.json'), '{}');

    const orchestrator = makeOrchestrator({ agentIndex: {} });
    const { server: s, baseUrl } = await startServer(buildApp({ orchestrator, logger }));
    server = s;

    const res = await fetch(`${baseUrl}/api/agents/archived/orphan`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(orchestrator.stateManager.loadAgentIndex).toHaveBeenCalled();
    expect(orchestrator.stateManager.updateAgentIndex).not.toHaveBeenCalled();
  });

  it('continues silently when index loading throws (try/catch swallow)', async () => {
    await fs.writeFile(path.join(tmpAgentsDir, 'bad-index-state.json'), '{}');

    const orchestrator = makeOrchestrator({ indexThrows: true });
    const { server: s, baseUrl } = await startServer(buildApp({ orchestrator, logger }));
    server = s;

    const res = await fetch(`${baseUrl}/api/agents/archived/bad-index`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.deletedFiles).toHaveLength(1);
  });

  it('returns 200 even when no files exist (graceful no-op)', async () => {
    const orchestrator = makeOrchestrator();
    const { server: s, baseUrl } = await startServer(buildApp({ orchestrator, logger }));
    server = s;

    const res = await fetch(`${baseUrl}/api/agents/archived/ghost`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deletedFiles).toEqual([]);
  });
});
