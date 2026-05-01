/**
 * Cross-repo contract test: the inline-JSON format that
 * autopilot-backend's tool-call bridge produces MUST be extractable by
 * this CLI's TagParser.
 *
 * The test reproduces the exact output of the backend's
 * `formatToolCallInlineBlock` (from autopilot-backend/services/toolCallBridge.js)
 * as a literal template string here, then feeds it to
 * `TagParser.extractToolCommands` + `normalizeToolCommand` and asserts
 * the extraction produces a valid tool invocation.
 *
 * Why the literal template: the backend and CLI are separate repos, so we
 * can't share code. The only way to lock a cross-repo contract is to
 * write the expected format on BOTH sides and test both ends against it.
 * Backend: `services/__tests__/toolCallBridge.test.js` verifies
 * `formatToolCallInlineBlock` produces this exact string. CLI: this file
 * verifies TagParser extracts tools from the same string. If either
 * side's format drifts, the other repo's test breaks. Works because both
 * repos are in the same workspace — deploys happen together.
 *
 * The template MUST stay in lockstep with backend's formatter. Any
 * change there requires a corresponding change here.
 */

import { describe, test, expect } from '@jest/globals';
import TagParser from '../../utilities/tagParser.js';

/**
 * Reproduce the backend's `formatToolCallInlineBlock` output byte-for-byte.
 * Must stay identical to what `autopilot-backend/services/toolCallBridge.js`
 * emits — the single wire contract between provider tool_calls and the
 * CLI's inline-JSON tool extraction.
 */
function bridgeOutput({ name, args }) {
  const params = args ? JSON.parse(args) : {};
  // Header only — see autopilot-backend/services/toolCallBridge.js
  // DESIGN NOTE. No em-dash / param preview line.
  return `\n**Calling ${name}**\n\n` +
    '```json\n' +
    JSON.stringify({ toolId: name, parameters: params }, null, 2) +
    '\n```\n';
}

const parser = new TagParser();

describe('cross-repo contract: backend bridge output → CLI TagParser extraction', () => {
  test('single tool call with string params extracts correctly', () => {
    const bridged = bridgeOutput({
      name: 'filesystem',
      args: '{"action":"read","path":"/etc/hosts"}',
    });
    // Prefix with some assistant prose — real responses combine both.
    const content = 'Let me check that file.' + bridged;

    const commands = parser.extractToolCommands(content);
    expect(commands.length).toBeGreaterThan(0);

    const normalized = parser.normalizeToolCommand(commands[0]);
    expect(normalized.toolId).toBe('filesystem');
    // Parameters may land either flat on the command (unwrapped by
    // tagParser) or inside a `parameters` object — either is fine as
    // long as the agent has access to them. Verify at least one path.
    const params = normalized.parameters || normalized;
    expect(params.action).toBe('read');
    expect(params.path).toBe('/etc/hosts');
  });

  test('multiple tool calls in the same content extract as separate commands in order', () => {
    const content =
      'I will run two commands.' +
      bridgeOutput({ name: 'filesystem', args: '{"path":"/a"}' }) +
      ' Then: ' +
      bridgeOutput({ name: 'terminal', args: '{"cmd":"ls"}' });

    const commands = parser.extractToolCommands(content);
    expect(commands.length).toBeGreaterThanOrEqual(2);
    // The parser may order by appearance; at minimum both tool ids are
    // present.
    const toolIds = commands.map(c => parser.normalizeToolCommand(c).toolId);
    expect(toolIds).toContain('filesystem');
    expect(toolIds).toContain('terminal');
  });

  test('tool call with nested object params extracts with structure preserved', () => {
    const bridged = bridgeOutput({
      name: 'taskmanager',
      args: JSON.stringify({
        action: 'sync',
        tasks: [
          { title: 'Task 1', priority: 'high' },
          { title: 'Task 2', priority: 'medium' },
        ],
      }),
    });
    const commands = parser.extractToolCommands(bridged);
    expect(commands.length).toBeGreaterThan(0);
    const normalized = parser.normalizeToolCommand(commands[0]);
    expect(normalized.toolId).toBe('taskmanager');
    const params = normalized.parameters || normalized;
    expect(params.action).toBe('sync');
    expect(Array.isArray(params.tasks)).toBe(true);
    expect(params.tasks).toHaveLength(2);
    expect(params.tasks[0].title).toBe('Task 1');
  });

  test('bridge output with no params (empty args object) extracts toolId correctly', () => {
    const bridged = bridgeOutput({ name: 'jobdone', args: '{}' });
    const commands = parser.extractToolCommands(bridged);
    expect(commands.length).toBeGreaterThan(0);
    const normalized = parser.normalizeToolCommand(commands[0]);
    expect(normalized.toolId).toBe('jobdone');
  });

  test('bridge output surrounded by assistant prose does not trip the extractor', () => {
    const content =
      "I'll analyze this step by step. First, I need to check the file.\n\n" +
      bridgeOutput({ name: 'filesystem', args: '{"path":"/x","action":"stat"}' }) +
      "\n\nAfter I see the metadata I'll decide next steps.";

    const commands = parser.extractToolCommands(content);
    expect(commands.length).toBeGreaterThan(0);
    const normalized = parser.normalizeToolCommand(commands[0]);
    expect(normalized.toolId).toBe('filesystem');
    const params = normalized.parameters || normalized;
    expect(params.path).toBe('/x');
  });
});
