/**
 * Tests for the Quick Send history policy. Validates the
 * source-grounded chat architecture: the highlighted page text lives
 * on the thread as a typed `sourceAnchor`, gets injected into the
 * system prompt at dispatch time, and never appears inside a user
 * message body. The transcript stores only typed questions + replies.
 *
 * The integration simulation at the bottom re-enacts the same sequence
 * the endpoint + scheduler perform on `agent.conversations.full.messages`
 * across a stream of Quick Send requests, without booting the rest of
 * the stack.
 */

import { describe, test, expect } from '@jest/globals';
import {
  fingerprintSelection,
  decideMode,
  archiveLiveMessages,
  trimMessagesForModel,
  shouldApplyQuickSendPolicy,
  composeSourceAnchor,
  buildSourceAnchorBlock,
  composeQuickSendUserMessage,
  QUICK_SEND_WINDOW,
  ARCHIVED_KEY
} from '../quickSendHistoryPolicy.js';

const userMsg = (content) => ({ role: 'user', content, timestamp: new Date().toISOString() });
const asstMsg = (content) => ({ role: 'assistant', content, timestamp: new Date().toISOString() });

describe('fingerprintSelection', () => {
  test('returns null for empty or non-string input', () => {
    expect(fingerprintSelection(null)).toBeNull();
    expect(fingerprintSelection(undefined)).toBeNull();
    expect(fingerprintSelection('')).toBeNull();
    expect(fingerprintSelection('   ')).toBeNull();
    expect(fingerprintSelection(42)).toBeNull();
  });

  test('is stable for identical input', () => {
    const a = fingerprintSelection('hello world');
    const b = fingerprintSelection('hello world');
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
  });

  test('ignores leading/trailing whitespace so the extension\'s newlines do not flip mode', () => {
    expect(fingerprintSelection('hello world'))
      .toBe(fingerprintSelection('  hello world\n'));
  });

  test('different selections produce different fingerprints', () => {
    expect(fingerprintSelection('a')).not.toBe(fingerprintSelection('b'));
  });
});

describe('decideMode', () => {
  test('first send (no stored fingerprint) is new-selection', () => {
    expect(decideMode({ incomingFingerprint: 'abc', storedFingerprint: null }))
      .toBe('new-selection');
  });

  test('identical fingerprint is follow-up', () => {
    expect(decideMode({ incomingFingerprint: 'abc', storedFingerprint: 'abc' }))
      .toBe('follow-up');
  });

  test('differing fingerprint is new-selection', () => {
    expect(decideMode({ incomingFingerprint: 'abc', storedFingerprint: 'xyz' }))
      .toBe('new-selection');
  });

  test('missing incoming fingerprint defensively falls back to new-selection', () => {
    expect(decideMode({ incomingFingerprint: null, storedFingerprint: 'abc' }))
      .toBe('new-selection');
  });
});

describe('archiveLiveMessages', () => {
  test('stamps every live message and reports the count', () => {
    const msgs = [userMsg('a'), asstMsg('b'), userMsg('c')];
    const count = archiveLiveMessages(msgs, '2026-05-20T00:00:00.000Z');
    expect(count).toBe(3);
    expect(msgs.every((m) => m[ARCHIVED_KEY] === '2026-05-20T00:00:00.000Z')).toBe(true);
  });

  test('is idempotent — already-archived messages keep their original timestamp', () => {
    const msgs = [userMsg('a'), asstMsg('b')];
    archiveLiveMessages(msgs, '2026-05-19T00:00:00.000Z');
    const count = archiveLiveMessages(msgs, '2026-05-20T00:00:00.000Z');
    expect(count).toBe(0);
    expect(msgs[0][ARCHIVED_KEY]).toBe('2026-05-19T00:00:00.000Z');
  });

  test('tolerates a non-array input', () => {
    expect(archiveLiveMessages(null)).toBe(0);
    expect(archiveLiveMessages(undefined)).toBe(0);
  });
});

