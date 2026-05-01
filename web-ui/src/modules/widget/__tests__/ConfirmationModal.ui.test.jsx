/**
 * ConfirmationModal — rendered-UI behavior.
 *
 * Three things matter beyond persistence:
 *  1. The scarier copy appears when phishingHits is non-empty.
 *  2. onDecide is called with each of the three decisions from the right button.
 *  3. onClose fires from the backdrop click and the × button.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ConfirmationModal from '../ConfirmationModal.jsx';

afterEach(() => cleanup());

function mount(overrides = {}) {
  const props = {
    agentName: 'test-agent',
    agentId:   'agent-x',
    kind:      'jsx',
    content:   '<p>hi</p>',
    phishingHits: [],
    onDecide:  vi.fn(),
    onClose:   vi.fn(),
    ...overrides,
  };
  return { props, ...render(<ConfirmationModal {...props} />) };
}

describe('ConfirmationModal — neutral content', () => {
  it('renders the neutral header copy', () => {
    mount();
    expect(screen.getByText(/Allow test-agent to render custom UI/i)).toBeInTheDocument();
  });
  it('does NOT render the phishing callout', () => {
    mount();
    expect(screen.queryByText(/Phishing-shape detected/i)).not.toBeInTheDocument();
  });
});

describe('ConfirmationModal — phishing content', () => {
  it('renders the scary header copy and lists each hit', () => {
    mount({ phishingHits: ['password', 'credit card'] });
    expect(screen.getByText(/asks for sensitive information/i)).toBeInTheDocument();
    expect(screen.getByText(/Phishing-shape detected/i)).toBeInTheDocument();
    expect(screen.getByText('password')).toBeInTheDocument();
    expect(screen.getByText('credit card')).toBeInTheDocument();
  });
});

describe('ConfirmationModal — button wiring', () => {
  it('Block → onDecide("block")', () => {
    const { props } = mount();
    fireEvent.click(screen.getByRole('button', { name: /block/i }));
    expect(props.onDecide).toHaveBeenCalledWith('block');
  });
  it('Allow once → onDecide("once")', () => {
    const { props } = mount();
    fireEvent.click(screen.getByRole('button', { name: /allow once/i }));
    expect(props.onDecide).toHaveBeenCalledWith('once');
  });
  it('Always allow → onDecide("always")', () => {
    const { props } = mount();
    fireEvent.click(screen.getByRole('button', { name: /always allow/i }));
    expect(props.onDecide).toHaveBeenCalledWith('always');
  });
  it('× close button calls onClose', () => {
    const { props } = mount();
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(props.onClose).toHaveBeenCalled();
  });
});
