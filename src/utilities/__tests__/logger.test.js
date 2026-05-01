import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';

// Mock constants before importing Logger
jest.unstable_mockModule('../constants.js', () => ({
  SYSTEM_VERSION: '1.0.0-test'
}));

const { Logger, createLogger } = await import('../logger.js');

describe('Logger', () => {
  let consoleSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  test('constructor with no args creates logger with default level info', () => {
    const logger = new Logger();
    expect(logger).toBeInstanceOf(Logger);
    expect(logger.currentLevel).toBe(logger.levels['info']);
    expect(logger.outputs).toEqual(['console']);
  });

  test('constructor with level=error only logs errors', () => {
    const logger = new Logger({ level: 'error' });
    expect(logger.currentLevel).toBe(0);

    logger.error('error msg');
    logger.warn('warn msg');
    logger.info('info msg');

    // error goes to console.error, warn/info would go to console.log
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledTimes(0);
  });

  test('info() calls log() internally', () => {
    const logger = new Logger();
    const logSpy = jest.spyOn(logger, 'log');
    logger.info('test message', { key: 'val' });

    expect(logSpy).toHaveBeenCalledWith('info', 'test message', { key: 'val' });
    logSpy.mockRestore();
  });

  test('error() logs error level messages via console.error', () => {
    const logger = new Logger();
    logger.error('something broke');

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0][0]).toContain('something broke');
  });

  test('debug() is suppressed when level is info', () => {
    const logger = new Logger({ level: 'info' });
    logger.debug('debug detail');

    expect(consoleSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  test('setLevel changes the active log level', () => {
    const logger = new Logger({ level: 'info' });
    expect(logger.currentLevel).toBe(2);

    logger.setLevel('debug');
    expect(logger.currentLevel).toBe(3);

    // Now debug messages should be logged
    consoleSpy.mockClear();
    logger.debug('now visible');
    expect(consoleSpy).toHaveBeenCalled();
  });

  test('child() returns a new logger inheriting parent settings', () => {
    const parent = new Logger({ level: 'debug' });
    const child = parent.child({ component: 'test-child' });

    expect(child).not.toBe(parent);
    expect(child.childContext).toEqual({ component: 'test-child' });
    // Child should inherit parent level
    expect(child.currentLevel).toBe(parent.currentLevel);
  });

  test('createLogger returns Logger instance', () => {
    const logger = createLogger({ level: 'warn', autoInit: false });
    expect(logger).toBeInstanceOf(Logger);
    expect(logger.currentLevel).toBe(logger.levels['warn']);
  });

  test('logToolExecution uses error level when status is failed', () => {
    const logger = new Logger();
    const errorSpy = jest.spyOn(logger, 'error');
    const infoSpy = jest.spyOn(logger, 'info');

    logger.logToolExecution('tool-1', 'op-1', 'failed', 500);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    infoSpy.mockRestore();
  });

  test('logApiRequest uses error level when status >= 400', () => {
    const logger = new Logger();
    const errorSpy = jest.spyOn(logger, 'error');
    const infoSpy = jest.spyOn(logger, 'info');

    logger.logApiRequest('GET', '/api/data', 500, 120);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    errorSpy.mockClear();
    infoSpy.mockClear();

    logger.logApiRequest('GET', '/api/data', 200, 80);
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    infoSpy.mockRestore();
  });
});
