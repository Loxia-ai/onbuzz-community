/**
 * Contract test for the AGENT-mode TaskManager instruction that
 * agentScheduler injects into every system prompt on an agent-mode turn.
 *
 * The instruction and the tool's getDescription() (see
 * tools/__tests__/taskManagerTool.lifecycleGuidance.test.js) must agree
 * on the lifecycle — if they drift, the agent gets conflicting guidance
 * and reverts to whichever one the model's attention happens to anchor
 * on, which in practice is the older, shorter one. Both tripwires
 * together lock the contract end-to-end.
 *
 * The assertions are keyword-level and case-insensitive so wording can
 * evolve without breaking the test — but the underlying concepts
 * (sync-first, in_progress → completed, jobdone at the end) must stay
 * named.
 */

import { jest, describe, test, expect } from '@jest/globals';

// Read the scheduler source file directly and grep for the instruction
// string. Importing the class would drag the whole compaction / AI /
// websocket stack along for a plain-text check, which is wasteful.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEDULER_SRC = readFileSync(
  join(__dirname, '../agentScheduler.js'),
  'utf-8'
);

describe('agentScheduler AGENT-mode TaskManager instruction — lifecycle contract', () => {
  // Locate the instruction literal. It starts with "IMPORTANT: You are in
  // AGENT mode" and is followed by the lifecycle guidance block.
  const startIdx = SCHEDULER_SRC.indexOf('IMPORTANT: You are in AGENT mode');
  const endIdx = SCHEDULER_SRC.indexOf('enhancedSystemPrompt = (agent.systemPrompt',
    startIdx + 1);
  const instruction = SCHEDULER_SRC.slice(startIdx, endIdx);

  const has = (needle) => expect(instruction).toMatch(new RegExp(needle, 'i'));

  test('the instruction block was located in the source', () => {
    expect(startIdx).toBeGreaterThan(-1);
    expect(instruction.length).toBeGreaterThan(100);
  });

  test('names TASK LIFECYCLE up front', () => {
    has('TASK LIFECYCLE');
  });

  test('first call must be sync, not per-task create', () => {
    has('FIRST TaskManager call must be');
    has('sync');
    has("Don't `create` tasks one at a time");
  });

  test('per-step pattern: in_progress → do work → completed', () => {
    has('in_progress');
    has('completed');
    has('one at a time');
  });

  test('mid-flight refinement allowed via create or sync', () => {
    has('`create`');
    has('`sync`');
    has("Don't `sync` every turn");
  });

  test('jobdone is the terminal action', () => {
    has('jobdone');
  });

  test('preserves the agent-mode behavioral constraints (no thank-yous, etc.)', () => {
    has("no thank-you");
    has('no self-commentary');
  });
});
