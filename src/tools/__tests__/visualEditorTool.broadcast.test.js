/**
 * Tests for VisualEditorTool's auto-open broadcast paths.
 *
 * The tool broadcasts a `visual_editor_open` WebSocket message to the web-ui
 * whenever the agent runs `set-app-url` or `serve-static`. The broadcast tries
 * three fallback paths to find a webServer reference (for resilience across
 * different agent execution contexts):
 *   1. context.agentPool.messageProcessor.orchestrator.webServer
 *   2. context.orchestrator.webServer
 *   3. global.loxiaWebServer
 * If none are present, it logs a warning instead of throwing.
 *
 * These tests directly invoke the private _broadcastOpenEditor method since
 * the public actions depend on heavy bridge/server initialization.
 */

import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';

// Mock heavy dependencies that get pulled in at import time
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
jest.unstable_mockModule('../../services/projectDetector.js', () => ({
  getProjectDetector: jest.fn(),
  PROJECT_TYPES: {}
}));

const { VisualEditorTool } = await import('../visualEditorTool.js');

function makeTool() {
  const tool = new VisualEditorTool({}, createMockLogger());
  return tool;
}

const sampleData = {
  agentId: 'agent-1',
  appUrl: 'http://localhost:3000',
  editorUrl: 'http://localhost:4000?agentId=agent-1&appUrl=http%3A%2F%2Flocalhost%3A3000'
};

