/**
 * The UI predicate that decides whether a persisted `role: 'user'` message
 * is really an internal tool-result injection (hidden from the chat feed)
 * vs. a real user turn. Missing a case here is what caused "[Previous Task
 * — Final Tool Results] …" to appear as a user bubble after chat reload.
 */
import { describe, it, expect } from 'vitest';
import { __test__ } from '../appStore.js';

const { isInternalToolResultMessage } = __test__;

describe('isInternalToolResultMessage', () => {
  it('returns false for null / undefined / empty', () => {
    expect(isInternalToolResultMessage(null)).toBe(false);
    expect(isInternalToolResultMessage(undefined)).toBe(false);
    expect(isInternalToolResultMessage({})).toBe(false);
  });

  it('returns false for real user messages', () => {
    expect(isInternalToolResultMessage({
      role: 'user', type: 'consolidated-input',
      content: 'please add a button',
    })).toBe(false);
    expect(isInternalToolResultMessage({
      role: 'user', content: 'hello',
    })).toBe(false);
  });

  it('hides type: tool-result', () => {
    expect(isInternalToolResultMessage({
      role: 'user', type: 'tool-result',
      content: '[Tool Results — 1 result]...',
    })).toBe(true);
  });

  // REGRESSION: task-boundary was NOT in the filter, so "[Previous Task —
  // Final Tool Results] …" showed up as a standalone user bubble after
  // the chat was reloaded.
  it('hides type: task-boundary (was the "Previous Task" bug)', () => {
    expect(isInternalToolResultMessage({
      role: 'user', type: 'task-boundary',
      content: '[Previous Task — Final Tool Results]\n[terminal] ...',
    })).toBe(true);
  });

  it('hides consolidated-input that starts with "[Tool Results"', () => {
    expect(isInternalToolResultMessage({
      role: 'user', type: 'consolidated-input',
      content: '[Tool Results — 2 results from 1 tool batch: terminal, taskmanager]\n...',
    })).toBe(true);
  });

  it('hides consolidated-input that starts with "[Previous Task" (future form)', () => {
    expect(isInternalToolResultMessage({
      role: 'user', type: 'consolidated-input',
      content: '[Previous Task — Final Tool Results]\n...',
    })).toBe(true);
  });

  it('hides type: widget-error-feedback (the reactivation user-message)', () => {
    // Widget render errors trigger a synthetic user-message so the agent
    // wakes up and fixes the bug. That message must NOT appear in the
    // chat feed — it's system-generated feedback, not user speech.
    expect(isInternalToolResultMessage({
      role: 'user', type: 'widget-error-feedback',
      isToolResultInjection: true,
      content: '[Widget render error — action required]\n...',
    })).toBe(true);
  });

  it('hides consolidated-input whose content starts with "[Widget render error"', () => {
    // If several queued signals get merged into one consolidated input,
    // the header still identifies it as widget-error feedback.
    expect(isInternalToolResultMessage({
      role: 'user', type: 'consolidated-input',
      content: '[Widget render error — action required]\n...',
    })).toBe(true);
  });

  it('respects the explicit isToolResultInjection flag (forward compat)', () => {
    // New backend injection kinds that set the flag get hidden even if
    // their `type` string is new and the UI predicate doesn\'t know it.
    expect(isInternalToolResultMessage({
      role: 'user', type: 'some-future-subtype',
      isToolResultInjection: true,
      content: '…',
    })).toBe(true);
  });

  it('keeps consolidated-input with mixed content (user text comes first)', () => {
    // Scheduler merges tool-results AFTER user text when both arrive in
    // the same cycle. Those should NOT be hidden — the user CAN see their
    // own message that just happened to also include tool-results.
    // The predicate only fires on content that STARTS with [Tool Results
    // or [Previous Task, so a mix with user text first stays visible.
    expect(isInternalToolResultMessage({
      role: 'user', type: 'consolidated-input',
      content: 'please run the tests\n\n[Tool Results — …]',
    })).toBe(false);
  });
});
