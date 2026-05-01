/**
 * Tests for FilesystemConfigurator — locks the exact shape of the
 * emitted config object. Key quirk: maxFileSize is rendered in MB in the
 * UI but stored as BYTES in the emitted config.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import FilesystemConfigurator from '../FilesystemConfigurator';

const MB = 1024 * 1024;

describe('FilesystemConfigurator', () => {
  it('renders with null value', () => {
    const { container } = render(<FilesystemConfigurator value={null} onChange={() => {}} disabled={false} />);
    expect(container.querySelector('[data-testid="filesystem-configurator"]')).toBeTruthy();
    expect(container.textContent).toMatch(/Allowed extensions/);
    expect(container.textContent).toMatch(/Blocked extensions/);
    expect(container.textContent).toMatch(/Max file size/);
  });

  it('adding an allowed extension emits { allowedExtensions: [...] }', () => {
    const onChange = vi.fn();
    const { container } = render(<FilesystemConfigurator value={null} onChange={onChange} disabled={false} />);
    const allowedInput = container.querySelectorAll('input[type="text"]')[0];
    fireEvent.change(allowedInput, { target: { value: '.js' } });
    fireEvent.keyDown(allowedInput, { key: 'Enter' });
    expect(onChange.mock.calls[0][0]).toEqual({ allowedExtensions: ['.js'] });
  });

  it('adding a blocked extension emits { blockedExtensions: [...] }', () => {
    const onChange = vi.fn();
    const { container } = render(
      <FilesystemConfigurator value={{ allowedExtensions: ['.js'] }} onChange={onChange} disabled={false} />
    );
    const blockedInput = container.querySelectorAll('input[type="text"]')[1];
    fireEvent.change(blockedInput, { target: { value: '.exe' } });
    fireEvent.keyDown(blockedInput, { key: 'Enter' });
    expect(onChange.mock.calls[0][0]).toEqual({ allowedExtensions: ['.js'], blockedExtensions: ['.exe'] });
  });

  it('max file size: MB input emits bytes', () => {
    const onChange = vi.fn();
    const { container } = render(<FilesystemConfigurator value={null} onChange={onChange} disabled={false} />);
    const numInput = container.querySelector('input[type="number"]');
    fireEvent.change(numInput, { target: { value: '5' } });
    expect(onChange.mock.calls[0][0]).toEqual({ maxFileSize: 5 * MB });
  });

  it('max file size: renders MB from stored bytes', () => {
    const { container } = render(
      <FilesystemConfigurator value={{ maxFileSize: 10 * MB }} onChange={() => {}} disabled={false} />
    );
    const numInput = container.querySelector('input[type="number"]');
    expect(numInput.value).toBe('10');
  });

  it('max file size: empty input removes the field', () => {
    const onChange = vi.fn();
    const { container } = render(
      <FilesystemConfigurator value={{ maxFileSize: 5 * MB, allowedExtensions: ['.js'] }} onChange={onChange} disabled={false} />
    );
    const numInput = container.querySelector('input[type="number"]');
    fireEvent.change(numInput, { target: { value: '' } });
    expect(onChange.mock.calls[0][0]).toEqual({ allowedExtensions: ['.js'] });
    expect('maxFileSize' in onChange.mock.calls[0][0]).toBe(false);
  });

  it('disabled=true disables all inputs and buttons', () => {
    const { container } = render(
      <FilesystemConfigurator value={{ allowedExtensions: ['.js'] }} onChange={() => {}} disabled />
    );
    const inputs = container.querySelectorAll('input');
    inputs.forEach(i => expect(i.disabled).toBe(true));
    const buttons = container.querySelectorAll('button');
    buttons.forEach(b => expect(b.disabled).toBe(true));
  });

  it('negative or zero MB input is ignored (no emit)', () => {
    const onChange = vi.fn();
    const { container } = render(<FilesystemConfigurator value={null} onChange={onChange} disabled={false} />);
    const numInput = container.querySelector('input[type="number"]');
    fireEvent.change(numInput, { target: { value: '0' } });
    expect(onChange).not.toHaveBeenCalled();
  });
});
