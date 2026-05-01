/**
 * ModelsService — local manifest tests for the OSS edition.
 */

import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';
import ModelsService from '../modelsService.js';

describe('ModelsService — local manifest', () => {
  let logger;

  beforeEach(() => { logger = createMockLogger(); });

  test('loads the shipped default manifest on initialize', async () => {
    // The default manifest only carries Anthropic entries — Anthropic
    // has no public /models endpoint, so the manifest is the only
    // catalog source for that provider. Live discovery fills in the
    // rest at runtime when a key is configured.
    const svc = new ModelsService({}, logger);
    await svc.initialize();
    const models = svc.getModels();
    expect(models.length).toBeGreaterThan(0);
    const providers = new Set(models.map(m => m.provider));
    expect(providers.has('anthropic')).toBe(true);
    // Models we expect to ship in the manifest:
    const names = models.map(m => m.name);
    expect(names).toContain('claude-opus-4-7');
    expect(names).toContain('claude-sonnet-4-6');
    expect(names).toContain('claude-haiku-4-5');
  });

  test('LOXIA_MODELS_PATH env var overrides default manifest', async () => {
    const tmpPath = path.join(os.tmpdir(), `onbuzz-test-models-${Date.now()}.json`);
    await fs.writeFile(tmpPath, JSON.stringify({
      models: [
        { name: 'test-model', provider: 'test', displayName: 'Test', contextWindow: 1000 },
      ],
    }));
    const original = process.env.LOXIA_MODELS_PATH;
    process.env.LOXIA_MODELS_PATH = tmpPath;
    try {
      const svc = new ModelsService({}, logger);
      await svc.initialize();
      expect(svc.getModels()).toEqual([
        { name: 'test-model', provider: 'test', displayName: 'Test', contextWindow: 1000 },
      ]);
    } finally {
      process.env.LOXIA_MODELS_PATH = original;
      await fs.unlink(tmpPath).catch(() => {});
    }
  });

  test('config.modelsPath overrides default manifest', async () => {
    const tmpPath = path.join(os.tmpdir(), `onbuzz-test-models-${Date.now()}.json`);
    await fs.writeFile(tmpPath, JSON.stringify({
      models: [{ name: 'config-test', provider: 'x', displayName: 'C', contextWindow: 100 }],
    }));
    try {
      const svc = new ModelsService({ modelsPath: tmpPath }, logger);
      await svc.initialize();
      expect(svc.getModels()).toHaveLength(1);
      expect(svc.getModels()[0].name).toBe('config-test');
    } finally {
      await fs.unlink(tmpPath).catch(() => {});
    }
  });

  test('merge: live wins on existence, manifest enriches metadata', async () => {
    // claude-haiku-4-5 appears in both live + manifest. The live entry's
    // identity (display name, context window) wins, while the manifest's
    // pricing / tier / recommended_for fields enrich it.
    const svc = new ModelsService({}, logger);
    svc.setAIService({
      getProviderRegistry: () => ({
        listAllModels: async () => [
          { name: 'claude-haiku-4-5', provider: 'anthropic', displayName: 'Claude Haiku 4.5 (live)', contextWindow: 99999 },
          { name: 'live-only-foo',    provider: 'anthropic', displayName: 'Live-only foo',          contextWindow: 12345 },
        ],
      }),
    });
    await svc.initialize();
    const byName = Object.fromEntries(svc.getModels().map(m => [m.name, m]));
    // Live entry wins on identity
    expect(byName['claude-haiku-4-5'].displayName).toBe('Claude Haiku 4.5 (live)');
    expect(byName['claude-haiku-4-5'].contextWindow).toBe(99999);
    // Manifest metadata is preserved (pricing / tier come from config/models.default.json)
    expect(byName['claude-haiku-4-5'].pricing).toEqual({ input: 0.8, output: 4 });
    expect(byName['claude-haiku-4-5'].tier).toBe('budget');
    // Live-only entries are kept
    expect(byName['live-only-foo']?.displayName).toBe('Live-only foo');
  });

  test('merge: drops manifest entries for providers that returned live data when those names are not live (deprecated models)', async () => {
    // Simulates Gemini retiring `gemini-1.5-pro`: live API returns the
    // current set without it, so the manifest entry must be dropped to
    // prevent users from picking a model that 404s.
    const svc = new ModelsService({}, logger);
    svc.setAIService({
      getProviderRegistry: () => ({
        listAllModels: async () => [
          { name: 'gemini-2.0-flash', provider: 'gemini', displayName: 'Gemini 2.0 Flash', contextWindow: 1048576 },
          // no gemini-1.5-pro — Google retired it
        ],
      }),
    });
    await svc.initialize();
    const names = svc.getModels().map(m => m.name);
    expect(names).toContain('gemini-2.0-flash');
    expect(names).not.toContain('gemini-1.5-pro'); // dropped
  });

  test('merge: keeps manifest entries for providers without live data (e.g. Anthropic — no /models endpoint)', async () => {
    // Anthropic's listModels returns []; the manifest is the only catalog
    // source so the entries must survive even when other providers
    // return live data.
    const svc = new ModelsService({}, logger);
    svc.setAIService({
      getProviderRegistry: () => ({
        listAllModels: async () => [
          { name: 'gpt-4o', provider: 'openai', displayName: 'GPT-4o', contextWindow: 128000 },
          // anthropic returns nothing live
        ],
      }),
    });
    await svc.initialize();
    const names = svc.getModels().map(m => m.name);
    expect(names).toContain('claude-opus-4-7');     // from manifest
    expect(names).toContain('claude-sonnet-4-6');   // from manifest
    expect(names).toContain('gpt-4o');              // from live
  });

  test('getStatus reports loaded state', async () => {
    const svc = new ModelsService({}, logger);
    expect(svc.getStatus().initialized).toBe(false);
    await svc.initialize();
    const status = svc.getStatus();
    expect(status.initialized).toBe(true);
    expect(status.modelCount).toBeGreaterThan(0);
    expect(status.lastFetched).not.toBeNull();
  });

  test('getAvailableModelNames returns names only', async () => {
    const svc = new ModelsService({}, logger);
    await svc.initialize();
    const names = svc.getAvailableModelNames();
    expect(names.length).toBe(svc.getModels().length);
    expect(names.every(n => typeof n === 'string')).toBe(true);
  });
});
