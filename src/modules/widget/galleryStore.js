/**
 * Gallery Store — persistent, cross-session catalog of shared widget
 * templates. Backed by a single JSON file in the user's Loxia home
 * directory; loaded on first use, persisted on every write (debounced).
 *
 * Design choices:
 *
 *   - Frozen-at-share semantics. Each share creates a new, immutable
 *     templateId. Re-sharing the same widget bumps a new templateId
 *     (or version, see below) but never mutates an existing one. This
 *     gives reproducibility — old chats keep rendering the version
 *     they originally used.
 *
 *   - Versioned per-template. A second share of the same widget under
 *     the same `kind`/`title` increments the template's `version`
 *     integer. The frontend later shows an "upgrade available" badge
 *     to consumers (Phase 4).
 *
 *   - Single user, single file. SQLite would be more robust but
 *     overkill for a few-hundred-entry library. Sub-megabyte JSON is
 *     fine. Atomic write via .tmp + rename to avoid corruption.
 *
 * Public API (used by widgetTool):
 *
 *   share(widget, { agentId, agentName, sessionId }) → templateId
 *   unshare(templateId)
 *   list({ tag, agentId? } = {})
 *   get(templateId)
 *   bumpRenderCount(templateId)         // metric for "popular" templates
 *
 * The actual file path is configurable so tests can use a temp dir.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DEFAULT_FILE_PATH = path.join(os.homedir(), '.loxia', 'widget-gallery.json');

const VERSION_SCHEMA = 1;

function safeSlug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Generate a templateId. Format: `<slugified-title>-<version>-<rand>`.
 * Random suffix avoids collisions when two widgets share a title.
 */
function generateTemplateId(title, version) {
  const slug = safeSlug(title) || 'widget';
  const rand = Math.random().toString(36).slice(2, 6);
  return `${slug}-v${version}-${rand}`;
}

export class GalleryStore {
  /**
   * @param {object} [opts]
   * @param {string} [opts.filePath]  Custom JSON file path (tests override this).
   * @param {number} [opts.persistDebounceMs=200]  Coalesce writes by this delay.
   * @param {object} [opts.logger]
   */
  constructor(opts = {}) {
    this.filePath = opts.filePath || DEFAULT_FILE_PATH;
    this.persistDebounceMs = opts.persistDebounceMs ?? 200;
    this.logger = opts.logger || { info() {}, warn() {}, error() {}, debug() {} };

    /** @type {Map<string, GalleryEntry>} */
    this._entries = new Map();
    this._loaded = false;
    this._loadPromise = null;
    this._persistTimer = null;
    this._persistInFlight = null;
    // Monotonic sequence used as a stable tiebreaker when two entries
    // share the same sharedAt millisecond (which happens easily in
    // tests and on fast machines). Always increments; never persisted
    // (insertion order from the file is used to seed it on load).
    this._seq = 0;
  }

  /**
   * Lazy load. Idempotent — subsequent calls return the same promise.
   * Safe to call multiple times concurrently.
   */
  async load() {
    if (this._loaded) return;
    if (this._loadPromise) return this._loadPromise;
    this._loadPromise = (async () => {
      try {
        const raw = await fs.readFile(this.filePath, 'utf-8');
        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object') throw new Error('not an object');
        if (data.schema !== VERSION_SCHEMA) {
          this.logger.warn('Gallery file has unexpected schema, ignoring', {
            filePath: this.filePath, found: data.schema, expected: VERSION_SCHEMA,
          });
          this._entries = new Map();
        } else if (Array.isArray(data.entries)) {
          // Seed entries; preserve _seq if persisted, otherwise re-stamp
          // in load order (newer entries get higher seq).
          this._entries = new Map();
          let maxSeq = 0;
          for (const e of data.entries) {
            if (typeof e._seq !== 'number') e._seq = ++this._seq;
            else if (e._seq > maxSeq) maxSeq = e._seq;
            this._entries.set(e.templateId, e);
          }
          if (maxSeq > this._seq) this._seq = maxSeq;
        }
      } catch (err) {
        if (err.code !== 'ENOENT') {
          // Treat parse/IO errors as "fresh start" — better than crashing.
          this.logger.warn('Gallery load failed, starting empty', {
            filePath: this.filePath, error: err.message,
          });
        }
        this._entries = new Map();
      }
      this._loaded = true;
    })();
    return this._loadPromise;
  }

