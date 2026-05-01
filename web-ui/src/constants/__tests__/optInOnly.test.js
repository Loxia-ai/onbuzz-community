/**
 * Pin the OPT_IN_ONLY_TOOLS policy + its `withoutOptInOnly` helper.
 *
 * The contract:
 *   - platformcontrol is in OPT_IN_ONLY_TOOLS (today the only entry)
 *   - withoutOptInOnly() filters those ids from any list of tool ids
 *   - non-array inputs are tolerated (returns [])
 *   - other tool ids pass through unchanged
 *
 * If a future template change auto-checks platformcontrol, the test
 * "withoutOptInOnly strips platformcontrol" will fail loud and clear.
 */
import { describe, it, expect } from 'vitest';
import {
  TOOL_IDS,
  OPT_IN_ONLY_TOOLS,
  withoutOptInOnly,
} from '../toolConstants.js';

describe('OPT_IN_ONLY_TOOLS', () => {
  it('contains platformcontrol', () => {
    expect(OPT_IN_ONLY_TOOLS).toContain(TOOL_IDS.PLATFORM_CONTROL);
  });
  it('is frozen — accidental mutation throws or silently no-ops', () => {
    expect(Object.isFrozen(OPT_IN_ONLY_TOOLS)).toBe(true);
  });
});

describe('withoutOptInOnly', () => {
  it('strips platformcontrol from a typical "all tools" list', () => {
    const all = ['terminal', 'filesystem', 'platformcontrol', 'taskmanager', 'jobdone'];
    expect(withoutOptInOnly(all)).toEqual(['terminal', 'filesystem', 'taskmanager', 'jobdone']);
  });
  it('preserves order', () => {
    const ordered = ['a', 'b', 'platformcontrol', 'c'];
    expect(withoutOptInOnly(ordered)).toEqual(['a', 'b', 'c']);
  });
  it('list without any opt-in-only tools is unchanged', () => {
    const safe = ['terminal', 'filesystem'];
    expect(withoutOptInOnly(safe)).toEqual(safe);
  });
  it('empty list → empty list', () => {
    expect(withoutOptInOnly([])).toEqual([]);
  });
  it('non-array input → empty list (defensive)', () => {
    expect(withoutOptInOnly(null)).toEqual([]);
    expect(withoutOptInOnly(undefined)).toEqual([]);
    expect(withoutOptInOnly('platformcontrol')).toEqual([]);
    expect(withoutOptInOnly({ id: 'platformcontrol' })).toEqual([]);
  });
  it('does not mutate the caller\'s array', () => {
    const input = ['terminal', 'platformcontrol'];
    withoutOptInOnly(input);
    expect(input).toEqual(['terminal', 'platformcontrol']);
  });
  it('handles duplicates (strips every instance)', () => {
    const dup = ['platformcontrol', 'terminal', 'platformcontrol'];
    expect(withoutOptInOnly(dup)).toEqual(['terminal']);
  });
});
