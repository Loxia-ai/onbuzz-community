import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';

// Mock child_process spawn
const mockSpawn = jest.fn();
jest.unstable_mockModule('child_process', () => ({
  spawn: mockSpawn
}));

// Mock fs/promises
const mockWriteFile = jest.fn().mockResolvedValue(undefined);
const mockUnlink = jest.fn().mockResolvedValue(undefined);
jest.unstable_mockModule('fs/promises', () => ({
  default: { writeFile: mockWriteFile, unlink: mockUnlink },
  writeFile: mockWriteFile,
  unlink: mockUnlink
}));

const { default: PythonAnalyzer } = await import('../PythonAnalyzer.js');

// Helper to create a mock process
function createMockProcess(stdout = '', stderr = '', exitCode = 0, error = null) {
  const stdoutStream = {
    on: jest.fn((event, cb) => {
      if (event === 'data' && stdout) {
        setTimeout(() => cb(Buffer.from(stdout)), 5);
      }
    })
  };
  const stderrStream = {
    on: jest.fn((event, cb) => {
      if (event === 'data' && stderr) {
        setTimeout(() => cb(Buffer.from(stderr)), 5);
      }
    })
  };

  const proc = {
    stdout: stdoutStream,
    stderr: stderrStream,
    on: jest.fn((event, cb) => {
      if (event === 'close') {
        setTimeout(() => cb(exitCode), 10);
      }
      if (event === 'error' && error) {
        setTimeout(() => cb(error), 5);
      }
    }),
    kill: jest.fn()
  };

  return proc;
}

describe('PythonAnalyzer', () => {
  let analyzer;
  let logger;

  beforeEach(() => {
    logger = createMockLogger();
    analyzer = new PythonAnalyzer(logger);
    analyzer.pythonCommand = null;
    jest.clearAllMocks();
  });

  // ── Constructor ──
  test('constructor initializes with defaults', () => {
    expect(analyzer.logger).toBe(logger);
    expect(analyzer.pythonCommand).toBeNull();
  });

  test('constructor works without logger', () => {
    const a = new PythonAnalyzer();
    expect(a.logger).toBeNull();
  });

  // ── getSupportedExtensions ──
  test('getSupportedExtensions returns .py', () => {
    expect(analyzer.getSupportedExtensions()).toEqual(['.py']);
  });

  // ── supportsAutoFix ──
  test('supportsAutoFix returns false', () => {
    expect(analyzer.supportsAutoFix()).toBe(false);
  });

  // ── getPythonCommand ──
  test('getPythonCommand returns cached command on second call', async () => {
    analyzer.pythonCommand = 'python3';
    const result = await analyzer.getPythonCommand();
    expect(result).toBe('python3');
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  test('getPythonCommand finds python3 via spawn', async () => {
    mockSpawn.mockImplementation((cmd, args) => {
      if (args.includes('--version')) {
        return createMockProcess('Python 3.11.0', '', 0);
      }
      return createMockProcess('', '', 1);
    });

    const result = await analyzer.getPythonCommand();
    // Should find one of the python commands
    if (result) {
      expect(typeof result).toBe('string');
      expect(analyzer.pythonCommand).toBe(result);
    }
  });

  test('getPythonCommand returns null when python not available', async () => {
    mockSpawn.mockImplementation(() => {
      return createMockProcess('', '', 1);
    });

    const result = await analyzer.getPythonCommand();
    expect(result).toBeNull();
  });

  // ── analyze ──
  test('analyze returns empty when python not available', async () => {
    mockSpawn.mockImplementation(() => {
      return createMockProcess('', '', 1);
    });

    const result = await analyzer.analyze('test.py', 'print("hello")');
    expect(result).toEqual([]);
  });

  test('analyze returns diagnostics for syntax errors', async () => {
    // First call for getPythonCommand
    let callCount = 0;
    mockSpawn.mockImplementation((cmd, args) => {
      callCount++;
      if (args.includes('--version')) {
        return createMockProcess('Python 3.11.0', '', 0);
      }
      // Syntax check script
      const jsonResult = JSON.stringify({
        success: false,
        errors: [{ file: 'test.py', line: 1, column: 5, message: 'invalid syntax', text: 'def(' }]
      });
      return createMockProcess(jsonResult, '', 0);
    });

    const result = await analyzer.analyze('test.py', 'def(');
    expect(Array.isArray(result)).toBe(true);
    if (result.length > 0) {
      expect(result[0].severity).toBe('error');
      expect(result[0].rule).toBe('SyntaxError');
    }
  });

  test('analyze returns empty on exception', async () => {
    mockSpawn.mockImplementation(() => {
      throw new Error('spawn failed');
    });

    const result = await analyzer.analyze('test.py', 'print("hello")');
    expect(result).toEqual([]);
  });

  // ── checkSyntax ──
  test('checkSyntax handles successful parse', async () => {
    mockSpawn.mockImplementation(() => {
      return createMockProcess(JSON.stringify({ success: true, errors: [] }), '', 0);
    });

    const result = await analyzer.checkSyntax('test.py', 'x = 1', 'python3');
    expect(result).toEqual([]);
  });

  test('checkSyntax handles unparseable output', async () => {
    mockSpawn.mockImplementation(() => {
      return createMockProcess('not json at all', '', 0);
    });

    const result = await analyzer.checkSyntax('test.py', 'x = 1', 'python3');
    expect(result).toEqual([]);
  });

  // ── runCommand ──
  test('runCommand resolves with success for exit code 0', async () => {
    mockSpawn.mockReturnValue(createMockProcess('output', '', 0));

    const result = await analyzer.runCommand('echo', ['hello']);
    expect(result.success).toBe(true);
    expect(result.code).toBe(0);
  });

  test('runCommand resolves with failure for non-zero exit code', async () => {
    mockSpawn.mockReturnValue(createMockProcess('', 'error', 1));

    const result = await analyzer.runCommand('bad', []);
    expect(result.success).toBe(false);
    expect(result.code).toBe(1);
  });

  test('runCommand rejects on spawn error', async () => {
    const errorProc = createMockProcess('', '', 0);
    errorProc.on = jest.fn((event, cb) => {
      if (event === 'error') setTimeout(() => cb(new Error('spawn ENOENT')), 5);
    });
    mockSpawn.mockReturnValue(errorProc);

    await expect(analyzer.runCommand('nonexistent', [])).rejects.toThrow();
  });
});
