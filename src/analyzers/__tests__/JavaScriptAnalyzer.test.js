import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';
import JavaScriptAnalyzer from '../JavaScriptAnalyzer.js';

describe('JavaScriptAnalyzer', () => {
  let logger;

  beforeEach(() => {
    logger = createMockLogger();
  });

  test('constructor creates instance', () => {
    const analyzer = new JavaScriptAnalyzer(logger);
    expect(analyzer).toBeInstanceOf(JavaScriptAnalyzer);
    expect(analyzer.logger).toBe(logger);
  });

  test('analyze with valid JS returns array', async () => {
    const analyzer = new JavaScriptAnalyzer(logger);
    const result = await analyzer.analyze('test.js', 'const x = 1;\nconsole.log(x);');
    expect(Array.isArray(result)).toBe(true);
  });

  test('analyze with syntax error JS returns diagnostics', async () => {
    const analyzer = new JavaScriptAnalyzer(logger);
    const result = await analyzer.analyze('broken.js', 'function( { {{');
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    // Each diagnostic should have standard fields
    const first = result[0];
    expect(first).toHaveProperty('severity');
    expect(first).toHaveProperty('message');
  });

  test('analyze returns array even for empty content', async () => {
    const analyzer = new JavaScriptAnalyzer(logger);
    const result = await analyzer.analyze('empty.js', '');
    expect(Array.isArray(result)).toBe(true);
  });
});
