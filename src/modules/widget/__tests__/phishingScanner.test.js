/**
 * Phishing scanner — soft UX nudge for credential-shaped prompts.
 *
 * Not a security boundary (the sandbox is), but we DO expect high recall
 * on the common credential shapes because this gates a scarier confirmation
 * modal. False positives are cheap (one extra click); false negatives are
 * what we worry about.
 */
import { describe, test, expect } from '@jest/globals';
import { scanForPhishingKeywords } from '../phishingScanner.js';

describe('scanForPhishingKeywords — shape', () => {
  test('returns [] on non-string', () => {
    expect(scanForPhishingKeywords(null)).toEqual([]);
    expect(scanForPhishingKeywords(undefined)).toEqual([]);
    expect(scanForPhishingKeywords(42)).toEqual([]);
    expect(scanForPhishingKeywords({})).toEqual([]);
  });
  test('returns [] on empty string', () => {
    expect(scanForPhishingKeywords('')).toEqual([]);
  });
  test('returns [] on neutral widget content', () => {
    expect(scanForPhishingKeywords('<div>Hello, world!</div>')).toEqual([]);
    expect(scanForPhishingKeywords('function(){ return h("span", null, "ok"); }')).toEqual([]);
  });
});

describe('scanForPhishingKeywords — credential categories', () => {
  test.each([
    ['password',            'Please enter your password'],
    ['passphrase',          'Enter your passphrase'],
    ['pwd',                 'pwd: ____'],
    ['sign in',             'Sign in to continue'],
    ['login',               '<form action="/login">'],
    ['otp',                 'OTP code: ___'],
    ['one-time code',       'one-time code required'],
    ['2fa',                 'Complete 2FA to proceed'],
    ['two factor',          'Two factor verification'],
    ['two-factor',          'two-factor authentication'],
    ['verify your identity','Verify your identity now'],
    ['confirm your identity', 'Confirm your identity'],
    ['credit card',         'Credit Card Number'],
    ['cvv',                 'CVV: ___'],
    ['card number',         'card number ____'],
    ['ssn',                 'Your SSN please'],
    ['social security',     'Social Security number'],
    ['bank account',        'Your bank account'],
    ['routing number',      'Routing number: '],
    ['account suspended',   'Your account suspended — click here'],
    ['unusual activity',    'Unusual activity detected'],
    ['verify account',      'Verify account immediately'],
    ['reset your password', 'Please reset your password'],
  ])('hits keyword %s in "%s"', (needle, haystack) => {
    expect(scanForPhishingKeywords(haystack)).toEqual(expect.arrayContaining([needle]));
  });
});

describe('scanForPhishingKeywords — invariants', () => {
  test('case-insensitive', () => {
    expect(scanForPhishingKeywords('PASSWORD REQUIRED')).toContain('password');
    expect(scanForPhishingKeywords('Sign In')).toContain('sign in');
    expect(scanForPhishingKeywords('CREDIT CARD')).toContain('credit card');
  });
  test('multiple hits accumulate', () => {
    const hits = scanForPhishingKeywords(
      'Please enter your password, then confirm your identity, then your credit card.'
    );
    expect(hits.length).toBeGreaterThanOrEqual(3);
    expect(hits).toEqual(expect.arrayContaining(['password', 'confirm your identity', 'credit card']));
  });
  test('substring anywhere counts (no word-boundary restriction)', () => {
    // "password1234" contains "password" and is worth flagging
    expect(scanForPhishingKeywords('<input name=password1234>')).toContain('password');
  });
});
