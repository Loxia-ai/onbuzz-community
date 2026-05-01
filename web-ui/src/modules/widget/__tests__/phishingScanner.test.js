/**
 * Frontend phishing scanner — confirms the UI-side copy detects the
 * same high-level signals as the backend copy, so the modal's "scary
 * copy" path is reachable when it should be.
 */
import { describe, it, expect } from 'vitest';
import { scanForPhishingKeywords } from '../phishingScanner.js';

describe('scanForPhishingKeywords', () => {
  it('returns [] on non-string / empty input', () => {
    expect(scanForPhishingKeywords(null)).toEqual([]);
    expect(scanForPhishingKeywords('')).toEqual([]);
    expect(scanForPhishingKeywords(42)).toEqual([]);
  });

  it('flags classic credential-harvesting keywords', () => {
    const hits = scanForPhishingKeywords(
      'Please enter your password and OTP to verify your identity.'
    );
    expect(hits).toEqual(expect.arrayContaining(['password', 'otp', 'verify your identity']));
  });

  it('is case-insensitive', () => {
    expect(scanForPhishingKeywords('Bank Account details')).toContain('bank account');
  });

  it('returns [] on neutral widget content', () => {
    expect(scanForPhishingKeywords('<div>Hello world</div>')).toEqual([]);
  });
});
