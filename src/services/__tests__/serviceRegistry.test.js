import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// Mock portRegistry to prevent file system access
jest.unstable_mockModule('../portRegistry.js', () => ({
  getPortRegistry: jest.fn(() => ({
    registerService: jest.fn().mockResolvedValue(undefined),
    unregisterService: jest.fn().mockResolvedValue(undefined),
    getAllServices: jest.fn().mockResolvedValue({}),
    getService: jest.fn().mockResolvedValue(null),
    cleanupStaleEntries: jest.fn().mockResolvedValue(undefined)
  }))
}));

const { ServiceRegistry, ServiceStatus, registry } = await import('../serviceRegistry.js');

describe('ServiceRegistry', () => {
  beforeEach(() => {
    // Clear any registered services between tests
    registry.clear();
  });

  test('ServiceStatus has STARTING, RUNNING, STOPPED values', () => {
    expect(ServiceStatus.STARTING).toBe('starting');
    expect(ServiceStatus.RUNNING).toBe('running');
    expect(ServiceStatus.STOPPED).toBe('stopped');
  });

  test('registry is a ServiceRegistry instance', () => {
    expect(registry).toBeInstanceOf(ServiceRegistry);
  });

  test('register adds a service retrievable by get', () => {
    const info = registry.register('test-service', {
      port: 3456,
      host: 'localhost',
      persistToFile: false
    });
    expect(info).toHaveProperty('name', 'test-service');
    expect(info).toHaveProperty('port', 3456);
    expect(info).toHaveProperty('url');

    const retrieved = registry.get('test-service');
    expect(retrieved).not.toBeNull();
    expect(retrieved.port).toBe(3456);
  });

  test('unregister removes the service', () => {
    registry.register('temp-service', { port: 9999, persistToFile: false });
    expect(registry.get('temp-service')).not.toBeNull();

    const removed = registry.unregister('temp-service', false);
    expect(removed).toBe(true);
    expect(registry.get('temp-service')).toBeNull();
  });

  test('getStats returns object with totalServices', () => {
    registry.register('svc-a', { port: 1111, persistToFile: false });
    registry.register('svc-b', { port: 2222, persistToFile: false });
    const stats = registry.getStats();
    expect(stats).toHaveProperty('totalServices');
    expect(stats.totalServices).toBe(2);
    expect(stats).toHaveProperty('runningServices');
  });

  test('clear removes all services', () => {
    registry.register('svc-1', { port: 4001, persistToFile: false });
    registry.register('svc-2', { port: 4002, persistToFile: false });
    expect(registry.getStats().totalServices).toBe(2);

    registry.clear();
    expect(registry.getStats().totalServices).toBe(0);
    expect(registry.get('svc-1')).toBeNull();
  });
});
