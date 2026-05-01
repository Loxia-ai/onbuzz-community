/** @jest-environment jsdom */
const React = require('react');
const { render, screen, fireEvent } = require('@testing-library/react');
require('@testing-library/jest-dom');

// Set up a mutable state object that the mock reads from
const mockStoreState = {
  currentAgent: { id: 'agent-1', name: 'TestAgent' },
  messages: []
};

jest.mock('../../stores/appStore', () => ({
  useAppStore: (selector) => selector(mockStoreState)
}));

const TaskPanel = require('../TaskPanel.jsx').default;

const messagesWithTasks = [{
  id: 'msg-1', role: 'assistant', content: 'test',
  toolResults: [{
    toolId: 'taskmanager',
    status: 'completed',
    result: {
      tasks: [
        { id: 't1', title: 'Write code', status: 'completed', priority: 'normal' },
        { id: 't2', title: 'Run tests', status: 'in_progress', priority: 'high' },
        { id: 't3', title: 'Deploy', status: 'pending', priority: 'normal' }
      ]
    }
  }]
}];

function setMockState(overrides = {}) {
  Object.assign(mockStoreState, {
    currentAgent: { id: 'agent-1', name: 'TestAgent' },
    messages: [],
    ...overrides
  });
}

describe('TaskPanel', () => {
  beforeEach(() => {
    setMockState();
  });

  test('renders "No tasks yet" when no taskmanager results in messages', () => {
    setMockState({ messages: [] });
    render(React.createElement(TaskPanel, { onClose: () => {} }));
    expect(screen.getByText(/No tasks yet/)).toBeInTheDocument();
  });

  test('renders tasks when messages contain taskmanager tool results', () => {
    setMockState({ messages: messagesWithTasks });
    render(React.createElement(TaskPanel, { onClose: () => {} }));

    expect(screen.getByText('Write code')).toBeInTheDocument();
    expect(screen.getByText('Run tests')).toBeInTheDocument();
    expect(screen.getByText('Deploy')).toBeInTheDocument();
  });

  test('shows correct status styling (in_progress has pulse animation class)', () => {
    setMockState({ messages: messagesWithTasks });
    const { container } = render(React.createElement(TaskPanel, { onClose: () => {} }));

    const pulseElements = container.querySelectorAll('.animate-pulse');
    expect(pulseElements.length).toBeGreaterThan(0);
  });

  test('shows completed/total count in header', () => {
    setMockState({ messages: messagesWithTasks });
    render(React.createElement(TaskPanel, { onClose: () => {} }));

    // 1 completed out of 3 total
    expect(screen.getByText('1/3')).toBeInTheDocument();
  });

  test('shows progress bar when tasks exist', () => {
    setMockState({ messages: messagesWithTasks });
    const { container } = render(React.createElement(TaskPanel, { onClose: () => {} }));

    const progressBar = container.querySelector('.bg-green-500');
    expect(progressBar).toBeInTheDocument();
    // 1/3 completed ~ 33%
    expect(progressBar.style.width).toContain('33');
  });

  test('calls onClose when X button clicked', () => {
    setMockState({ messages: [] });
    const onClose = jest.fn();
    render(React.createElement(TaskPanel, { onClose }));

    const closeButton = screen.getByRole('button');
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
