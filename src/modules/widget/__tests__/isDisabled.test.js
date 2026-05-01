/**
 * LOXIA_DISABLE_WIDGETS — zero-source kill switch.
 *
 * This is the "remove the feature without touching code" path. If the env
 * check regresses, deployments can't disable the module without a rebuild.
 */
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { isDisabled } from '../index.js';

describe('isDisabled()', () => {
  const original = process.env.LOXIA_DISABLE_WIDGETS;
  afterEach(() => {
    if (original === undefined) delete process.env.LOXIA_DISABLE_WIDGETS;
    else process.env.LOXIA_DISABLE_WIDGETS = original;
  });

  test('false when env var is unset', () => {
    delete process.env.LOXIA_DISABLE_WIDGETS;
    expect(isDisabled()).toBe(false);
  });
  test('true when "1"', () => {
    process.env.LOXIA_DISABLE_WIDGETS = '1';
    expect(isDisabled()).toBe(true);
  });
  test('true when "true"', () => {
    process.env.LOXIA_DISABLE_WIDGETS = 'true';
    expect(isDisabled()).toBe(true);
  });
  test('false when "0"', () => {
    process.env.LOXIA_DISABLE_WIDGETS = '0';
    expect(isDisabled()).toBe(false);
  });
  test('false when "false"', () => {
    process.env.LOXIA_DISABLE_WIDGETS = 'false';
    expect(isDisabled()).toBe(false);
  });
  test('false on any other string (strict match)', () => {
    process.env.LOXIA_DISABLE_WIDGETS = 'yes';
    expect(isDisabled()).toBe(false);
  });
});
