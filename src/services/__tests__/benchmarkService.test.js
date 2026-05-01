/**
 * BenchmarkService — local manifest tests for the OSS edition.
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';
import BenchmarkService from '../benchmarkService.js';

describe('BenchmarkService — local manifest', () => {
  let logger;

  beforeEach(() => { logger = createMockLogger(); });

  test('loads default manifest on initialize', async () => {
    const svc = new BenchmarkService({}, logger);
    await svc.initialize();
    const text = svc.getBenchmarks();
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatch(/Model selection guide/i);
  });

  test('LOXIA_BENCHMARKS_PATH env var overrides default', async () => {
    const tmpPath = path.join(os.tmpdir(), `onbuzz-test-bench-${Date.now()}.json`);
    await fs.writeFile(tmpPath, JSON.stringify({ benchmarkText: 'CUSTOM_BENCHMARK_TEXT' }));
    const original = process.env.LOXIA_BENCHMARKS_PATH;
    process.env.LOXIA_BENCHMARKS_PATH = tmpPath;
    try {
      const svc = new BenchmarkService({}, logger);
      await svc.initialize();
      expect(svc.getBenchmarks()).toBe('CUSTOM_BENCHMARK_TEXT');
    } finally {
      process.env.LOXIA_BENCHMARKS_PATH = original;
      await fs.unlink(tmpPath).catch(() => {});
    }
  });

  test('config.benchmarksPath overrides default', async () => {
    const tmpPath = path.join(os.tmpdir(), `onbuzz-test-bench-${Date.now()}.json`);
    await fs.writeFile(tmpPath, JSON.stringify({ benchmarkText: 'FROM_CONFIG' }));
    try {
      const svc = new BenchmarkService({ benchmarksPath: tmpPath }, logger);
      await svc.initialize();
      expect(svc.getBenchmarks()).toBe('FROM_CONFIG');
    } finally {
      await fs.unlink(tmpPath).catch(() => {});
    }
  });

  test('getBenchmarkTable is an alias of getBenchmarks', async () => {
    const svc = new BenchmarkService({}, logger);
    await svc.initialize();
    expect(svc.getBenchmarkTable()).toBe(svc.getBenchmarks());
  });

  test('getStatus reports loaded state', async () => {
    const svc = new BenchmarkService({}, logger);
    expect(svc.getStatus().initialized).toBe(false);
    await svc.initialize();
    expect(svc.getStatus().initialized).toBe(true);
    expect(svc.getStatus().lastUpdated).not.toBeNull();
  });
});
