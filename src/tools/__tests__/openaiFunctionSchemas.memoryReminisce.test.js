/**
 * Contract test for the `memory` function's OpenAI schema — specifically
 * that it advertises the `reminisce` action and its sub-mode params.
 *
 * Why this exists: the OpenAI function schema is what the model sees on
 * the Chat Completions path. If `reminisce` is missing from the enum or
 * the reminisce-specific params are absent, the model can't invoke it
 * correctly regardless of what memoryTool's own validators say. This
 * tripwire catches that class of drift without booting the full CLI.
 */

import { describe, test, expect } from '@jest/globals';
import { OPENAI_FUNCTION_SCHEMAS } from '../openaiFunctionSchemas.js';

const memory = OPENAI_FUNCTION_SCHEMAS.find(s => s.name === 'memory');

describe('OPENAI_FUNCTION_SCHEMAS — memory function', () => {
  test('memory function schema exists', () => {
    expect(memory).toBeDefined();
    expect(memory.type).toBe('function');
    expect(memory.parameters?.type).toBe('object');
  });

  test('action enum includes reminisce', () => {
    const actions = memory.parameters.properties.action.enum;
    expect(actions).toContain('reminisce');
  });

  test('action enum covers every sanctioned action (incl. stats)', () => {
    const actions = memory.parameters.properties.action.enum;
    for (const a of ['add', 'update', 'delete', 'read', 'list', 'search', 'stats', 'reminisce']) {
      expect(actions).toContain(a);
    }
  });

  test('mode field is present and enumerates the six sub-modes', () => {
    const mode = memory.parameters.properties.mode;
    expect(mode).toBeDefined();
    expect(mode.enum).toEqual(
      expect.arrayContaining(['overview', 'range', 'search', 'around', 'byTool', 'read'])
    );
  });

  test('every reminisce-specific parameter is documented in the schema', () => {
    // The model can only pass what the schema advertises. If one of these
    // is missing, the feature silently loses that capability on the Chat
    // Completions path.
    const required = [
      'mode',
      'messageId',
      'from', 'to',
      'offset', 'limit', 'maxResults',
      'role', 'cursor', 'toolId',
      'before', 'after',
      'lineFrom', 'lineTo', 'contentFrom', 'contentTo',
      'detail',
    ];
    for (const field of required) {
      const prop = memory.parameters.properties[field];
      expect(prop).toBeDefined();
      expect(typeof prop.description).toBe('string');
      expect(prop.description.length).toBeGreaterThan(0);
    }
  });

  test('around before/after descriptions say MESSAGES (not chars/lines)', () => {
    const before = memory.parameters.properties.before.description;
    const after = memory.parameters.properties.after.description;
    expect(before).toMatch(/MESSAGES/);
    expect(after).toMatch(/MESSAGES/);
  });

  test('read line/char params describe their index convention and cap', () => {
    const p = memory.parameters.properties;
    expect(p.lineFrom.description).toMatch(/1-indexed/);
    expect(p.lineTo.description).toMatch(/500 lines/);
    expect(p.contentFrom.description).toMatch(/0-indexed/);
    expect(p.contentTo.description).toMatch(/16000 chars|16 000 chars/);
  });

  test('top-level description mentions reminisce so the model knows the tool does both', () => {
    expect(memory.description.toLowerCase()).toMatch(/reminisce|archive/);
  });
});