describe('VisualEditorTool._broadcastOpenEditor', () => {
  let originalGlobalServer;

  beforeEach(() => {
    originalGlobalServer = global.loxiaWebServer;
    delete global.loxiaWebServer;
  });

  afterEach(() => {
    if (originalGlobalServer !== undefined) {
      global.loxiaWebServer = originalGlobalServer;
    } else {
      delete global.loxiaWebServer;
    }
  });

  // ── Session targeting: always null so the webServer fan-out path runs ──
  //
  // The visual-editor open-editor / set-app-url broadcast is a UI-wide
  // notification — we want every attached browser to hear it. `context.sessionId`
  // here is the agent's scheduler session (e.g. 'scheduler-session'), which
  // doesn't match any UI WebSocket connection. Passing `null` explicitly
  // makes broadcastToSession take its "no session match, deliver to all
  // connections" path — cleaner than accidentally landing there via a
  // mismatched session string.

  // ── Path 1: through agentPool ────────────────────────────────────
  test('uses agentPool.messageProcessor.orchestrator.webServer when available', () => {
    const tool = makeTool();
    const broadcastToSession = jest.fn();
    const context = {
      sessionId: 'session-A',
      agentPool: {
        messageProcessor: {
          orchestrator: {
            webServer: { broadcastToSession }
          }
        }
      }
    };

    tool._broadcastOpenEditor(context, sampleData);

    expect(broadcastToSession).toHaveBeenCalledTimes(1);
    expect(broadcastToSession).toHaveBeenCalledWith(null, {
      type: 'visual_editor_open',
      data: {
        agentId: 'agent-1',
        appUrl: 'http://localhost:3000',
        editorUrl: sampleData.editorUrl
      }
    });
  });

  test('ignores context.sessionId — always broadcasts to all connections', () => {
    // Regression guard: previously `sessionId || 'web-session'` was passed
    // as the target. Either path effectively fell through to "all clients"
    // via the webServer's fallback, but the intent wasn't explicit. Now
    // we pass `null` no matter what.
    const tool = makeTool();
    const broadcastToSession = jest.fn();
    const context = {
      sessionId: 'scheduler-session',  // the scheduler's own session
      agentPool: {
        messageProcessor: {
          orchestrator: { webServer: { broadcastToSession } }
        }
      }
    };

    tool._broadcastOpenEditor(context, sampleData);
    const [targetSessionId] = broadcastToSession.mock.calls[0];
    expect(targetSessionId).toBeNull();
  });

  // ── Path 2: direct orchestrator ──────────────────────────────────
  test('uses context.orchestrator.webServer when agentPool path missing', () => {
    const tool = makeTool();
    const broadcastToSession = jest.fn();
    const context = {
      sessionId: 'session-B',
      orchestrator: { webServer: { broadcastToSession } }
    };

    tool._broadcastOpenEditor(context, sampleData);
    expect(broadcastToSession).toHaveBeenCalledWith(null, expect.objectContaining({
      type: 'visual_editor_open'
    }));
  });

  test('prefers agentPool path over orchestrator path when both exist', () => {
    const tool = makeTool();
    const agentPoolBroadcast = jest.fn();
    const orchestratorBroadcast = jest.fn();
    const context = {
      sessionId: 'session-C',
      agentPool: {
        messageProcessor: {
          orchestrator: { webServer: { broadcastToSession: agentPoolBroadcast } }
        }
      },
      orchestrator: { webServer: { broadcastToSession: orchestratorBroadcast } }
    };

    tool._broadcastOpenEditor(context, sampleData);
    expect(agentPoolBroadcast).toHaveBeenCalled();
    expect(orchestratorBroadcast).not.toHaveBeenCalled();
  });

  // ── Path 3: global fallback ──────────────────────────────────────
  test('uses global.loxiaWebServer when context paths missing', () => {
    const tool = makeTool();
    const broadcastToSession = jest.fn();
    global.loxiaWebServer = { broadcastToSession };

    const context = { sessionId: 'session-D' };
    tool._broadcastOpenEditor(context, sampleData);

    expect(broadcastToSession).toHaveBeenCalledWith(null, expect.objectContaining({
      type: 'visual_editor_open',
      data: expect.objectContaining({ agentId: 'agent-1' })
    }));
  });

  test('global fallback also uses null sessionId (UI-wide broadcast)', () => {
    const tool = makeTool();
    const broadcastToSession = jest.fn();
    global.loxiaWebServer = { broadcastToSession };

    tool._broadcastOpenEditor({}, sampleData);
    expect(broadcastToSession).toHaveBeenCalledWith(null, expect.any(Object));
  });

  // ── No webServer at all → warn but don't throw ───────────────────
  test('logs warning when no webServer is reachable from any path', () => {
    const tool = makeTool();
    const context = {}; // Nothing at all

    // Warn is emitted via console.warn (not this.logger) so the message
    // surfaces even when the tool was constructed without a logger
    // (historic registry behavior).
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(() => tool._broadcastOpenEditor(context, sampleData)).not.toThrow();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not broadcast open-editor'),
        expect.objectContaining({
          hasContext: true,
          hasAgentPool: false,
          hasOrchestrator: false,
          hasGlobal: false,
        })
      );
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  test('handles partial agentPool object gracefully (no messageProcessor)', () => {
    const tool = makeTool();
    const broadcastToSession = jest.fn();
    const context = {
      agentPool: {}, // missing messageProcessor
      orchestrator: { webServer: { broadcastToSession } }
    };

    // Should fall through to orchestrator path
    tool._broadcastOpenEditor(context, sampleData);
    expect(broadcastToSession).toHaveBeenCalled();
  });

  // ── Message shape ─────────────────────────────────────────────────
  test('message data only contains agentId, appUrl, and editorUrl (no extra fields)', () => {
    const tool = makeTool();
    const broadcastToSession = jest.fn();
    const context = {
      orchestrator: { webServer: { broadcastToSession } },
      sessionId: 's'
    };

    // Pass extra fields - they should not leak into the broadcast
    tool._broadcastOpenEditor(context, { ...sampleData, extra: 'leaked', secret: 'hidden' });

    const message = broadcastToSession.mock.calls[0][1];
    expect(Object.keys(message.data).sort()).toEqual(['agentId', 'appUrl', 'editorUrl']);
    expect(message.data.extra).toBeUndefined();
    expect(message.data.secret).toBeUndefined();
  });

  test('message type is exactly "visual_editor_open"', () => {
    const tool = makeTool();
    const broadcastToSession = jest.fn();
    tool._broadcastOpenEditor(
      { orchestrator: { webServer: { broadcastToSession } } },
      sampleData
    );
    expect(broadcastToSession.mock.calls[0][1].type).toBe('visual_editor_open');
  });
});
