/**
 * ModelsService — local-first model catalog.
 *
 * The OSS edition reads its model catalog from a JSON manifest shipped
 * with the package (`config/models.default.json`). Users can override
 * via:
 *   - LOXIA_MODELS_PATH environment variable (absolute path)
 *   - config.modelsPath (set by config file)
 *   - ~/.onbuzz/models.json (user override file)
 *
 * On top of the static manifest, providers with reachable APIs can also
 * report live models via their listModels() — those are merged in
 * de-duplicated by `name`.
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const DEFAULT_MANIFEST_PATH = path.join(__dirname, '..', '..', 'config', 'models.default.json');

class ModelsService {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;

    this.models = null;
    this.lastFetched = null;
    this.isLoading = false;

    this.aiService = null; // wired in by LoxiaApplication for live provider model lists
  }

  /**
   * Set AIService reference so listModels can pull live models from
   * the provider registry when it's available.
   */
  setAIService(aiService) { this.aiService = aiService; }

  setApiKeyManager(apiKeyManager) { this.apiKeyManager = apiKeyManager; }

  /** Initialize: load the static manifest and merge live provider models. */
  async initialize() {
    try {
      await this.loadModels();
      this.logger?.info('Models service initialized', { modelCount: this.models?.length || 0 });
    } catch (error) {
      this.logger?.error('Failed to initialize models service', { error: error.message });
      this.models = [];
    }
  }

  /**
   * Load and merge the model catalog from live provider APIs + the
   * static manifest.
   *
   * Merge policy: **live wins on availability, manifest enriches.**
   *
   *   - For each provider that returns live models, those are the
   *     authoritative list. Manifest entries for the same provider that
   *     don't appear live are dropped (they're either deprecated or the
   *     name in the manifest is wrong).
   *   - For each provider that returns NO live models (no key set, or
   *     the vendor doesn't expose a list endpoint — e.g. Anthropic),
   *     manifest entries are used as the fallback catalog so users with
   *     a key can still see and pick those models.
   *   - For models that exist in BOTH sources, the manifest's metadata
   *     (pricing, tier, recommended_for, displayName) enriches the
   *     live entry — vendor /models endpoints don't expose those
   *     fields.
   */
  async loadModels() {
    this.isLoading = true;
    try {
      const fromManifest = await this._loadManifest();
      let fromProviders = [];
      try {
        if (this.aiService?.getProviderRegistry) {
          fromProviders = await this.aiService.getProviderRegistry().listAllModels();
        }
      } catch (e) {
        this.logger?.debug('Live provider model fetch failed', { error: e.message });
      }

      // Index live models by name for O(1) lookup, and track which
      // providers reported any live data so we know whether to fall
      // back to manifest entries for them.
      const liveByName = new Map();
      const providersWithLiveData = new Set();
      for (const m of fromProviders) {
        liveByName.set(m.name, m);
        if (m.provider) providersWithLiveData.add(m.provider);
      }

      // Index manifest entries by name for enrichment lookup.
      const manifestByName = new Map();
      for (const m of fromManifest) manifestByName.set(m.name, m);

      const merged = new Map();

      // Pass 1: every live entry, enriched from manifest if we have it.
      for (const live of fromProviders) {
        const enrichment = manifestByName.get(live.name) || {};
        merged.set(live.name, { ...enrichment, ...live });
      }

      // Pass 2: manifest entries for providers WITHOUT live data —
      // either no key, or the vendor has no list endpoint.
      for (const m of fromManifest) {
        if (merged.has(m.name)) continue;                   // already added (live)
        if (providersWithLiveData.has(m.provider)) continue; // dropped: not live for this provider
        merged.set(m.name, m);
      }

      this.models = Array.from(merged.values());
      this.lastFetched = new Date();
      this.logger?.info('Models loaded', {
        manifestCount:      fromManifest.length,
        providerCount:      fromProviders.length,
        providersWithLive:  Array.from(providersWithLiveData),
        droppedFromManifest: fromManifest.filter(
          m => providersWithLiveData.has(m.provider) && !liveByName.has(m.name)
        ).map(m => m.name),
        totalCount:         this.models.length,
      });
    } finally {
      this.isLoading = false;
    }
  }

  /** Load the static manifest, preferring the override file when present. */
  async _loadManifest() {
    const candidates = [
      process.env.LOXIA_MODELS_PATH,
      this.config.modelsPath,
      path.join(os.homedir(), '.onbuzz', 'models.json'),
      DEFAULT_MANIFEST_PATH,
    ].filter(Boolean);

    for (const p of candidates) {
      try {
        const raw = await fs.readFile(p, 'utf8');
        const data = JSON.parse(raw);
        if (Array.isArray(data.models)) {
          this.logger?.debug('Loaded model manifest', { path: p, count: data.models.length });
          return data.models;
        }
      } catch (e) {
        if (e.code !== 'ENOENT') {
          this.logger?.warn('Failed to read model manifest candidate', { path: p, error: e.message });
        }
      }
    }
    this.logger?.warn('No model manifest found — catalog will be empty until providers report live models');
    return [];
  }

  /** Get all model entries. */
  getModels() { return this.models || []; }

  /** Get just the names (for routing). */
  getAvailableModelNames() { return (this.models || []).map(m => m.name); }

  /** Force a refresh from disk + live providers. */
  async refresh() { await this.loadModels(); }

  /** Status payload for diagnostics endpoints. */
  getStatus() {
    return {
      initialized: !!this.models,
      lastFetched: this.lastFetched?.toISOString() || null,
      modelCount:  this.models?.length || 0,
      isLoading:   this.isLoading,
    };
  }
}

export default ModelsService;
