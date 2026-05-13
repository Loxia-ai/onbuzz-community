import { describe, test, expect } from '@jest/globals';
import WebTool from '../webTool.js';

/**
 * Pins the Path C contract for HTTP 4xx/5xx response mapping. The
 * helper itself (WebTool._resultForHttpStatus) is page-oriented:
 *   401 / 402 / 403  → success: true  (auth or paywall, useful body)
 *   404 / 410        → success: false ("not found"-style errors)
 *   429              → success: false + retry suggestion
 *   5xx              → success: false
 *   other 4xx        → success: false
 *
 * See docs/WEBTOOL_4XX_SEMANTICS.md for the full reasoning behind
 * these splits, including why the `search` operation deliberately
 * does NOT use this helper.
 */
describe('WebTool._resultForHttpStatus', () => {
  describe('non-error statuses', () => {
    test.each([null, undefined, 0, 200, 201, 204, 301, 302, 304, 399])(
      'returns null for status %p (not an error)',
      (status) => {
        expect(WebTool._resultForHttpStatus(status)).toBeNull();
      },
    );
  });

  describe('401 / 402 / 403 — auth / paywall (success: true)', () => {
    test.each([401, 402, 403])('status %i → success: true with diagnostic', (status) => {
      const r = WebTool._resultForHttpStatus(status);
      expect(r).not.toBeNull();
      expect(r.success).toBe(true);
      expect(r.httpStatus).toBe(status);
      expect(r.diagnostic).toMatch(new RegExp(`HTTP ${status}`));
      expect(r.warning).toBeTruthy();
      // The warning should hint that body content may still be useful —
      // that's the whole point of treating these three as success.
      expect(r.warning.toLowerCase()).toMatch(/content|body|useful|login|paywall/);
      // Auth-or-paywall results must NOT carry an error field
      // (otherwise the agent reads them as failures).
      expect(r.error).toBeUndefined();
    });

    test('401 message mentions "authentication"', () => {
      const r = WebTool._resultForHttpStatus(401);
      expect(r.diagnostic.toLowerCase()).toContain('authentication');
    });

    test('402 message mentions "payment"', () => {
      const r = WebTool._resultForHttpStatus(402);
      expect(r.diagnostic.toLowerCase()).toContain('payment');
    });

    test('403 message mentions "access forbidden"', () => {
      const r = WebTool._resultForHttpStatus(403);
      expect(r.diagnostic.toLowerCase()).toContain('access forbidden');
    });
  });

  describe('404 / 410 — not found (success: false)', () => {
    test.each([404, 410])('status %i → success: false with "page not found" error', (status) => {
      const r = WebTool._resultForHttpStatus(status);
      expect(r.success).toBe(false);
      expect(r.httpStatus).toBe(status);
      expect(r.error).toMatch(new RegExp(`HTTP ${status}`));
      expect(r.error.toLowerCase()).toContain('page not found');
      // Not-found shouldn't get the rate-limit suggestion.
      expect(r.suggestion).toBeUndefined();
      // Failure results must NOT carry a warning that disagrees with
      // the success flag.
      expect(r.warning).toBeUndefined();
    });
  });

  describe('429 — rate limited (success: false + retry suggestion)', () => {
    test('returns failure with a rate-limit message and an actionable suggestion', () => {
      const r = WebTool._resultForHttpStatus(429);
      expect(r.success).toBe(false);
      expect(r.httpStatus).toBe(429);
      expect(r.error.toLowerCase()).toContain('rate limited');
      expect(r.suggestion).toBeTruthy();
      expect(r.suggestion.toLowerCase()).toMatch(/wait|retry|reduce|frequency/);
    });
  });

  describe('5xx — server errors (success: false)', () => {
    test.each([500, 502, 503, 504, 599])('status %i → success: false', (status) => {
      const r = WebTool._resultForHttpStatus(status);
      expect(r.success).toBe(false);
      expect(r.httpStatus).toBe(status);
      expect(r.error.toLowerCase()).toContain('server error');
      // No retry suggestion for 5xx specifically — caller decides.
      expect(r.suggestion).toBeUndefined();
    });
  });

  describe('other 4xx — generic client errors (success: false)', () => {
    test.each([400, 405, 408, 418, 422, 451])('status %i → success: false, "client error"', (status) => {
      const r = WebTool._resultForHttpStatus(status);
      expect(r.success).toBe(false);
      expect(r.httpStatus).toBe(status);
      expect(r.error.toLowerCase()).toContain('client error');
    });
  });

  describe('context option — message template', () => {
    test('defaults to "Page returned HTTP …"', () => {
      const r = WebTool._resultForHttpStatus(404);
      expect(r.error).toMatch(/^Page returned HTTP 404/);
    });

    test('honours a custom context for tab navigation', () => {
      const r = WebTool._resultForHttpStatus(404, { context: 'Tab' });
      expect(r.error).toMatch(/^Tab returned HTTP 404/);
    });

    test('context flows through to auth/paywall diagnostic too', () => {
      const r = WebTool._resultForHttpStatus(401, { context: 'Tab' });
      expect(r.diagnostic).toMatch(/^Tab returned HTTP 401/);
    });
  });

  describe('shape invariants', () => {
    test.each([400, 401, 403, 404, 410, 418, 422, 429, 500, 503])(
      'status %i: response includes httpStatus + exactly one of (error, diagnostic)',
      (status) => {
        const r = WebTool._resultForHttpStatus(status);
        expect(r.httpStatus).toBe(status);
        if (r.success) {
          expect(r.error).toBeUndefined();
          expect(r.diagnostic).toBeTruthy();
        } else {
          expect(r.error).toBeTruthy();
          expect(r.diagnostic).toBeUndefined();
        }
      },
    );

    test('success flag is a boolean, not a truthy/falsy value', () => {
      for (const status of [401, 404, 429, 500]) {
        const r = WebTool._resultForHttpStatus(status);
        expect(typeof r.success).toBe('boolean');
      }
    });
  });
});
