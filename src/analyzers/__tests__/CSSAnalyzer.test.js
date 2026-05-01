import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';
import CSSAnalyzer from '../CSSAnalyzer.js';

describe('CSSAnalyzer', () => {
  let logger;

  beforeEach(() => {
    logger = createMockLogger();
  });

  test('constructor creates instance', () => {
    const analyzer = new CSSAnalyzer(logger);
    expect(analyzer).toBeInstanceOf(CSSAnalyzer);
    expect(analyzer.logger).toBe(logger);
  });

  test('detectLanguage returns css for .css file', () => {
    const analyzer = new CSSAnalyzer(logger);
    expect(analyzer.detectLanguage('styles.css')).toBe('css');
  });

  test('detectLanguage returns scss for .scss file', () => {
    const analyzer = new CSSAnalyzer(logger);
    expect(analyzer.detectLanguage('styles.scss')).toBe('scss');
  });

  test('getSupportedExtensions returns array including .css', () => {
    const analyzer = new CSSAnalyzer(logger);
    const extensions = analyzer.getSupportedExtensions();
    expect(Array.isArray(extensions)).toBe(true);
    expect(extensions).toContain('.css');
    expect(extensions).toContain('.scss');
    expect(extensions).toContain('.less');
  });

  test('supportsAutoFix returns false', () => {
    const analyzer = new CSSAnalyzer(logger);
    expect(analyzer.supportsAutoFix()).toBe(false);
  });
});
