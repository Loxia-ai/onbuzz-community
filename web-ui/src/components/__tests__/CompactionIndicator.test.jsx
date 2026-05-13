// Migrated from CommonJS + jest API to ESM + vi (vitest) — the web-ui
// has been on vitest for a while; this file was missed in the migration.
// The original /** @jest-environment jsdom */ pragma is no longer needed:
// vitest.config.js sets the environment globally.
import React from 'react';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockStoreState = {
  agentCompactionStatus: new Map()
};

vi.mock('../../stores/appStore', () => ({
  useAppStore: (selector) => selector(mockStoreState)
}));

const { CompactionIndicator } = await import('../CompactionIndicator.jsx');

function setMockState(compactionEntry) {
  mockStoreState.agentCompactionStatus = new Map();
  if (compactionEntry) {
    mockStoreState.agentCompactionStatus.set('agent-1', compactionEntry);
  }
}

describe('CompactionIndicator', () => {
  beforeEach(() => {
    setMockState(null);
  });

  test('shows nothing when no compaction state exists for the agent', () => {
    setMockState(null);
    const { container } = render(React.createElement(CompactionIndicator, { agentId: 'agent-1' }));
    expect(container.firstChild).toBeNull();
  });

  test('shows "Compaction In Progress" with blue gradient for in-progress status', () => {
    setMockState({ status: 'in-progress' });
    render(React.createElement(CompactionIndicator, { agentId: 'agent-1' }));

    expect(screen.getByText('Compaction In Progress')).toBeInTheDocument();
    const card = screen.getByText('Compaction In Progress').closest('[class*="from-blue-500"]');
    expect(card).toBeInTheDocument();
  });

  test('shows "Compaction In Progress" with amber gradient for retrying status', () => {
    setMockState({ status: 'retrying' });
    render(React.createElement(CompactionIndicator, { agentId: 'agent-1' }));

    expect(screen.getByText('Compaction In Progress')).toBeInTheDocument();
    const card = screen.getByText('Compaction In Progress').closest('[class*="from-amber-500"]');
    expect(card).toBeInTheDocument();
  });

  test('shows custom message from compaction state for retrying status', () => {
    setMockState({ status: 'retrying', message: 'Attempt 2, taking longer than expected...' });
    render(React.createElement(CompactionIndicator, { agentId: 'agent-1' }));

    expect(screen.getByText('Attempt 2, taking longer than expected...')).toBeInTheDocument();
  });
});