describe('trimMessagesForModel', () => {
  test('empty array returns empty', () => {
    expect(trimMessagesForModel([])).toEqual([]);
  });

  test('returns all live messages unchanged when within window', () => {
    const msgs = [userMsg('a'), asstMsg('b')];
    expect(trimMessagesForModel(msgs)).toEqual(msgs);
  });

  test('drops messages marked with quickSendArchivedAt', () => {
    const archived = { ...userMsg('old'), [ARCHIVED_KEY]: '2026-05-19T00:00:00.000Z' };
    const live = userMsg('new');
    expect(trimMessagesForModel([archived, live])).toEqual([live]);
  });

  test('over window: keeps the last WINDOW messages (plain tail, no anchor pinning)', () => {
    const a = userMsg('q1');
    const b = asstMsg('r1');
    const c = userMsg('q2');
    const d = asstMsg('r2');
    const e = userMsg('q3');
    const result = trimMessagesForModel([a, b, c, d, e]);
    expect(result).toHaveLength(QUICK_SEND_WINDOW);
    expect(result).toEqual([c, d, e]);
  });

  test('first turn is NOT pinned — the source anchor lives in the system prompt, not in user-turn bodies', () => {
    // 4 live messages with window=3: tail is the last 3, not [anchor, last 2].
    const a = userMsg('q1');
    const b = asstMsg('r1');
    const c = userMsg('q2');
    const d = asstMsg('r2');
    const result = trimMessagesForModel([a, b, c, d]);
    expect(result).toEqual([b, c, d]);
    expect(result).not.toContain(a);
  });
});

describe('shouldApplyQuickSendPolicy', () => {
  test('true for the "Quick Send" agent by exact name', () => {
    expect(shouldApplyQuickSendPolicy({ name: 'Quick Send' })).toBe(true);
  });

  test('false for anything else', () => {
    expect(shouldApplyQuickSendPolicy(null)).toBe(false);
    expect(shouldApplyQuickSendPolicy({ name: 'Other Agent' })).toBe(false);
    expect(shouldApplyQuickSendPolicy({})).toBe(false);
  });
});

describe('composeSourceAnchor', () => {
  test('returns a typed object with fingerprint + updatedAt filled', () => {
    const anchor = composeSourceAnchor({
      selectedText: 'PAGE TEXT',
      pageTitle: 'Wiki',
      sourceUrl: 'https://example.com',
      surroundingText: 'context around'
    });
    expect(anchor).toMatchObject({
      selectedText: 'PAGE TEXT',
      pageTitle: 'Wiki',
      sourceUrl: 'https://example.com',
      surroundingText: 'context around'
    });
    expect(anchor.fingerprint).toBe(fingerprintSelection('PAGE TEXT'));
    expect(typeof anchor.updatedAt).toBe('string');
  });

  test('normalizes missing optional fields to null', () => {
    const anchor = composeSourceAnchor({ selectedText: 'X' });
    expect(anchor.pageTitle).toBeNull();
    expect(anchor.sourceUrl).toBeNull();
    expect(anchor.surroundingText).toBeNull();
  });

  test('returns null when selectedText is missing or empty', () => {
    expect(composeSourceAnchor({})).toBeNull();
    expect(composeSourceAnchor({ selectedText: '' })).toBeNull();
    expect(composeSourceAnchor({ selectedText: '   ' })).toBeNull();
  });
});

describe('buildSourceAnchorBlock', () => {
  test('returns null when the anchor is missing or has no selected text', () => {
    expect(buildSourceAnchorBlock(null)).toBeNull();
    expect(buildSourceAnchorBlock({})).toBeNull();
    expect(buildSourceAnchorBlock({ selectedText: '   ' })).toBeNull();
  });

  test('includes the selected text and all available metadata as a fenced block', () => {
    const block = buildSourceAnchorBlock({
      selectedText: 'PAGE TEXT',
      pageTitle: 'Wiki',
      sourceUrl: 'https://example.com',
      surroundingText: 'context around'
    });
    expect(block).toContain('Source context');
    expect(block).toContain('Page title: Wiki');
    expect(block).toContain('Source URL: https://example.com');
    expect(block).toContain('Selected text:');
    expect(block).toContain('PAGE TEXT');
    expect(block).toContain('Surrounding context:');
    expect(block).toContain('context around');
    expect(block).toContain('End source context');
  });

  test('omits empty metadata lines cleanly', () => {
    const block = buildSourceAnchorBlock({ selectedText: 'JUST TEXT' });
    expect(block).toContain('Selected text:');
    expect(block).toContain('JUST TEXT');
    expect(block).not.toContain('Page title:');
    expect(block).not.toContain('Source URL:');
    expect(block).not.toContain('Surrounding context:');
  });
});

