/**
 * Tests for the Quick Send thread store.
 *
 * Uses a real tmpdir so the atomic-write rename path exercises real
 * filesystem semantics. The store is deliberately decoupled from the
 * orchestrator, so these tests don't need any pool/scheduler mocks —
 * we hand-build a fake agent object that has the shape the store
 * touches (id, conversations.full.messages, metadata, status).
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

import {
  withAgentLock,
  waitForAgentIdle,
  ensureMigrated,
  mintThread,
  swapToThread,
  touchActiveThread,
  listThreads,
  readThreadMessages,
  loadIndex,
  threadsDir,
  threadFile,
  AgentBusyError,
  _resetLocksForTests,
  _internals
} from '../quickSendThreadStore.js';

function makeAgent({ id = 'agent-test', messages = [], status = 'active', metadata = {} } = {}) {
  return {
    id,
    status,
    metadata: { ...metadata },
    conversations: {
      full: {
        messages: [...messages],
        lastUpdated: new Date().toISOString()
      }
    }
  };
}

async function makeTmpStateDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'quicksend-thread-store-'));
}

describe('quickSendThreadStore', () => {
  let stateDir;

  beforeEach(async () => {
    stateDir = await makeTmpStateDir();
    _resetLocksForTests();
  });

  afterEach(async () => {
    await fs.rm(stateDir, { recursive: true, force: true });
  });

  // ── Migration ───────────────────────────────────────────────
  describe('ensureMigrated', () => {
    test('creates a legacy thread carrying existing conversation messages', async () => {
      const messages = [
        { role: 'user', content: 'hello', timestamp: '2025-01-01T00:00:00Z' },
        { role: 'assistant', content: 'hi back', timestamp: '2025-01-01T00:00:01Z' }
      ];
      const agent = makeAgent({ messages });

      const index = await ensureMigrated({ stateDir, agent });

      expect(index.threads).toHaveLength(1);
      const legacy = index.threads[0];
      expect(legacy.id).toMatch(/^th_legacy_/);
      expect(legacy.title).toBe('Earlier conversation');
      expect(legacy.messageCount).toBe(2);
      expect(index.activeThreadId).toBe(legacy.id);

      const onDisk = await readThreadMessages({ stateDir, agentId: agent.id, threadId: legacy.id });
      expect(onDisk).toEqual(messages);

      expect(agent.metadata.activeThreadId).toBe(legacy.id);
    });

    test('creates a "New thread" title when the agent has no prior messages', async () => {
      const agent = makeAgent({ messages: [] });
      const index = await ensureMigrated({ stateDir, agent });
      expect(index.threads[0].title).toBe('New thread');
      expect(index.threads[0].messageCount).toBe(0);
    });

    test('is idempotent — second call returns the same index without duplicating', async () => {
      const agent = makeAgent({ messages: [{ role: 'user', content: 'x' }] });
      const first = await ensureMigrated({ stateDir, agent });
      const firstId = first.activeThreadId;

      const second = await ensureMigrated({ stateDir, agent });
      expect(second.activeThreadId).toBe(firstId);
      expect(second.threads).toHaveLength(1);
    });

    test('writes index + thread file under the expected paths', async () => {
      const agent = makeAgent();
      const index = await ensureMigrated({ stateDir, agent });

      const dir = threadsDir(stateDir, agent.id);
      const dirStat = await fs.stat(dir);
      expect(dirStat.isDirectory()).toBe(true);

      const idx = await loadIndex({ stateDir, agentId: agent.id });
      expect(idx).toEqual(index);

      const tf = threadFile(stateDir, agent.id, index.activeThreadId);
      const fileStat = await fs.stat(tf);
      expect(fileStat.isFile()).toBe(true);
    });
  });

  // ── Mint ────────────────────────────────────────────────────
  describe('mintThread', () => {
    test('prepends a fresh empty thread without disturbing the active pointer', async () => {
      const agent = makeAgent({ messages: [{ role: 'user', content: 'a' }] });
      const index = await ensureMigrated({ stateDir, agent });
      const legacyId = index.activeThreadId;

      const minted = await mintThread({
        stateDir, agent, index,
        seed: { pageTitle: 'New York Times', sourceUrl: 'https://nytimes.com/x' }
      });

      expect(index.threads[0].id).toBe(minted.id);
      expect(index.threads[1].id).toBe(legacyId);
      // The mint does not change the active pointer; only swap does.
      expect(index.activeThreadId).toBe(legacyId);

      expect(minted.title).toBe('New York Times');
      expect(minted.sourceHost).toBe('nytimes.com');
      const fresh = await readThreadMessages({ stateDir, agentId: agent.id, threadId: minted.id });
      expect(fresh).toEqual([]);
    });

    test('falls back to hostname when page_title is empty', async () => {
      const agent = makeAgent();
      const index = await ensureMigrated({ stateDir, agent });
      const minted = await mintThread({
        stateDir, agent, index,
        seed: { sourceUrl: 'https://www.example.com/path' }
      });
      expect(minted.title).toBe('example.com');
    });

    test('prunes threads past RECENTS_CAP and deletes their sidecar files', async () => {
      const agent = makeAgent();
      const index = await ensureMigrated({ stateDir, agent });

      const minted = [];
      // RECENTS_CAP minus the existing legacy entry, plus 2 to force pruning.
      const overflow = _internals.RECENTS_CAP + 1;
      for (let i = 0; i < overflow; i++) {
        const entry = await mintThread({
          stateDir, agent, index,
          seed: { pageTitle: `Thread ${i}` }
        });
        minted.push(entry);
      }

      expect(index.threads).toHaveLength(_internals.RECENTS_CAP);
      // The legacy entry should be pruned (it was oldest).
      const ids = new Set(index.threads.map((t) => t.id));
      expect(ids.has(minted[0].id)).toBe(false); // first-minted is now at the bottom and pruned
      // Verify the pruned sidecar file is gone.
      try {
        await fs.access(threadFile(stateDir, agent.id, minted[0].id));
        throw new Error('pruned sidecar should not exist');
      } catch (err) {
        expect(err.code).toBe('ENOENT');
      }
    });
  });

  // ── Swap ────────────────────────────────────────────────────
  describe('swapToThread', () => {
    test('saves the current array to its sidecar and loads target into the same array reference', async () => {
      const agent = makeAgent({ messages: [{ role: 'user', content: 'original' }] });
      const index = await ensureMigrated({ stateDir, agent });
      const fromId = index.activeThreadId;
      const arrayRefBefore = agent.conversations.full.messages;

      const fresh = await mintThread({ stateDir, agent, index });
      await swapToThread({ stateDir, agent, index, targetId: fresh.id });

      // Active pointer flipped.
      expect(index.activeThreadId).toBe(fresh.id);
      expect(agent.metadata.activeThreadId).toBe(fresh.id);
      // In-memory array is now empty (target was empty) AND is the same reference.
      expect(agent.conversations.full.messages).toBe(arrayRefBefore);
      expect(agent.conversations.full.messages).toEqual([]);
      // Old thread's sidecar carries the original message.
      const oldOnDisk = await readThreadMessages({ stateDir, agentId: agent.id, threadId: fromId });
      expect(oldOnDisk).toEqual([{ role: 'user', content: 'original' }]);
    });

    test('round-trip: swap to new, mutate, swap back, content survives', async () => {
      const agent = makeAgent({ messages: [{ role: 'user', content: 'A1' }] });
      const index = await ensureMigrated({ stateDir, agent });
      const legacyId = index.activeThreadId;

      const fresh = await mintThread({ stateDir, agent, index });
      await swapToThread({ stateDir, agent, index, targetId: fresh.id });

      // Simulate the scheduler appending messages in the new thread.
      agent.conversations.full.messages.push({ role: 'user', content: 'B1' });
      agent.conversations.full.messages.push({ role: 'assistant', content: 'B2' });

      await swapToThread({ stateDir, agent, index, targetId: legacyId });
      expect(agent.conversations.full.messages).toEqual([{ role: 'user', content: 'A1' }]);

      await swapToThread({ stateDir, agent, index, targetId: fresh.id });
      expect(agent.conversations.full.messages).toEqual([
        { role: 'user', content: 'B1' },
        { role: 'assistant', content: 'B2' }
      ]);
    });

    test('is a no-op when target equals current active', async () => {
      const agent = makeAgent({ messages: [{ role: 'user', content: 'x' }] });
      const index = await ensureMigrated({ stateDir, agent });
      const beforeLastActivity = index.threads[0].lastActivity;
      await swapToThread({ stateDir, agent, index, targetId: index.activeThreadId });
      expect(index.threads[0].lastActivity).toBe(beforeLastActivity);
    });

    test('throws on an unknown target id', async () => {
      const agent = makeAgent();
      const index = await ensureMigrated({ stateDir, agent });
      await expect(
        swapToThread({ stateDir, agent, index, targetId: 'th_not_in_index' })
      ).rejects.toThrow(/Unknown thread id/);
    });
  });

  // ── Touch (bookkeeping) ─────────────────────────────────────
  describe('touchActiveThread', () => {
    test('updates lastActivity and reflects messageCount from the in-memory array', async () => {
      const agent = makeAgent({ messages: [{ role: 'user', content: 'a' }] });
      const index = await ensureMigrated({ stateDir, agent });
      const before = index.threads[0].lastActivity;

      // Wait so timestamps differ.
      await new Promise((r) => setTimeout(r, 10));
      agent.conversations.full.messages.push({ role: 'assistant', content: 'b' });
      await touchActiveThread({ stateDir, agent, index });

      expect(index.threads[0].messageCount).toBe(2);
      expect(new Date(index.threads[0].lastActivity).getTime())
        .toBeGreaterThan(new Date(before).getTime());
    });

    test('upgrades a placeholder "New thread" title from a real page title', async () => {
      const agent = makeAgent();
      const index = await ensureMigrated({ stateDir, agent });
      expect(index.threads[0].title).toBe('New thread');

      await touchActiveThread({
        stateDir, agent, index,
        seed: { pageTitle: 'A Real Page', sourceUrl: 'https://example.com/x' }
      });
      expect(index.threads[0].title).toBe('A Real Page');
      expect(index.threads[0].sourceHost).toBe('example.com');
    });

    test('does NOT overwrite an existing non-placeholder title', async () => {
      const agent = makeAgent({ messages: [{ role: 'user', content: 'a' }] });
      const index = await ensureMigrated({ stateDir, agent });
      expect(index.threads[0].title).toBe('Earlier conversation');

      await touchActiveThread({
        stateDir, agent, index,
        seed: { pageTitle: 'Some Other Title' }
      });
      expect(index.threads[0].title).toBe('Earlier conversation');
    });
  });

  // ── List ────────────────────────────────────────────────────
  describe('listThreads', () => {
    test('returns empty when nothing has been migrated yet', async () => {
      const result = await listThreads({ stateDir, agentId: 'nonexistent' });
      expect(result).toEqual({ activeThreadId: null, threads: [] });
    });

    test('returns threads sorted by lastActivity descending', async () => {
      const agent = makeAgent();
      const index = await ensureMigrated({ stateDir, agent });

      const a = await mintThread({ stateDir, agent, index, seed: { pageTitle: 'A' } });
      await new Promise((r) => setTimeout(r, 5));
      const b = await mintThread({ stateDir, agent, index, seed: { pageTitle: 'B' } });
      await new Promise((r) => setTimeout(r, 5));
      // Bump a's lastActivity by touching it as if it were active.
      index.activeThreadId = a.id;
      await touchActiveThread({ stateDir, agent, index });

      const result = await listThreads({ stateDir, agentId: agent.id });
      expect(result.threads[0].id).toBe(a.id); // freshest activity wins
      expect(result.threads[1].id).toBe(b.id);
    });
  });

  // ── readThreadMessages ──────────────────────────────────────
  describe('readThreadMessages', () => {
    test('returns null when the thread file does not exist', async () => {
      const result = await readThreadMessages({ stateDir, agentId: 'a', threadId: 'th_missing' });
      expect(result).toBeNull();
    });
  });

  // ── Mutex ───────────────────────────────────────────────────
  describe('withAgentLock', () => {
    test('serializes concurrent operations on the same agent id', async () => {
      const events = [];
      const slow = (label, ms) => async () => {
        events.push(`start:${label}`);
        await new Promise((r) => setTimeout(r, ms));
        events.push(`end:${label}`);
        return label;
      };

      const p1 = withAgentLock('agent-x', slow('A', 30));
      const p2 = withAgentLock('agent-x', slow('B', 10));
      const p3 = withAgentLock('agent-x', slow('C', 5));

      await Promise.all([p1, p2, p3]);

      // Strict ordering: A finishes before B starts, B finishes before C starts.
      expect(events).toEqual([
        'start:A', 'end:A',
        'start:B', 'end:B',
        'start:C', 'end:C'
      ]);
    });

    test('does NOT serialize across different agent ids', async () => {
      const events = [];
      const slow = (label, ms) => async () => {
        events.push(`start:${label}`);
        await new Promise((r) => setTimeout(r, ms));
        events.push(`end:${label}`);
      };

      await Promise.all([
        withAgentLock('agent-1', slow('1', 20)),
        withAgentLock('agent-2', slow('2', 5))
      ]);

      // agent-2 should finish first despite being scheduled second.
      const end1Idx = events.indexOf('end:1');
      const end2Idx = events.indexOf('end:2');
      expect(end2Idx).toBeLessThan(end1Idx);
    });

    test('releases the lock even when fn throws', async () => {
      await expect(
        withAgentLock('agent-y', async () => { throw new Error('boom'); })
      ).rejects.toThrow('boom');
      // A subsequent call must be able to acquire.
      const result = await withAgentLock('agent-y', async () => 'ok');
      expect(result).toBe('ok');
    });
  });

  // ── Idle gate ───────────────────────────────────────────────
  describe('waitForAgentIdle', () => {
    test('returns immediately when status is not busy', async () => {
      const agent = makeAgent({ status: 'active' });
      const start = Date.now();
      const result = await waitForAgentIdle({
        getAgent: async () => agent,
        agentId: agent.id,
        timeoutMs: 500
      });
      expect(result).toBe(agent);
      expect(Date.now() - start).toBeLessThan(200);
    });

    test('waits, then returns once the agent transitions out of busy', async () => {
      const agent = makeAgent({ status: 'busy' });
      // Flip to active after 80ms.
      setTimeout(() => { agent.status = 'active'; }, 80);

      const result = await waitForAgentIdle({
        getAgent: async () => agent,
        agentId: agent.id,
        timeoutMs: 1000,
        intervalMs: 20
      });
      expect(result.status).toBe('active');
    });

    test('throws AgentBusyError when the timeout fires before idle', async () => {
      const agent = makeAgent({ status: 'busy' });
      await expect(
        waitForAgentIdle({
          getAgent: async () => agent,
          agentId: agent.id,
          timeoutMs: 100,
          intervalMs: 20
        })
      ).rejects.toBeInstanceOf(AgentBusyError);
    });
  });
});
