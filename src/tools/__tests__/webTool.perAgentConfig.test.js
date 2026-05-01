/**
 * WebTool per-agent configuration tests.
 *
 * Covers the domain-allowlist / blocklist gate and the default
 * stealthLevel fallback introduced by the per-agent toolConfig feature.
 * Split from webTool.unit.test.js because that file is excluded from
 * the default jest run (it pulls in heavier mocks). These tests
 * short-circuit BEFORE the browser layer, so they don't need any of
 * Puppeteer mocked.
 */

import { describe, test, expect, beforeEach } from '@jest/globals';

let WebTool;

beforeEach(async () => {
  const mod = await import('../webTool.js');
  WebTool = mod.default;
});

function makeTool() {
  return new WebTool({ logger: { info() {}, warn() {}, error() {}, debug() {} } });
}

describe('WebTool per-agent toolConfig (domain gate)', () => {
  test('fetch: blocked domain short-circuits with error', async () => {
    const wt = makeTool();
    const result = await wt.execute(
      { operation: 'fetch', url: 'https://evil.example/page' },
      { agentId: 'a', toolConfig: { blockedDomains: ['evil.example'] } }
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/blocked by agent policy/);
    expect(result.operation).toBe('fetch');
  });

  test('fetch: subdomain match counts as blocked', async () => {
    const wt = makeTool();
    const result = await wt.execute(
      { operation: 'fetch', url: 'https://ads.tracker.example/x' },
      { agentId: 'a', toolConfig: { blockedDomains: ['tracker.example'] } }
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/blocked by agent policy/);
  });

  test('fetch: allowed domain whitelist rejects non-matching URL', async () => {
    const wt = makeTool();
    const result = await wt.execute(
      { operation: 'fetch', url: 'https://other.example/x' },
      { agentId: 'a', toolConfig: { allowedDomains: ['github.com'] } }
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not in the agent's allowed domains/);
  });

  test('interactive: per-action navigate URLs are gated', async () => {
    const wt = makeTool();
    const result = await wt.execute(
      {
        operation: 'interactive',
        actions: [{ type: 'navigate', url: 'https://blocked.example' }],
      },
      { agentId: 'a', toolConfig: { blockedDomains: ['blocked.example'] } }
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/blocked by agent policy/);
  });

  test('blocked wins over allowed', async () => {
    const wt = makeTool();
    const result = await wt.execute(
      { operation: 'fetch', url: 'https://github.com/x' },
      {
        agentId: 'a',
        toolConfig: {
          allowedDomains: ['github.com'],
          blockedDomains: ['github.com'],
        },
      }
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/blocked by agent policy/);
  });

  test('no toolConfig → vacuous interactive path still completes', async () => {
    const wt = makeTool();
    const result = await wt.execute(
      { operation: 'interactive', actions: [] },
      { agentId: 'a' }
    );
    expect(result.success).toBe(true);
  });
});