describe('composeQuickSendUserMessage', () => {
  test('returns the typed question verbatim when provided', () => {
    expect(composeQuickSendUserMessage({ userMessage: 'translate to hebrew' }))
      .toBe('translate to hebrew');
  });

  test('returns a placeholder when no question was typed — never embeds the selection', () => {
    const placeholder = composeQuickSendUserMessage({ userMessage: null });
    expect(placeholder).toBeTruthy();
    expect(placeholder).not.toContain('Selected text');
    expect(placeholder).not.toContain('Source URL');
  });

  test('treats whitespace-only input as no question', () => {
    expect(composeQuickSendUserMessage({ userMessage: '   ' }))
      .toBe(composeQuickSendUserMessage({ userMessage: null }));
  });
});

// ── Integration: simulate the full handler+scheduler cycle ─────────
//
// Mirrors the source-grounded chat flow. The endpoint stores the
// anchor on the thread and persists ONLY the typed question into the
// transcript; the scheduler reads back the transcript, trims to a
// bounded recent window, and injects the anchor into the system
// prompt. None of the user turns should ever contain the selected
// text — that's the central invariant the architecture rests on.
describe('end-to-end source-grounded chat simulation', () => {
  // Stand-in for the thread index entry's per-thread state.
  let threadState = { lastSelectionFingerprint: null, sourceAnchor: null };
  const transcript = []; // mirrors agent.conversations.full.messages
  // Stand-in for what the scheduler builds as the model's system prompt.
  const BASE_SYSTEM_PROMPT = 'You are Quick Send. Answer grounded in the source.';

  function send(selection, question, { surrounding = null, pageTitle = null, sourceUrl = null } = {}) {
    // Endpoint side ──────────────────────────────────────────────
    const incomingFingerprint = fingerprintSelection(selection);
    const mode = decideMode({
      incomingFingerprint,
      storedFingerprint: threadState.lastSelectionFingerprint
    });
    if (mode === 'new-selection') {
      archiveLiveMessages(transcript);
    }
    threadState.lastSelectionFingerprint = incomingFingerprint;
    threadState.sourceAnchor = composeSourceAnchor({
      selectedText: selection,
      pageTitle,
      sourceUrl,
      surroundingText: surrounding
    });

    // Transcript gets ONLY the typed question (or placeholder).
    transcript.push(userMsg(composeQuickSendUserMessage({ userMessage: question })));

    // Scheduler side ─────────────────────────────────────────────
    const trimmed = trimMessagesForModel(transcript);
    const anchorBlock = buildSourceAnchorBlock(threadState.sourceAnchor);
    const systemPrompt = BASE_SYSTEM_PROMPT + (anchorBlock ? '\n' + anchorBlock : '');

    // Stub the assistant reply landing back in the transcript.
    transcript.push(asstMsg(`reply to: ${question || '<no question>'}`));

    return { mode, modelMessages: trimmed, systemPrompt };
  }

  test('first Quick Send with selected text: anchor is in system prompt; transcript user turn is the typed question only', () => {
    const r = send('PAGE A TEXT', 'summarize this', { pageTitle: 'Wiki A', sourceUrl: 'https://a' });
    expect(r.mode).toBe('new-selection');
    expect(r.modelMessages).toHaveLength(1);
    expect(r.modelMessages[0].role).toBe('user');
    expect(r.modelMessages[0].content).toBe('summarize this');
    // The user turn must NOT carry the selection.
    expect(r.modelMessages[0].content).not.toContain('PAGE A TEXT');
    // The anchor must be in the system prompt instead.
    expect(r.systemPrompt).toContain('PAGE A TEXT');
    expect(r.systemPrompt).toContain('Wiki A');
    expect(r.systemPrompt).toContain('https://a');
  });

  test('follow-up on same selection: bounded recent window, anchor still in system prompt, NEVER duplicated', () => {
    const r = send('PAGE A TEXT', 'now make it shorter');
    expect(r.mode).toBe('follow-up');
    expect(r.modelMessages.length).toBeLessThanOrEqual(QUICK_SEND_WINDOW);
    // Each user turn carries ONLY a typed question.
    const userTurns = r.modelMessages.filter((m) => m.role === 'user');
    for (const turn of userTurns) {
      expect(turn.content).not.toContain('PAGE A TEXT');
    }
    expect(userTurns[userTurns.length - 1].content).toBe('now make it shorter');
    // The anchor appears exactly once across the whole payload — in
    // the system prompt.
    expect(r.systemPrompt.match(/PAGE A TEXT/g)).toHaveLength(1);
  });

  test('current user instruction is preserved clearly on every send', () => {
    const r1 = send('PAGE A TEXT', 'one sentence');
    expect(r1.modelMessages[r1.modelMessages.length - 1].content).toBe('one sentence');
    const r2 = send('PAGE A TEXT', 'now in french');
    expect(r2.modelMessages[r2.modelMessages.length - 1].content).toBe('now in french');
  });

  test('many follow-ups stay bounded — model never sees more than WINDOW messages', () => {
    for (let i = 0; i < 12; i++) {
      const r = send('PAGE A TEXT', `follow-up ${i}`);
      expect(r.mode).toBe('follow-up');
      expect(r.modelMessages.length).toBeLessThanOrEqual(QUICK_SEND_WINDOW);
      // Anchor reaches the model once via the system prompt; never
      // through any user-turn body.
      expect(r.systemPrompt.match(/PAGE A TEXT/g)).toHaveLength(1);
      const userBodies = r.modelMessages.filter((m) => m.role === 'user').map((m) => m.content);
      expect(userBodies.some((c) => c.includes('PAGE A TEXT'))).toBe(false);
    }
  });

  test('new selected text replaces the anchor and prior live turns are excluded from the model payload', () => {
    const r = send('PAGE B TEXT', 'translate to hebrew only', { pageTitle: 'Wiki B' });
    expect(r.mode).toBe('new-selection');
    // Model sees only the new typed question — earlier turns are
    // archived in the transcript and dropped by the trim.
    expect(r.modelMessages).toHaveLength(1);
    expect(r.modelMessages[0].content).toBe('translate to hebrew only');
    // System prompt now describes PAGE B, NOT PAGE A.
    expect(r.systemPrompt).toContain('PAGE B TEXT');
    expect(r.systemPrompt).not.toContain('PAGE A TEXT');
  });

  test('side panel transcript remains intact across selections — archived turns are preserved for display', () => {
    // The transcript array still holds everything: the live PAGE B
    // exchange plus the now-archived PAGE A history.
    const archived = transcript.filter((m) => m[ARCHIVED_KEY]);
    const live = transcript.filter((m) => !m[ARCHIVED_KEY]);
    expect(archived.length).toBeGreaterThan(0);
    expect(live.length).toBeGreaterThan(0);
    // Display content is the typed questions + replies — the side
    // panel will render the source via the thread.sourceAnchor field
    // surfaced separately by the poll endpoint.
    for (const turn of transcript) {
      expect(typeof turn.content).toBe('string');
      expect(turn.content).not.toContain('Selected text:');
      expect(turn.content).not.toContain('Source URL:');
    }
  });

  test('model payload does not duplicate the selected text across repeated sends', () => {
    // After everything above plus a few more follow-ups on PAGE B,
    // there should still be EXACTLY one occurrence of the source text
    // per dispatch — in the system prompt.
    send('PAGE B TEXT', 'shorter');
    const r = send('PAGE B TEXT', 'shorter still');
    expect(r.systemPrompt.match(/PAGE B TEXT/g)).toHaveLength(1);
    const userOccurrences = r.modelMessages
      .filter((m) => m.role === 'user')
      .reduce((sum, m) => sum + ((m.content.match(/PAGE B TEXT/g) || []).length), 0);
    expect(userOccurrences).toBe(0);
  });
});
