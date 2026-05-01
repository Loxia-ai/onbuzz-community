/**
 * WidgetConfigurator — per-agent toolConfig UI.
 *
 * Contract exercised:
 *   - Default-off: absent value renders the checkbox unchecked
 *   - Toggling the checkbox emits onChange with allowCustomCode true/false
 *   - Interactive-mode select is disabled when allowCustomCode is off
 *   - Selecting empty ("(default)") clears the field rather than storing ""
 *   - `disabled` prop greys everything out
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import WidgetConfigurator from '../WidgetConfigurator.jsx';

afterEach(() => cleanup());

describe('WidgetConfigurator', () => {
  it('renders with default-off when value is null', () => {
    render(<WidgetConfigurator value={null} onChange={() => {}} />);
    const cb = screen.getByRole('checkbox');
    expect(cb).not.toBeChecked();
  });

  it('renders checked when allowCustomCode: true', () => {
    render(<WidgetConfigurator value={{ allowCustomCode: true }} onChange={() => {}} />);
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('emits onChange with allowCustomCode: true when toggled on', () => {
    const onChange = vi.fn();
    render(<WidgetConfigurator value={{}} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ allowCustomCode: true }));
  });

  it('emits onChange with allowCustomCode: false when toggled off', () => {
    const onChange = vi.fn();
    render(<WidgetConfigurator value={{ allowCustomCode: true }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ allowCustomCode: false }));
  });

  it('interactive-mode select is disabled when allowCustomCode is off', () => {
    render(<WidgetConfigurator value={{ allowCustomCode: false }} onChange={() => {}} />);
    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('interactive-mode select is enabled when allowCustomCode is on', () => {
    render(<WidgetConfigurator value={{ allowCustomCode: true }} onChange={() => {}} />);
    expect(screen.getByRole('combobox')).not.toBeDisabled();
  });

  it('choosing a non-default mode stores it', () => {
    const onChange = vi.fn();
    render(<WidgetConfigurator value={{ allowCustomCode: true }} onChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'static-only' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      allowCustomCode: true,
      interactiveMode: 'static-only',
    }));
  });

  it('choosing the default ("(default)") clears the field', () => {
    const onChange = vi.fn();
    render(
      <WidgetConfigurator
        value={{ allowCustomCode: true, interactiveMode: 'static-only' }}
        onChange={onChange}
      />
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    // clearField removes the key entirely — result should NOT contain
    // interactiveMode so the tool falls back to its hard-coded default.
    const last = onChange.mock.calls.at(-1)[0];
    expect(last).not.toHaveProperty('interactiveMode');
    expect(last).toHaveProperty('allowCustomCode', true);
  });

  it('disabled prop disables checkbox and select', () => {
    render(<WidgetConfigurator value={{ allowCustomCode: true }} onChange={() => {}} disabled />);
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('combobox')).toBeDisabled();
  });
});
