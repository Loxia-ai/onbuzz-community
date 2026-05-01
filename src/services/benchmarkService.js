/**
 * BenchmarkService — local-first benchmark/routing-guidance text.
 *
 * The OSS edition reads its benchmark text from a static JSON manifest
 * (`config/benchmarks.default.json`). Users can override via:
 *   - LOXIA_BENCHMARKS_PATH environment variable
 *   - config.benchmarksPath (set by config file)
 *   - ~/.onbuzz/benchmarks.json
 *
 * The benchmark text is consumed verbatim by the model router prompt,
 * so authors can update it to reflect their own routing preferences
 * without touching code.
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const DEFAULT_MANIFEST_PATH = path.join(__dirname, '..', '..', 'config', 'benchmarks.default.json');

class BenchmarkService {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;

    this.benchmarkText = null;
    this.lastUpdated = null;
    this.isLoading = false;
  }

  async initialize() {
    try {
      await this.loadBenchmarks();
      this.logger?.info('Benchmark service initialized');
    } catch (error) {
      this.logger?.error('Failed to initialize benchmark service', { error: error.message });
    }
  }

  getBenchmarks() {
    if (!this.benchmarkText) {
      this.logger?.warn('No benchmark data available');
      return null;
    }
    return this.benchmarkText;
  }

  getBenchmarkTable() { return this.getBenchmarks(); }

  async loadBenchmarks() {
    this.isLoading = true;
    try {
      const candidates = [
        process.env.LOXIA_BENCHMARKS_PATH,
        this.config.benchmarksPath,
        path.join(os.homedir(), '.onbuzz', 'benchmarks.json'),
        DEFAULT_MANIFEST_PATH,
      ].filter(Boolean);

      for (const p of candidates) {
        try {
          const raw = await fs.readFile(p, 'utf8');
          const data = JSON.parse(raw);
          if (typeof data.benchmarkText === 'string' && data.benchmarkText.length > 0) {
            this.benchmarkText = data.benchmarkText;
            this.lastUpdated = new Date();
            this.logger?.debug('Loaded benchmarks', { path: p });
            return;
          }
        } catch (e) {
          if (e.code !== 'ENOENT') {
            this.logger?.warn('Failed to read benchmark manifest candidate', { path: p, error: e.message });
          }
        }
      }
      this.logger?.warn('No benchmark manifest found — router will run without benchmark guidance');
      this.benchmarkText = null;
    } finally {
      this.isLoading = false;
    }
  }

  async refresh() { await this.loadBenchmarks(); }

  getStatus() {
    return {
      initialized: !!this.benchmarkText,
      lastUpdated: this.lastUpdated?.toISOString() || null,
      hasData:     !!this.benchmarkText,
    };
  }
}

export default BenchmarkService;
