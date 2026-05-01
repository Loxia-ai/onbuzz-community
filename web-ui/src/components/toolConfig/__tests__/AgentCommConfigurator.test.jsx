/**
 * Tests for AgentCommConfigurator — locks the emitted shape so the
 * backend's agentCommunicationTool can pick up the values unchanged.
 * Key quirks: maxAttachmentSize is bytes (MB in UI);
 * messageRetentionPeriod is ms (hours in UI).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import AgentCommConfigurator from '../AgentCommConfigurator';

const MB = 1024 * 1024;
const HOUR = 60 * 60 * 1000;

describe('AgentCommConfigurator', () => {
  it('renders with null value', () => {
    const { container } = render(<AgentCommConfigurator value={null} onChange={() => {}} disabled={false} />);
    expect(container.querySelector('[data-testid="agentcomm-configurator"]')).toBeTruthy();
    expect(container.textContent).toMatch(/Enable broadcast/);
    expect(container.textContent).toMatch(/Max recipients/);
    expect(container.textContent).toMatch(/Max conversation depth/);
    expect(container.textContent).toMatch(/Max attachment size/);
    expect(container.textContent).toMatch(/Message retention/);
  });

  it('toggling enableBroadcast emits boolean', () => {
    const onChange = vi.fn();
    const { container } = render(<AgentCommConfigurator value={null} onChange={onChange} disabled={false} />);
    const checkbox = container.querySelector('input[type="checkbox"]');
    fireEvent.click(checkbox);
    expect(onChange.mock.calls[0][0]).toEqual({ enableBroadcast: true });
  });

  it('enableBroadcast renders existing true value', () => {
    const { container } = render(
      <AgentCommConfigurator value={{ enableBroadcast: true }} onChange={() => {}} disabled={false} />
    );
    expect(container.querySelector('input[type="checkbox"]').checked).toBe(true);
  });

  it('maxRecipientsPerMessage: numeric input emits integer', () => {
    const onChange = vi.fn();
    const { container } = render(<AgentCommConfigurator value={null} onChange={onChange} disabled={false} />);
    const input = container.querySelector('#ac-max-recipients');
    fireEvent.change(input, { target: { value: '5' } });
    expect(onChange.mock.calls[0][0]).toEqual({ maxRecipientsPerMessage: 5 });
  });

  it('maxAttachmentSize: MB input stored as bytes', () => {
    const onChange = vi.fn();
    const { container } = render(<AgentCommConfigurator value={null} onChange={onChange} disabled={false} />);
    const input = container.querySelector('#ac-max-attachment-size');
    fireEvent.change(input, { target: { value: '5' } });
    expect(onChange.mock.calls[0][0]).toEqual({ maxAttachmentSize: 5 * MB });
  });

  it('maxAttachmentSize: renders MB from stored bytes', () => {
    const { container } = render(
      <AgentCommConfigurator value={{ maxAttachmentSize: 20 * MB }} onChange={() => {}} disabled={false} />
    );
    expect(container.querySelector('#ac-max-attachment-size').value).toBe('20');
  });

  it('messageRetentionPeriod: hours input stored as ms', () => {
    const onChange = vi.fn();
    const { container } = render(<AgentCommConfigurator value={null} onChange={onChange} disabled={false} />);
    const input = container.querySelector('#ac-retention');
    fireEvent.change(input, { target: { value: '48' } });
    expect(onChange.mock.calls[0][0]).toEqual({ messageRetentionPeriod: 48 * HOUR });
  });

  it('clearing a numeric field removes the key from the emitted object', () => {
    const onChange = vi.fn();
    const { container } = render(
      <AgentCommConfigurator value={{ maxRecipientsPerMessage: 5, enableBroadcast: true }} onChange={onChange} disabled={false} />
    );
    const input = container.querySelector('#ac-max-recipients');
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange.mock.calls[0][0]).toEqual({ enableBroadcast: true });
    expect('maxRecipientsPerMessage' in onChange.mock.calls[0][0]).toBe(false);
  });

  it('disabled=true disables all controls', () => {
    const { container } = render(
      <AgentCommConfigurator value={{ enableBroadcast: true }} onChange={() => {}} disabled />
    );
    container.querySelectorAll('input').forEach(i => expect(i.disabled).toBe(true));
  });
});
