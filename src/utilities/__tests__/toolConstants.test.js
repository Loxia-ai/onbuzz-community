import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import {
  TOOL_IDS,
  identifyJsonStructure,
  getToolIdFromAction,
  isValidToolId,
  getToolActions,
  TOOL_ACTION_MAP,
  JSON_STRUCTURES,
  COMMAND_FORMATS
} from '../toolConstants.js';

describe('toolConstants', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  describe('TOOL_IDS', () => {
    test('contains expected tool IDs', () => {
      expect(TOOL_IDS.TERMINAL).toBe('terminal');
      expect(TOOL_IDS.FILESYSTEM).toBe('filesystem');
      expect(TOOL_IDS.WEB).toBe('web');
      expect(TOOL_IDS.JOB_DONE).toBe('jobdone');
      expect(TOOL_IDS.TASK_MANAGER).toBe('taskmanager');
      expect(TOOL_IDS.AGENT_COMMUNICATION).toBe('agentcommunication');
    });
  });

  describe('isValidToolId', () => {
    test('returns true for known tools, false for unknown', () => {
      expect(isValidToolId('terminal')).toBe(true);
      expect(isValidToolId('filesystem')).toBe(true);
      expect(isValidToolId('web')).toBe(true);
      expect(isValidToolId('nonexistent-tool')).toBe(false);
      expect(isValidToolId('')).toBe(false);
      expect(isValidToolId(null)).toBe(false);
    });
  });

  describe('getToolIdFromAction', () => {
    test('returns correct tool for known actions', () => {
      expect(getToolIdFromAction('run-command')).toBe('terminal');
      expect(getToolIdFromAction('write-file')).toBe('filesystem');
      expect(getToolIdFromAction('move-file')).toBe('filesystem');
      // Note: 'read-file' is overridden by skills tool in TOOL_ACTION_MAP
      expect(getToolIdFromAction('read-file')).toBe('skills');
      expect(getToolIdFromAction('delay')).toBe('agentdelay');
    });

    test('returns null for unknown action', () => {
      expect(getToolIdFromAction('totally-unknown-action')).toBeNull();
      expect(getToolIdFromAction(null)).toBeNull();
      expect(getToolIdFromAction('')).toBeNull();
    });
  });

  describe('identifyJsonStructure', () => {
    test('identifies standard format { toolId, parameters }', () => {
      const data = { toolId: 'terminal', parameters: { command: 'ls' } };
      expect(identifyJsonStructure(data)).toBe(JSON_STRUCTURES.STANDARD);
    });

    test('identifies actions array format', () => {
      const data = { actions: [{ type: 'run-command' }] };
      expect(identifyJsonStructure(data)).toBe(JSON_STRUCTURES.ACTIONS_ARRAY);
    });

    test('identifies direct action format', () => {
      const data = { type: 'run-command', command: 'ls' };
      expect(identifyJsonStructure(data)).toBe(JSON_STRUCTURES.DIRECT_ACTION);
    });

    test('returns null for non-object or unrecognized input', () => {
      expect(identifyJsonStructure(null)).toBeNull();
      expect(identifyJsonStructure('string')).toBeNull();
      expect(identifyJsonStructure({ random: 'data' })).toBeNull();
    });
  });

  describe('getToolActions', () => {
    test('returns array of actions for a valid tool', () => {
      const terminalActions = getToolActions('terminal');
      expect(Array.isArray(terminalActions)).toBe(true);
      expect(terminalActions).toContain('run-command');
      expect(terminalActions).toContain('change-directory');
      expect(terminalActions.length).toBeGreaterThan(0);
    });

    test('returns empty array for unknown tool', () => {
      const actions = getToolActions('nonexistent-tool');
      expect(actions).toEqual([]);
    });
  });
});
