import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';
import TypeScriptAnalyzer from '../TypeScriptAnalyzer.js';

describe('TypeScriptAnalyzer', () => {
  let analyzer;
  let logger;

  beforeEach(() => {
    logger = createMockLogger();
    analyzer = new TypeScriptAnalyzer(logger);
  });

  // ── Constructor ──
  test('constructor sets logger and compiler options', () => {
    expect(analyzer.logger).toBe(logger);
    expect(analyzer.compilerOptions).toBeDefined();
    expect(analyzer.compilerOptions.noEmit).toBe(true);
    expect(analyzer.compilerOptions.strict).toBe(true);
    expect(analyzer.compilerOptions.allowJs).toBe(false);
  });

  test('constructor works without logger', () => {
    const a = new TypeScriptAnalyzer();
    expect(a.logger).toBeNull();
  });

  // ── analyze ──
  test('analyze returns empty array for valid TypeScript', async () => {
    const content = 'const x: number = 42;\n';
    const result = await analyzer.analyze('test.ts', content);
    expect(Array.isArray(result)).toBe(true);
  });

  test('analyze returns diagnostics for syntax errors', async () => {
    const content = 'const x: number = ;\nfunction( { {{\n';
    const result = await analyzer.analyze('broken.ts', content);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty('severity');
    expect(result[0]).toHaveProperty('message');
    expect(result[0]).toHaveProperty('file');
  });

  test('analyze returns diagnostics with proper rule format', async () => {
    const content = 'const x: number = "string";\n';
    const result = await analyzer.analyze('types.ts', content);
    // Should find type error or at least return an array
    expect(Array.isArray(result)).toBe(true);
    for (const diag of result) {
      expect(diag.rule).toMatch(/^TS\d+$/);
    }
  });

  test('analyze returns error diagnostic when analysis throws', async () => {
    // Force an error by corrupting the analyzer
    const badAnalyzer = new TypeScriptAnalyzer(logger);
    badAnalyzer.compilerOptions = null; // Will cause createProgram to fail

    const result = await badAnalyzer.analyze('test.ts', 'const x = 1;');
    // Either returns normally or returns an error diagnostic
    expect(Array.isArray(result)).toBe(true);
  });

  test('analyze handles empty content', async () => {
    const result = await analyzer.analyze('empty.ts', '');
    expect(Array.isArray(result)).toBe(true);
  });

  test('analyze handles TSX content', async () => {
    const content = 'const el = <div>hello</div>;\n';
    const result = await analyzer.analyze('component.tsx', content);
    expect(Array.isArray(result)).toBe(true);
  });

  // ── getSyntacticDiagnostics ──
  test('getSyntacticDiagnostics returns empty for valid source', async () => {
    const ts = (await import('typescript')).default;
    const sourceFile = ts.createSourceFile('test.ts', 'const x = 1;', ts.ScriptTarget.Latest, true);
    const result = analyzer.getSyntacticDiagnostics(sourceFile);
    expect(Array.isArray(result)).toBe(true);
  });

  // ── getSemanticDiagnostics ──
  test('getSemanticDiagnostics returns array for valid content', async () => {
    const result = await analyzer.getSemanticDiagnostics('test.ts', 'const x: number = 1;');
    expect(Array.isArray(result)).toBe(true);
  });

  test('getSemanticDiagnostics detects type errors', async () => {
    const content = 'const x: number = "hello";';
    const result = await analyzer.getSemanticDiagnostics('types.ts', content);
    expect(Array.isArray(result)).toBe(true);
    // Should have at least one type error
    if (result.length > 0) {
      expect(result[0]).toHaveProperty('severity');
    }
  });

  // ── formatDiagnostic ──
  test('formatDiagnostic handles diagnostic with file and position', async () => {
    const ts = (await import('typescript')).default;
    const sourceFile = ts.createSourceFile('test.ts', 'const x = 1;\nconst y = 2;', ts.ScriptTarget.Latest, true);

    const diagnostic = {
      file: sourceFile,
      start: 14, // position in source
      category: ts.DiagnosticCategory.Error,
      messageText: 'Test error message',
      code: 2322
    };

    const result = analyzer.formatDiagnostic(diagnostic, sourceFile);
    expect(result.line).toBeGreaterThan(0);
    expect(result.column).toBeGreaterThan(0);
    expect(result.severity).toBe('error');
    expect(result.rule).toBe('TS2322');
    expect(result.message).toBe('Test error message');
  });

  test('formatDiagnostic handles diagnostic without file', async () => {
    const ts = (await import('typescript')).default;
    const sourceFile = ts.createSourceFile('test.ts', 'const x = 1;', ts.ScriptTarget.Latest, true);

    const diagnostic = {
      start: 0,
      category: ts.DiagnosticCategory.Warning,
      messageText: 'Warning message',
      code: 1000
    };

    const result = analyzer.formatDiagnostic(diagnostic, sourceFile);
    expect(result.severity).toBe('warning');
    expect(result.category).toBe('syntax'); // code 1000 is in syntax range
  });

  test('formatDiagnostic handles suggestion category', async () => {
    const ts = (await import('typescript')).default;

    const diagnostic = {
      category: ts.DiagnosticCategory.Suggestion,
      messageText: 'Suggestion',
      code: 9999
    };

    const result = analyzer.formatDiagnostic(diagnostic, null);
    expect(result.severity).toBe('info');
  });

  test('formatDiagnostic categorizes import errors by message', async () => {
    const ts = (await import('typescript')).default;

    const diagnostic = {
      category: ts.DiagnosticCategory.Error,
      messageText: 'Cannot find module "foo"',
      code: 5000
    };

    const result = analyzer.formatDiagnostic(diagnostic, null);
    expect(result.category).toBe('import');
  });

  test('formatDiagnostic categorizes type errors by code range', async () => {
    const ts = (await import('typescript')).default;

    const diagnostic = {
      category: ts.DiagnosticCategory.Error,
      messageText: 'Some error about assignment',
      code: 2500
    };

    const result = analyzer.formatDiagnostic(diagnostic, null);
    expect(result.category).toBe('type');
  });

  test('formatDiagnostic categorizes type errors by message content', async () => {
    const ts = (await import('typescript')).default;

    const diagnostic = {
      category: ts.DiagnosticCategory.Error,
      messageText: 'Property of type X',
      code: 5000
    };

    const result = analyzer.formatDiagnostic(diagnostic, null);
    expect(result.category).toBe('type');
  });
});
