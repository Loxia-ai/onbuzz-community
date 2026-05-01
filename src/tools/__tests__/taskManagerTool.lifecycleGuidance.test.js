/**
 * Contract test for the TaskManager tool's lifecycle guidance surface.
 *
 * The agent follows the workflow described in the tool's `getDescription()`
 * output verbatim (it's part of the system prompt at every turn). If that
 * text accidentally regresses — a "simplification" PR that flattens the
 * four phases back into the old "list → work → complete" stub — the
 * agent immediately reverts to creating tasks one-at-a-time at the start,
 * burning tool calls and cluttering the transcript.
 *
 * These tests lock the lifecycle keywords into place. They're a tripwire,
 * not a style guide: the exact wording can evolve, but all four phases
 * must remain named, `sync` must be positioned as the first-call tool,
 * and the `in_progress` → `completed` per-step pattern must be present.
 *
 * If someone legitimately reworks the description (different phase names,
 * different order, etc.), they update this test AND confirm the agent
 * instruction in agentScheduler.js is in lockstep.
 */

import { describe, test, expect } from '@jest/globals';
import TaskManagerTool from '../taskManagerTool.js';

describe('TaskManagerTool.getDescription — lifecycle guidance contract', () => {
  const desc = new TaskManagerTool({}).getDescription();
  // Case-insensitive match for resilience against rephrasing.
  const has = (needle) => expect(desc).toMatch(new RegExp(needle, 'i'));

  test('names the four lifecycle phases', () => {
    has('Phase 1 — Plan');
    has('Phase 2 — Execute');
    has('Phase 3 — Refine');
    has('Phase 4 — Finish');
  });

  test('Phase 1 tells the agent to sync the whole plan in ONE call', () => {
    // Plan phase must mention sync + "one call" concept + discourage per-task create at start.
    has('sync');
    has('ONE call');
    // The exact wording that discourages per-task create is free to evolve;
    // what matters is that "one-by-one" (or equivalent) and the word create
    // both appear in the Plan phase area.
    has('one-by-one|one at a time');
  });

  test('Phase 2 describes the in_progress → work → completed per-step pattern', () => {
    has('in_progress');
    has('completed');
    has('one at a time|one task at a time|per step');
  });

  test('Phase 3 covers mid-flight refinement (both single-task create and resync)', () => {
    has('create');
    has('sync');
    // warns against per-turn sync spam
    has("Don't `sync` every turn");
  });

  test('Phase 4 points at jobdone when everything is completed', () => {
    has('jobdone');
  });

  test('preserves the loop-forever warning (operational guard)', () => {
    has('MANDATORY');
    has('loop forever');
  });

  test('preserves memory-integration guidance (unrelated feature must survive)', () => {
    has('memory:');
  });
});
