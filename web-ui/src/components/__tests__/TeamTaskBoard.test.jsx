/** @jest-environment jsdom */
const React = require('react');
const { render, screen, fireEvent } = require('@testing-library/react');
require('@testing-library/jest-dom');

const mockStoreState = {
  agents: [],
  teams: [],
  agentMessages: new Map()
};

jest.mock('../../stores/appStore', () => ({
  useAppStore: (selector) => selector(mockStoreState)
}));

const TeamTaskBoard = require('../TeamTaskBoard.jsx').default;

const sampleAgents = [
  { id: 'a1', name: 'Agent Alpha', status: 'active' },
  { id: 'a2', name: 'Agent Beta', status: 'active' }
];

const sampleTeams = [
  { id: 'team-1', name: 'Backend', memberAgentIds: ['a1'] }
];

const agentMessagesWithTasks = new Map([
  ['a1', [{
    id: 'msg-1', role: 'assistant', content: 'done',
    toolResults: [{
      toolId: 'taskmanager',
      status: 'completed',
      result: {
        tasks: [
          { id: 't1', title: 'Build API', status: 'completed', priority: 'normal' },
          { id: 't2', title: 'Write docs', status: 'in_progress', priority: 'normal' }
        ]
      }
    }]
  }]],
  ['a2', []]
]);

function setMockState(overrides = {}) {
  Object.assign(mockStoreState, {
    agents: [],
    teams: [],
    agentMessages: new Map(),
    ...overrides
  });
}

describe('TeamTaskBoard', () => {
  beforeEach(() => {
    setMockState();
  });

  test('renders "No agents in this view" when agents is empty', () => {
    setMockState({ agents: [], teams: [] });
    render(React.createElement(TeamTaskBoard));
    expect(screen.getByText('No agents in this view')).toBeInTheDocument();
  });

  test('renders agent columns when agents exist', () => {
    setMockState({ agents: sampleAgents, teams: [], agentMessages: new Map() });
    render(React.createElement(TeamTaskBoard));

    expect(screen.getByText('Agent Alpha')).toBeInTheDocument();
    expect(screen.getByText('Agent Beta')).toBeInTheDocument();
  });

  test('shows "All Agents" tab by default and it is active', () => {
    setMockState({ agents: sampleAgents, teams: sampleTeams, agentMessages: new Map() });
    render(React.createElement(TeamTaskBoard));

    const allAgentsTab = screen.getByText('All Agents');
    expect(allAgentsTab).toBeInTheDocument();
    expect(allAgentsTab.className).toContain('bg-loxia-600');
  });

  test('clicking a team tab filters agents to that team', () => {
    setMockState({ agents: sampleAgents, teams: sampleTeams, agentMessages: new Map() });
    render(React.createElement(TeamTaskBoard));

    expect(screen.getByText('Agent Alpha')).toBeInTheDocument();
    expect(screen.getByText('Agent Beta')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Backend'));

    expect(screen.getByText('Agent Alpha')).toBeInTheDocument();
    expect(screen.queryByText('Agent Beta')).not.toBeInTheDocument();
  });

  test('shows task cards in agent columns when messages have tasks', () => {
    setMockState({
      agents: sampleAgents,
      teams: [],
      agentMessages: agentMessagesWithTasks
    });
    render(React.createElement(TeamTaskBoard));

    expect(screen.getByText('Build API')).toBeInTheDocument();
    expect(screen.getByText('Write docs')).toBeInTheDocument();
    expect(screen.getByText('No tasks')).toBeInTheDocument();
  });
});