  /**
   * Schedule a debounced persist. Multiple writes within the debounce
   * window result in a single disk write.
   */
  _scheduleWrite() {
    if (this._persistTimer) clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this._persistInFlight = this._writeNow().catch(err => {
        this.logger.error('Gallery persist failed', { error: err.message });
      });
    }, this.persistDebounceMs);
  }

  /**
   * Awaitable — useful for tests and shutdown hooks.
   */
  async flush() {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
      await this._writeNow();
    }
    if (this._persistInFlight) {
      await this._persistInFlight;
      this._persistInFlight = null;
    }
  }

  async _writeNow() {
    const dir = path.dirname(this.filePath);
    try { await fs.mkdir(dir, { recursive: true }); } catch { /* race-tolerant */ }
    // Per-call unique tmp suffix so two concurrent writes (debounce+flush
    // racing, or any future caller) can't trample each other's tmp file.
    // The earlier static `.tmp` suffix produced ENOENT under parallel test
    // load on Windows: writer A renamed first, writer B saw its own tmp
    // disappear before its rename ran.
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    const payload = JSON.stringify({
      schema: VERSION_SCHEMA,
      entries: Array.from(this._entries.values()),
    }, null, 2);
    await fs.writeFile(tmp, payload, 'utf-8');
    // Windows-fs renames intermittently fail with EPERM / EBUSY when an
    // antivirus scanner or another process briefly holds the destination
    // open. A short retry loop covers both production users on Windows
    // and the parallel-jest workers that surface this most often.
    let lastErr;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await fs.rename(tmp, this.filePath);
        return;
      } catch (err) {
        lastErr = err;
        // ENOENT means our tmp already vanished — give up; the source
        // file is gone, retrying won't recreate it. Other transients
        // (EPERM/EBUSY/EACCES) get a brief backoff.
        if (err.code === 'ENOENT') break;
        await new Promise(r => setTimeout(r, 20 * (attempt + 1)));
      }
    }
    // Best-effort cleanup of stranded tmp; ignore failure.
    try { await fs.unlink(tmp); } catch { /* ok */ }
    throw lastErr;
  }

  /**
   * Share a widget to the gallery. Each share creates a new template
   * with a fresh templateId — there is no in-place mutation. If the
   * agent has shared widgets with the same `title` before, the new
   * entry's `version` is bumped (so consumers can detect "upgrade
   * available" later).
   *
   * @param {object} widget         — full widget record from WidgetTool
   * @param {object} ctx
   * @param {string} ctx.agentId
   * @param {string} [ctx.agentName]
   * @param {string} [ctx.title]    — falls back to widget.widgetId
   * @param {string[]} [ctx.tags]
   * @returns {{templateId: string, version: number, entry: GalleryEntry}}
   */
  async share(widget, ctx = {}) {
    if (!widget || !widget.content) {
      throw new Error('share() requires a widget with content');
    }
    await this.load();
    const title = (ctx.title || widget.widgetId || 'widget').toString().slice(0, 120);
    const tags = Array.isArray(ctx.tags)
      ? ctx.tags.map(t => String(t).slice(0, 32)).slice(0, 16)
      : [];

    // Compute the next version number for this (agentId, title) pair.
    let nextVersion = 1;
    for (const e of this._entries.values()) {
      if (e.title === title && e.sharedBy?.agentId === ctx.agentId && e.version >= nextVersion) {
        nextVersion = e.version + 1;
      }
    }

    const templateId = generateTemplateId(title, nextVersion);
    const entry = {
      templateId,
      version:        nextVersion,
      title,
      kind:           widget.kind,
      content:        widget.content,
      defaultProps:   widget.props || {},
      phishingHits:   Array.isArray(widget.phishingHits) ? widget.phishingHits : [],
      tags,
      starred:        false,
      sharedAt:       new Date().toISOString(),
      _seq:           ++this._seq, // stable tiebreaker for sort
      sharedBy: {
        agentId:    ctx.agentId || null,
        agentName:  ctx.agentName || null,
        sessionId:  ctx.sessionId || null,
      },
      forkedFrom:     ctx.forkedFrom || null,
      renderCount:    0,
    };
    this._entries.set(templateId, entry);
    this._scheduleWrite();
    return { templateId, version: nextVersion, entry };
  }

  /**
   * Remove a template from the gallery. Idempotent — returns true if
   * something was removed, false otherwise.
   */
  async unshare(templateId) {
    if (!templateId) return false;
    await this.load();
    const ok = this._entries.delete(templateId);
    if (ok) this._scheduleWrite();
    return ok;
  }

  /** Fetch one entry by templateId, or null. */
  async get(templateId) {
    await this.load();
    return this._entries.get(templateId) || null;
  }

  /**
   * List entries with optional filtering by tag (any-match) and/or
   * `agentId` (entries shared BY that agent).
   */
  async list({ tag, agentId } = {}) {
    await this.load();
    let entries = Array.from(this._entries.values());
    if (tag) entries = entries.filter(e => e.tags?.includes(tag));
    if (agentId) entries = entries.filter(e => e.sharedBy?.agentId === agentId);
    // Newest first; _seq breaks ties when sharedAt is identical to the
    // millisecond (common in tests, possible at speed in production).
    entries.sort((a, b) => {
      const t = (b.sharedAt || '').localeCompare(a.sharedAt || '');
      if (t !== 0) return t;
      return (b._seq || 0) - (a._seq || 0);
    });
    return entries;
  }

  /**
   * Find the LATEST version of a logical template (by title + sharedBy
   * agentId). Used by the upgrade-prompt machinery to answer "is there
   * a newer version of the template I'm linked to?". `originTemplateId`
   * is the consumer's currently-linked id.
   */
  async findLatestForOrigin(originTemplateId) {
    await this.load();
    const origin = this._entries.get(originTemplateId);
    if (!origin) return null;
    let latest = origin;
    for (const e of this._entries.values()) {
      if (e.title === origin.title
        && e.sharedBy?.agentId === origin.sharedBy?.agentId
        && e.version > latest.version) {
        latest = e;
      }
    }
    return latest;
  }

  async bumpRenderCount(templateId) {
    await this.load();
    const e = this._entries.get(templateId);
    if (!e) return;
    e.renderCount = (e.renderCount || 0) + 1;
    this._scheduleWrite();
  }

  // ── Test/internal helpers — not part of the stable API ─────────────

  /** Drop all entries and persist the empty file. Used in tests. */
  async __clearForTests() {
    await this.load();
    this._entries.clear();
    this._scheduleWrite();
  }

  /** Number of entries (no load — call load() first if you need it). */
  get size() { return this._entries.size; }
}

/**
 * @typedef {Object} GalleryEntry
 * @property {string}   templateId
 * @property {number}   version
 * @property {string}   title
 * @property {'html'|'jsx'|'webcomponent'} kind
 * @property {string}   content
 * @property {object}   defaultProps
 * @property {string[]} phishingHits
 * @property {string[]} tags
 * @property {boolean}  starred
 * @property {string}   sharedAt              — ISO
 * @property {{agentId: string|null, agentName: string|null, sessionId: string|null}} sharedBy
 * @property {string|null} forkedFrom         — templateId or null
 * @property {number}   renderCount
 */

export default GalleryStore;
