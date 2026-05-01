/**
 * Tests for WebConfigurator — stealth level + domain allow/block lists.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import WebConfigurator from '../WebConfigurator';

describe('WebConfigurator', () => {
  it('renders with null value', () => {
    const { container } = render(<WebConfigurator value={null} onChange={() => {}} disabled={false} />);
    expect(container.querySelector('[data-testid="web-configurator"]')).toBeTruthy();
    expect(container.textContent).toMatch(/Default stealth level/);
    expect(container.textContent).toMatch(/Allowed domains/);
    expect(container.textContent).toMatch(/Blocked domains/);
  });

  it('selecting a stealth level emits { defaultStealthLevel }', () => {
    const onChange = vi.fn();
    const { container } = render(<WebConfigurator value={null} onChange={onChange} disabled={false} />);
    const select = container.querySelector('select');
    fireEvent.change(select, { target: { value: 'maximum' } });
    expect(onChange.mock.calls[0][0]).toEqual({ defaultStealthLevel: 'maximum' });
  });

  it('setting stealth level back to "(global default)" removes the field', () => {
    const onChange = vi.fn();
    const { container } = render(
      <WebConfigurator value={{ defaultStealthLevel: 'standard' }} onChange={onChange} disabled={false} />
    );
    const select = container.querySelector('select');
    fireEvent.change(select, { target: { value: '' } });
    expect(onChange.mock.calls[0][0]).toEqual({});
    expect('defaultStealthLevel' in onChange.mock.calls[0][0]).toBe(false);
  });

  it('renders existing stealth level', () => {
    const { container } = render(
      <WebConfigurator value={{ defaultStealthLevel: 'maximum' }} onChange={() => {}} disabled={false} />
    );
    expect(container.querySelector('select').value).toBe('maximum');
  });

  it('adding an allowed domain emits { allowedDomains: [...] }', () => {
    const onChange = vi.fn();
    const { container } = render(<WebConfigurator value={null} onChange={onChange} disabled={false} />);
    const inputs = container.querySelectorAll('input[type="text"]');
    fireEvent.change(inputs[0], { target: { value: 'github.com' } });
    fireEvent.keyDown(inputs[0], { key: 'Enter' });
    expect(onChange.mock.calls[0][0]).toEqual({ allowedDomains: ['github.com'] });
  });

  it('adding a blocked domain emits { blockedDomains: [...] }', () => {
    const onChange = vi.fn();
    const { container } = render(<WebConfigurator value={null} onChange={onChange} disabled={false} />);
    const inputs = container.querySelectorAll('input[type="text"]');
    fireEvent.change(inputs[1], { target: { value: 'ads.example' } });
    fireEvent.keyDown(inputs[1], { key: 'Enter' });
    expect(onChange.mock.calls[0][0]).toEqual({ blockedDomains: ['ads.example'] });
  });

  it('removing a domain emits updated array', () => {
    const onChange = vi.fn();
    const { container } = render(
      <WebConfigurator value={{ allowedDomains: ['a.com', 'b.com'] }} onChange={onChange} disabled={false} />
    );
    fireEvent.click(container.querySelector('[aria-label="Remove a.com"]'));
    expect(onChange.mock.calls[0][0]).toEqual({ allowedDomains: ['b.com'] });
  });

  it('disabled=true disables everything', () => {
    const { container } = render(
      <WebConfigurator value={{ defaultStealthLevel: 'maximum' }} onChange={() => {}} disabled />
    );
    expect(container.querySelector('select').disabled).toBe(true);
    container.querySelectorAll('input').forEach(i => expect(i.disabled).toBe(true));
  });
});
