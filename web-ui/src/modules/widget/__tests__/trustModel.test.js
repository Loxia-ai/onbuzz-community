/**
 * Trust ladder — storage semantics + cross-tab BroadcastChannel sync.
 *
 * The trust ladder drives whether a widget iframe gets sandbox="allow-scripts".
 * Every branch matters: regressions here either leak script privilege (level
 * 0 widgets get scripts they shouldn't) or leave the user stuck clicking
 * through trust prompts forever.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  isTrusted, trustLevel,
  trustWidget, revokeWidget,
  trustAgentSession, revokeAgentSession,
  trustAgentForever,  revokeAgentForever,
  revokeAgent,
  onTrustChange,
} from '../trustModel.js';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('isTrusted / trustLevel — four levels', () => {
  it('level 0 (default): no storage set → untrusted', () => {
    expect(isTrusted({ templateId: 't1', agentId: 'a1' })).toBe(false);
    expect(trustLevel({ templateId: 't1', agentId: 'a1' })).toBe(0);
  });

  it('level 1: trustWidget → template-scoped trust', () => {
    trustWidget('loan-calc-v3');
    expect(isTrusted({ templateId: 'loan-calc-v3', agentId: 'any-agent' })).toBe(true);
    expect(trustLevel({ templateId: 'loan-calc-v3', agentId: 'any-agent' })).toBe(1);
    // Different template — not trusted
    expect(isTrusted({ templateId: 'other-widget', agentId: 'any-agent' })).toBe(false);
  });

  it('level 2: trustAgentSession → applies to every widget from that agent', () => {
    trustAgentSession('agent-7');
    expect(isTrusted({ templateId: 'any-template', agentId: 'agent-7' })).toBe(true);
    expect(trustLevel({ templateId: 'any-template', agentId: 'agent-7' })).toBe(2);
    // Different agent — not trusted
    expect(isTrusted({ templateId: 'any-template', agentId: 'agent-8' })).toBe(false);
  });

  it('level 3: trustAgentForever → persists in localStorage, outranks level 2', () => {
    trustAgentForever('agent-99');
    expect(isTrusted({ agentId: 'agent-99' })).toBe(true);
    expect(trustLevel({ agentId: 'agent-99' })).toBe(3);
  });

  it('level 3 reported even when level 2 is also set (highest wins)', () => {
    trustAgentSession('agent-x');
    trustAgentForever('agent-x');
    expect(trustLevel({ agentId: 'agent-x' })).toBe(3);
  });

  it('widgetId is accepted as a synonym for templateId', () => {
    trustWidget('w-123');
    expect(isTrusted({ widgetId: 'w-123' })).toBe(true);
  });
});

describe('revoke paths', () => {
  it('revokeWidget drops level 1 but leaves agent trust alone', () => {
    trustWidget('t1');
    trustAgentSession('a1');
    revokeWidget('t1');
    expect(isTrusted({ templateId: 't1', agentId: 'a1' })).toBe(true); // still level 2
    expect(trustLevel({ templateId: 't1', agentId: 'a1' })).toBe(2);
  });

  it('revokeAgentSession drops level 2 but leaves level 3 alone', () => {
    trustAgentSession('a1');
    trustAgentForever('a1');
    revokeAgentSession('a1');
    expect(trustLevel({ agentId: 'a1' })).toBe(3);
  });

  it('revokeAgentForever drops level 3 but leaves level 2 alone', () => {
    trustAgentSession('a1');
    trustAgentForever('a1');
    revokeAgentForever('a1');
    expect(trustLevel({ agentId: 'a1' })).toBe(2);
  });

  it('revokeAgent drops BOTH session + forever', () => {
    trustAgentSession('a1');
    trustAgentForever('a1');
    revokeAgent('a1');
    expect(trustLevel({ agentId: 'a1' })).toBe(0);
  });
});

describe('isolation', () => {
  it('trust does not leak across agents', () => {
    trustAgentSession('a1');
    trustAgentForever('a2');
    expect(isTrusted({ agentId: 'a1' })).toBe(true);
    expect(isTrusted({ agentId: 'a2' })).toBe(true);
    expect(isTrusted({ agentId: 'a3' })).toBe(false);
  });

  it('trust does not leak across templates', () => {
    trustWidget('w1');
    expect(isTrusted({ templateId: 'w1' })).toBe(true);
    expect(isTrusted({ templateId: 'w2' })).toBe(false);
  });
});

describe('onTrustChange listeners', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fires when widget trust changes', () => {
    const spy = vi.fn();
    const off = onTrustChange(spy);
    trustWidget('t1');
    expect(spy).toHaveBeenCalled();
    off();
  });

  it('fires when agent-session trust changes', () => {
    const spy = vi.fn();
    onTrustChange(spy);
    trustAgentSession('a1');
    expect(spy).toHaveBeenCalled();
  });

  it('unsubscribe stops further notifications', () => {
    const spy = vi.fn();
    const off = onTrustChange(spy);
    off();
    trustWidget('t1');
    expect(spy).not.toHaveBeenCalled();
  });
});

// BroadcastChannel cross-tab sync: jsdom 29 ships BroadcastChannel, so we
// can test the behaviour end-to-end by wiring two channels on the same name.
describe('cross-tab session trust (BroadcastChannel)', () => {
  it('grant in one tab → listener fires (simulating second tab reception)', async () => {
    // Simulate a second tab by opening another BroadcastChannel on the
    // same name and checking that our channel's onmessage fires when we
    // postMessage from outside.
    const other = new BroadcastChannel('loxia-widget-trust');
    const fn = vi.fn();
    onTrustChange(fn); // triggers ensureChannelWired internally on first call

    other.postMessage({ type: 'session-trust-added', agentId: 'cross-tab-agent' });
    // BroadcastChannel deliveries are async — wait for the event loop.
    await new Promise(r => setTimeout(r, 10));

    // The sessionStorage got mirrored, and listeners were notified.
    expect(sessionStorage.getItem('loxia-widget-trust-agent-cross-tab-agent-session')).toBe('true');
    expect(fn).toHaveBeenCalled();
    other.close();
  });

  it('revoke broadcast clears local sessionStorage', async () => {
    sessionStorage.setItem('loxia-widget-trust-agent-gone-session', 'true');
    const other = new BroadcastChannel('loxia-widget-trust');
    onTrustChange(() => {}); // wire up
    other.postMessage({ type: 'session-trust-revoked', agentId: 'gone' });
    await new Promise(r => setTimeout(r, 10));
    expect(sessionStorage.getItem('loxia-widget-trust-agent-gone-session')).toBeNull();
    other.close();
  });
});
