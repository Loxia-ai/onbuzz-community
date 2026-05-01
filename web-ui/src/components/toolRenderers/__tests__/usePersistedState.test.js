import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePersistedToggle, usePersistedSet, extractResult } from '../usePersistedState';

describe('extractResult', () => {
  it('returns empty result for null parsedData', () => {
    const r = extractResult(null);
    expect(r.hasResults).toBe(false);
    expect(r.result).toBeNull();
    expect(r.success).toBeNull();
  });

  it('returns empty result for parsedData without _hasResults', () => {
    const r = extractResult({ toolId: 'terminal', command: 'ls' });
    expect(r.hasResults).toBe(false);
    expect(r.result).toBeNull();
  });

  it('extracts result data when _hasResults is true', () => {
    const r = extractResult({
      toolId: 'terminal',
      _hasResults: true,
      _result: { output: 'hello world', exitCode: 0 },
      success: true,
      _error: null,
      _executionTime: 1500
    });
    expect(r.hasResults).toBe(true);
    expect(r.result).toEqual({ output: 'hello world', exitCode: 0 });
    expect(r.success).toBe(true);
    expect(r.error).toBeNull();
    expect(r.executionTime).toBe(1500);
  });

  it('extracts error data when _hasResults with failure', () => {
    const r = extractResult({
      _hasResults: true,
      _result: null,
      success: false,
      _error: 'Command not found',
      _executionTime: 200
    });
    expect(r.hasResults).toBe(true);
    expect(r.success).toBe(false);
    expect(r.error).toBe('Command not found');
  });
});

describe('usePersistedToggle', () => {
  it('starts with default value', () => {
    const { result } = renderHook(() => usePersistedToggle('test', 'ts1', 0, false));
    expect(result.current[0]).toBe(false);
  });

  it('toggles value', () => {
    const { result } = renderHook(() => usePersistedToggle('test', 'ts2', 0, false));
    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);
    act(() => result.current[1]());
    expect(result.current[0]).toBe(false);
  });

  it('persists value across re-mounts', () => {
    // First mount — toggle to true
    const { result, unmount } = renderHook(() => usePersistedToggle('persist', 'ts3', 0, false));
    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);
    unmount();

    // Re-mount — should start as true (persisted)
    const { result: result2 } = renderHook(() => usePersistedToggle('persist', 'ts3', 0, false));
    expect(result2.current[0]).toBe(true);
  });

  it('different keys are independent', () => {
    const { result: r1 } = renderHook(() => usePersistedToggle('a', 'ts4', 0, false));
    const { result: r2 } = renderHook(() => usePersistedToggle('b', 'ts4', 0, false));

    act(() => r1.current[1]());
    expect(r1.current[0]).toBe(true);
    expect(r2.current[0]).toBe(false);
  });

  it('set function works', () => {
    const { result } = renderHook(() => usePersistedToggle('settest', 'ts5', 0, false));
    act(() => result.current[2](true));
    expect(result.current[0]).toBe(true);
  });
});

describe('usePersistedSet', () => {
  it('starts with empty set', () => {
    const { result } = renderHook(() => usePersistedSet('settest', 'ts6'));
    expect(result.current[0].size).toBe(0);
  });

  it('toggleItem adds and removes items', () => {
    const { result } = renderHook(() => usePersistedSet('settest', 'ts7'));
    act(() => result.current[1](3)); // add
    expect(result.current[0].has(3)).toBe(true);
    act(() => result.current[1](3)); // remove
    expect(result.current[0].has(3)).toBe(false);
  });

  it('persists across re-mounts', () => {
    const { result, unmount } = renderHook(() => usePersistedSet('setpersist', 'ts8'));
    act(() => result.current[1](5));
    act(() => result.current[1](10));
    unmount();

    const { result: result2 } = renderHook(() => usePersistedSet('setpersist', 'ts8'));
    expect(result2.current[0].has(5)).toBe(true);
    expect(result2.current[0].has(10)).toBe(true);
  });
});
