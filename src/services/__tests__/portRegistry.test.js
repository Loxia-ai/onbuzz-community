import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const fsMock = {
  readFile: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
  rename: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
  stat: jest.fn()
};

jest.unstable_mockModule('fs', () => ({
  promises: fsMock
}));

jest.unstable_mockModule('../../utilities/userDataDir.js', () => ({
  getUserDataPaths: jest.fn().mockReturnValue({
    runtime: '/tmp/test-runtime',
    config: '/tmp/test-config'
  })
}));

const { PortRegistry, getPortRegistry } = await import('../portRegistry.js');

describe('PortRegistry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Return empty registry by default (ENOENT simulates first run)
    fsMock.readFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  });

  test('constructor creates instance', () => {
    const registry = new PortRegistry();
    expect(registry).toBeInstanceOf(PortRegistry);
    expect(registry._initialized).toBe(false);
  });

  test('getPortRegistry returns singleton (same instance)', () => {
    // Note: singleton is module-scoped, so both calls return the same instance
    const a = getPortRegistry();
    const b = getPortRegistry();
    expect(a).toBe(b);
    expect(a).toBeInstanceOf(PortRegistry);
  });

  test('registerService stores service info with port', async () => {
    const registry = new PortRegistry();
    const result = await registry.registerService('backend', { port: 3000 });

    expect(result).toBeDefined();
    expect(result.port).toBe(3000);
    expect(result.host).toBe('localhost');
    expect(result.protocol).toBe('http');
    expect(fsMock.writeFile).toHaveBeenCalled();
  });

  test('getService returns registered service', async () => {
    const registry = new PortRegistry();

    // First register
    await registry.registerService('api', { port: 8080 });

    // Mock readFile to return the saved data
    const savedData = JSON.stringify({
      version: 1,
      lastUpdated: new Date().toISOString(),
      services: {
        api: { port: 8080, host: 'localhost', protocol: 'http', pid: process.pid, startedAt: new Date().toISOString(), metadata: {} }
      }
    });
    fsMock.readFile.mockResolvedValue(savedData);

    const service = await registry.getService('api');
    expect(service).toBeDefined();
    expect(service.port).toBe(8080);
  });

  test('getService returns null for unknown name', async () => {
    const registry = new PortRegistry();
    const service = await registry.getService('nonexistent');
    expect(service).toBeNull();
  });

  test('unregisterService removes service', async () => {
    const registry = new PortRegistry();

    // Mock a registry with a service
    const savedData = JSON.stringify({
      version: 1,
      lastUpdated: new Date().toISOString(),
      services: {
        myservice: { port: 4000, host: 'localhost', protocol: 'http', pid: process.pid, startedAt: new Date().toISOString(), metadata: {} }
      }
    });
    fsMock.readFile.mockResolvedValue(savedData);

    const result = await registry.unregisterService('myservice');
    expect(result).toBe(true);
  });

  test('getServiceUrl builds URL from protocol/host/port', async () => {
    const registry = new PortRegistry();

    const savedData = JSON.stringify({
      version: 1,
      lastUpdated: new Date().toISOString(),
      services: {
        web: { port: 443, host: 'example.com', protocol: 'https', pid: process.pid, startedAt: new Date().toISOString(), metadata: {} }
      }
    });
    fsMock.readFile.mockResolvedValue(savedData);

    const url = await registry.getServiceUrl('web');
    expect(url).toBe('https://example.com:443');
  });

  test('isProcessRunning returns boolean (test with current process.pid)', () => {
    const registry = new PortRegistry();
    const running = registry.isProcessRunning(process.pid);
    expect(typeof running).toBe('boolean');
    expect(running).toBe(true);
  });
});
