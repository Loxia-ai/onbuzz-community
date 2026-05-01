import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import ThinkingBubble from '../ThinkingBubble.jsx';

describe('ThinkingBubble', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('renders with scheduling-aware initial message', () => {
    render(<ThinkingBubble agentName="TestBot" />);

    const schedulingMessages = [
      'Waiting for my turn...',
      'In the queue, hang tight.',
      'Preparing to process...',
      'Almost my turn...',
      'Standing by...'
    ];

    // One of the scheduling messages should be visible
    const found = schedulingMessages.some(msg => {
      try { return screen.getByText(msg); } catch { return false; }
    });
    expect(found).toBe(true);
  });

  test('shows agent name', () => {
    render(<ThinkingBubble agentName="MyAgent" />);
    expect(screen.getByText(/MyAgent is working/)).toBeInTheDocument();
  });

  test('rotates to long-wait messages after 30 seconds', () => {
    render(<ThinkingBubble agentName="TestBot" />);

    // Advance past LONG_WAIT_THRESHOLD (30s)
    act(() => { jest.advanceTimersByTime(31000); });

    const longWaitMessages = [
      'Waiting to be scheduled, bear with me.',
      'Other agents are being processed, I\'m next...',
      'Sitting tight until scheduled...',
      'Hold on, I\'ll be with you shortly...',
      'Still waiting for my slot...'
    ];

    const found = longWaitMessages.some(msg => {
      try { return screen.getByText(msg); } catch { return false; }
    });
    expect(found).toBe(true);
  });

  test('shows elapsed time indicator after long wait', () => {
    render(<ThinkingBubble agentName="TestBot" />);

    act(() => { jest.advanceTimersByTime(35000); });

    // Should show elapsed seconds
    expect(screen.getByText(/\d+s/)).toBeInTheDocument();
  });
});
