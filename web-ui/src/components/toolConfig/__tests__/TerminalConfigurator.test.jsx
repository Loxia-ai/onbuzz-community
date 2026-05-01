/**
 * Tests for TerminalConfigurator form fields. Locks the exact shape of
 * `value` emitted via onChange so the backend's BaseTool#getEffectiveConfig
 * can read it without translation.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import React from 'react';
import TerminalConfigurator from '../TerminalConfigurator';

describe('TerminalConfigurator', () => {
  it('renders with null value (defaults)', () => {
    const onChange = vi.fn();
    const { container } = render(<TerminalConfigurator value={null} onChange={onChange} disabled={false} />);
    expect(container.querySelector('[data-testid="terminal-configurator"]')).toBeTruthy();
    expect(container.textContent).toMatch(/Allowed commands/);
    expect(container.textContent).toMatch(/Blocked commands/);
    expect(container.textContent).toMatch(/Max concurrent background commands/);
  });

  it('renders existing values', () => {
    const { container } = render(
      <TerminalConfigurator
        value={{ allowedCommands: ['git', 'npm'], blockedCommands: ['rm -rf'], maxBackgroundCommandsPerAgent: 5 }}
        onChange={() => {}}
        disabled={false}
      />
    );
    expect(container.textContent).toContain('git');
    expect(container.textContent).toContain('npm');
    expect(container.textContent).toContain('rm -rf');
    expect(container.querySelector('input[type="number"]').value).toBe('5');
  });

  it('adding an allowed command emits { allowedCommands: [...] }', () => {
    const onChange = vi.fn();
    const { container } = render(<TerminalConfigurator value={null} onChange={onChange} disabled={false} />);
    const inputs = container.querySelectorAll('input[type="text"]');
    const allowedInput = inputs[0];
    fireEvent.change(allowedInput, { target: { value: 'git' } });
    fireEvent.keyDown(allowedInput, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual({ allowedCommands: ['git'] });
  });

  it('adding a blocked command emits { blockedCommands: [...] }', () => {
    const onChange = vi.fn();
    const { container } = render(
      <TerminalConfigurator value={{ allowedCommands: ['git'] }} onChange={onChange} disabled={false} />
    );
    const inputs = container.querySelectorAll('input[type="text"]');
    const blockedInput = inputs[1];
    fireEvent.change(blockedInput, { target: { value: 'rm -rf' } });
    fireEvent.keyDown(blockedInput, { key: 'Enter' });
    expect(onChange.mock.calls[0][0]).toEqual({ allowedCommands: ['git'], blockedCommands: ['rm -rf'] });
  });

  it('removing a command emits updated array', () => {
    const onChange = vi.fn();
    const { container } = render(
      <TerminalConfigurator value={{ allowedCommands: ['git', 'npm'] }} onChange={onChange} disabled={false} />
    );
    fireEvent.click(container.querySelector('[aria-label="Remove git"]'));
    expect(onChange.mock.calls[0][0]).toEqual({ allowedCommands: ['npm'] });
  });

  it('deduplicates on add (does not add a command already in the list)', () => {
    const onChange = vi.fn();
    const { container } = render(
      <TerminalConfigurator value={{ allowedCommands: ['git'] }} onChange={onChange} disabled={false} />
    );
    const allowedInput = container.querySelectorAll('input[type="text"]')[0];
    fireEvent.change(allowedInput, { target: { value: 'git' } });
    fireEvent.keyDown(allowedInput, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('numeric input: empty string removes the field from value', () => {
    const onChange = vi.fn();
    const { container } = render(
      <TerminalConfigurator
        value={{ allowedCommands: ['git'], maxBackgroundCommandsPerAgent: 3 }}
        onChange={onChange}
        disabled={false}
      />
    );
    const numInput = container.querySelector('input[type="number"]');
    fireEvent.change(numInput, { target: { value: '' } });
    expect(onChange.mock.calls[0][0]).toEqual({ allowedCommands: ['git'] });
    // key is gone (not undefined, actually absent)
    expect('maxBackgroundCommandsPerAgent' in onChange.mock.calls[0][0]).toBe(false);
  });

  it('numeric input: valid number updates the field', () => {
    const onChange = vi.fn();
    const { container } = render(<TerminalConfigurator value={null} onChange={onChange} disabled={false} />);
    const numInput = container.querySelector('input[type="number"]');
    fireEvent.change(numInput, { target: { value: '10' } });
    expect(onChange.mock.calls[0][0]).toEqual({ maxBackgroundCommandsPerAgent: 10 });
  });

  it('disabled=true disables all inputs and buttons', () => {
    const { container } = render(
      <TerminalConfigurator value={{ allowedCommands: ['git'] }} onChange={() => {}} disabled />
    );
    const inputs = container.querySelectorAll('input');
    inputs.forEach(i => expect(i.disabled).toBe(true));
    const buttons = container.querySelectorAll('button');
    buttons.forEach(b => expect(b.disabled).toBe(true));
  });
});
