/**
 * Tests for VisualEditorTool's project-root context resolution.
 *
 * Why this exists:
 *   The tool's action handlers (detect-project, serve-static, detect-dev-port,
 *   open-editor) need the agent's working directory. Historically the code
 *   read only `context.projectRoot || context.workingDirectory`, but the
 *   canonical key messageProcessor (src/core/messageProcessor.js:455) passes
 *   is `context.projectDir`. That mismatch meant every agent-initiated call
 *   silently fell through with "No project directory available" — the editor
 *   only worked when invoked through a legacy path or with the URL typed
 *   manually.
 *
 *   These tests lock in the three-name fallback so a future refactor can't
 *   silently regress the resolution order.
 */

import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';

// Mock heavy dependencies the tool imports at load time
jest.unstable_mockModule('../../services/visualEditorBridge.js', () => ({
  getVisualEditorBridge: jest.fn(),
  InstanceStatus: { CONNECTED: 'connected', DISCONNECTED: 'disconnected' }
}));
jest.unstable_mockModule('../../services/visualEditorServer.js', () => ({
  getVisualEditorServer: jest.fn(),
  getVisualEditorPort: jest.fn(() => 4000),
  getVisualEditorBaseUrl: jest.fn(() => 'http://localhost:4000')
}));
jest.unstable_mockModule('../../services/portTracker.js', () => ({
  getPortTracker: jest.fn()
}));

// Project detector is the key mock — we control what it returns so the
// handler's resolution logic is the only thing under test.
const detectMock = jest.fn();
const getSuggestedServerCommand = jest.fn(() => ({ command: 'npm start', port: 3000 }));
jest.unstable_mockModule('../../services/projectDetector.js', () => ({
  getProjectDetector: jest.fn(() => ({
    detect: detectMock,
    getSuggestedServerCommand
  })),
  PROJECT_TYPES: {}
}));

const { VisualEditorTool } = await import('../visualEditorTool.js');

function makeTool() {
  return new VisualEditorTool({}, createMockLogger());
}

const happyDetection = {
  projectType: 'react-vite',
  framework: 'react',
  isStatic: false,
  entryPoints: ['src/main.jsx'],
  availableScripts: ['dev', 'build'],
  confidence: 'high'
};

describe('VisualEditorTool._handleDetectProject — context-key resolution', () => {
  beforeEach(() => {
    detectMock.mockReset();
    getSuggestedServerCommand.mockClear();
  });

  test('resolves project root via context.projectRoot (legacy path)', async () => {
    const tool = makeTool();
    detectMock.mockResolvedValueOnce(happyDetection);

    const result = await tool._handleDetectProject({ projectRoot: '/legacy/path' });

    expect(detectMock).toHaveBeenCalledWith('/legacy/path');
    expect(result.success).toBe(true);
    expect(result.projectDir).toBe('/legacy/path');
  });

  test('resolves project root via context.workingDirectory (alt path)', async () => {
    const tool = makeTool();
    detectMock.mockResolvedValueOnce(happyDetection);

    const result = await tool._handleDetectProject({ workingDirectory: '/wd/path' });

    expect(detectMock).toHaveBeenCalledWith('/wd/path');
    expect(result.success).toBe(true);
  });

  test('resolves project root via context.projectDir (messageProcessor path)', async () => {
    // THE REGRESSION GUARD: messageProcessor passes `projectDir`. Before the
    // fix this returned {success:false, error:"No project directory available"}.
    const tool = makeTool();
    detectMock.mockResolvedValueOnce(happyDetection);

    const result = await tool._handleDetectProject({ projectDir: '/mp/path' });

    expect(detectMock).toHaveBeenCalledWith('/mp/path');
    expect(result.success).toBe(true);
  });

  test('precedence: projectRoot > workingDirectory > projectDir', async () => {
    const tool = makeTool();
    detectMock.mockResolvedValue(happyDetection);

    await tool._handleDetectProject({
      projectRoot: '/a',
      workingDirectory: '/b',
      projectDir: '/c'
    });
    expect(detectMock).toHaveBeenLastCalledWith('/a');

    detectMock.mockClear();
    await tool._handleDetectProject({
      workingDirectory: '/b',
      projectDir: '/c'
    });
    expect(detectMock).toHaveBeenLastCalledWith('/b');

    detectMock.mockClear();
    await tool._handleDetectProject({ projectDir: '/c' });
    expect(detectMock).toHaveBeenLastCalledWith('/c');
  });

  test('returns error when none of the three context keys is present', async () => {
    const tool = makeTool();
    const result = await tool._handleDetectProject({});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No project directory available/i);
    expect(detectMock).not.toHaveBeenCalled();
  });

  test('surfaces detector errors as returned errors (not thrown)', async () => {
    const tool = makeTool();
    detectMock.mockResolvedValueOnce({ error: 'unreadable project' });

    const result = await tool._handleDetectProject({ projectDir: '/x' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('unreadable project');
  });
});
