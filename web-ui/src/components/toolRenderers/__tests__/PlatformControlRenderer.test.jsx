/**
 * PlatformControlRenderer — visualization for the platformcontrol tool.
 *
 * Coverage:
 *   - Pending state (no result yet)
 *   - Each action's body renders the right shape:
 *       list-schedules        → time-strip + schedule cards
 *       get-schedule          → single card
 *       create / update       → single card with name + cron
 *       delete                → minimal confirmation
 *       toggle                → enabled/disabled state line
 *       trigger               → "fired" pulse
 *       list-presets          → preset chips
 *       list-capabilities     → permission shield card with notes
 *       schedule-self-resume  → distinct "I'll come back" card with countdown
 *   - Errors (success: false) and disabled state
 *   - Self vs other target chip
 *   - Cron decoder (unit-tested via export)
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import PlatformControlRenderer, { decodeCron, relativeFromNow } from '../PlatformControlRenderer.jsx';

afterEach(() => cleanup());

const enriched = (parsed, result, success = true) => ({
  ...parsed,
  _hasResults: true,
  _result: { success, ...result },
  success,
});

describe('decodeCron — exported helper', () => {
  it('decodes preset shapes to friendly English', () => {
    expect(decodeCron('0 9 * * *')).toBe('Daily at 9:00 AM');
    expect(decodeCron('0 9 * * 1-5')).toBe('Weekdays at 9:00 AM');
    expect(decodeCron('*/15 * * * *')).toBe('Every 15 minutes');
  });
  it('decodes one-shot pattern produced by self-resume', () => {
    expect(decodeCron('30 14 26 4 *')).toMatch(/Once at 14:30 on 26\/04/);
  });
  it('falls back to raw cron for unknown patterns', () => {
    expect(decodeCron('5 9 * 1-3 1,3,5')).toBe('5 9 * 1-3 1,3,5');
  });
  it('handles non-string defensively', () => {
    expect(decodeCron(null)).toBe('');
    expect(decodeCron(123)).toBe('');
  });
});

describe('relativeFromNow', () => {
  it('returns "in Xs" / "Xs ago" for seconds', () => {
    expect(relativeFromNow(new Date(Date.now() + 5_000).toISOString())).toMatch(/in \d+s/);
    expect(relativeFromNow(new Date(Date.now() - 5_000).toISOString())).toMatch(/\d+s ago/);
  });
  it('returns null for invalid input', () => {
    expect(relativeFromNow(null)).toBe(null);
    expect(relativeFromNow('garbage')).toBe(null);
  });
});

describe('pending state', () => {
  it('renders "Awaiting result…" when there is no _hasResults', () => {
    render(<PlatformControlRenderer parsedData={{ action: 'list-schedules' }} />);
    expect(screen.getByTestId('pc-pending')).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/Awaiting result/);
  });
});

describe('list-schedules', () => {
  it('renders a time strip + a card per schedule, sorted by next run', () => {
    const inAnHour = new Date(Date.now() + 3_600_000).toISOString();
    const inSixHours = new Date(Date.now() + 6 * 3_600_000).toISOString();
    render(<PlatformControlRenderer
      parsedData={enriched(
        { action: 'list-schedules' },
        {
          action: 'list-schedules',
          scope: 'own',
          schedules: [
            { id: 's2', name: 'Later', cronExpression: '0 */6 * * *', enabled: true, nextRun: inSixHours, targetType: 'agent', targetId: 'agent-self' },
            { id: 's1', name: 'Sooner', cronExpression: '0 9 * * *', enabled: true, nextRun: inAnHour, targetType: 'agent', targetId: 'agent-self' },
          ],
        }
      )}
      agentId="agent-self"
    />);
    expect(screen.getByTestId('pc-time-strip')).toBeInTheDocument();
    const cards = screen.getAllByTestId('pc-schedule-card');
    expect(cards).toHaveLength(2);
    // First card after sort should be the sooner one.
    expect(cards[0].textContent).toMatch(/Sooner/);
  });

  it('shows "No upcoming runs" when none in 24h horizon', () => {
    render(<PlatformControlRenderer
      parsedData={enriched(
        { action: 'list-schedules' },
        { action: 'list-schedules', scope: 'own', schedules: [] }
      )}
    />);
    expect(document.body.textContent).toMatch(/No schedules in scope/);
  });

  it('renders the scope chip from result.scope', () => {
    render(<PlatformControlRenderer
      parsedData={enriched(
        { action: 'list-schedules' },
        { action: 'list-schedules', scope: 'all', schedules: [] }
      )}
    />);
    expect(screen.getByTestId('pc-scope-chip').textContent).toMatch(/all agents/);
  });

  it('disabled schedule renders "paused" badge and is sorted last', () => {
    const tFuture = new Date(Date.now() + 3_600_000).toISOString();
    render(<PlatformControlRenderer
      parsedData={enriched(
        { action: 'list-schedules' },
        {
          action: 'list-schedules',
          scope: 'own',
          schedules: [
            { id: 'p', name: 'Paused', cronExpression: '0 9 * * *', enabled: false, targetType: 'agent', targetId: 'agent-self' },
            { id: 'a', name: 'Active', cronExpression: '0 9 * * *', enabled: true, nextRun: tFuture, targetType: 'agent', targetId: 'agent-self' },
          ],
        }
      )}
      agentId="agent-self"
    />);
    const cards = screen.getAllByTestId('pc-schedule-card');
    expect(cards[0].textContent).toMatch(/Active/);
    expect(cards[1].textContent).toMatch(/Paused/);
    expect(document.body.textContent).toMatch(/paused/);
  });
});

describe('get / create / update', () => {
  const sched = {
    id: 's1', name: 'My schedule', cronExpression: '0 9 * * *', enabled: true,
    nextRun: new Date(Date.now() + 3_600_000).toISOString(),
    targetType: 'agent', targetId: 'agent-self', prompt: 'Run smoke tests',
  };

  it('get-schedule renders a single card', () => {
    render(<PlatformControlRenderer
      parsedData={enriched({ action: 'get-schedule' }, { action: 'get-schedule', schedule: sched })}
      agentId="agent-self"
    />);
    expect(screen.getByTestId('pc-schedule-card').textContent).toMatch(/My schedule/);
    expect(document.body.textContent).toMatch(/Daily at 9:00 AM/);
  });

  it('create-schedule renders the same card; header reads "Schedule armed"', () => {
    render(<PlatformControlRenderer
      parsedData={enriched({ action: 'create-schedule' }, { action: 'create-schedule', schedule: sched })}
      agentId="agent-self"
    />);
    expect(document.body.textContent).toMatch(/Schedule armed/);
    expect(screen.getByTestId('pc-schedule-card')).toBeInTheDocument();
  });

  it('update-schedule renders the same card; header reads "Schedule updated"', () => {
    render(<PlatformControlRenderer
      parsedData={enriched({ action: 'update-schedule' }, { action: 'update-schedule', schedule: sched })}
    />);
    expect(document.body.textContent).toMatch(/Schedule updated/);
  });

  it('shows "self" target chip when targetId === agentId', () => {
    render(<PlatformControlRenderer
      parsedData={enriched({ action: 'get-schedule' }, { action: 'get-schedule', schedule: sched })}
      agentId="agent-self"
    />);
    expect(document.body.textContent).toMatch(/⟲ self/);
  });

  it('shows other-agent chip when target is a different agent', () => {
    render(<PlatformControlRenderer
      parsedData={enriched({ action: 'get-schedule' }, {
        action: 'get-schedule',
        schedule: { ...sched, targetId: 'agent-other' },
      })}
      agentId="agent-self"
    />);
    expect(document.body.textContent).toMatch(/agent-other/);
    expect(document.body.textContent).not.toMatch(/⟲ self/);
  });
});

describe('toggle / delete / trigger', () => {
  it('toggle-schedule shows current enabled state', () => {
    render(<PlatformControlRenderer
      parsedData={enriched({ action: 'toggle-schedule' }, { action: 'toggle-schedule', scheduleId: 'sched-1', enabled: true })}
    />);
    expect(document.body.textContent).toMatch(/sched-1/);
    expect(document.body.textContent).toMatch(/enabled/);
  });

  it('delete-schedule shows minimal removed banner', () => {
    render(<PlatformControlRenderer
      parsedData={enriched({ action: 'delete-schedule' }, { action: 'delete-schedule', scheduleId: 'sched-1' })}
    />);
    expect(document.body.textContent).toMatch(/Schedule removed/);
    expect(document.body.textContent).toMatch(/sched-1/);
  });

  it('trigger-schedule shows fired indicator', () => {
    render(<PlatformControlRenderer
      parsedData={enriched({ action: 'trigger-schedule' }, { action: 'trigger-schedule', scheduleId: 'sched-1', triggered: true })}
    />);
    expect(document.body.textContent).toMatch(/Schedule fired/);
    expect(document.body.textContent).toMatch(/sched-1/);
  });
});

describe('schedule-self-resume', () => {
  it('renders the distinctive "I\'ll come back" card with the runAt countdown', () => {
    const runAt = new Date(Date.now() + 3_600_000).toISOString();
    render(<PlatformControlRenderer
      parsedData={enriched(
        { action: 'schedule-self-resume' },
        {
          action: 'schedule-self-resume',
          runAt,
          cronExpression: '0 14 26 4 *',
          schedule: {
            id: 'self-1', name: 'Wake @ tomorrow', cronExpression: '0 14 26 4 *',
            enabled: true, runOnce: true, targetType: 'agent', targetId: 'agent-self',
            nextRun: runAt, prompt: 'Resume work.',
          },
        }
      )}
      agentId="agent-self"
    />);
    expect(document.body.textContent).toMatch(/I'll come back to this in/);
    expect(document.body.textContent).toMatch(/Self-resume armed/);
    expect(document.body.textContent).toMatch(/one-shot/);
  });
});

describe('list-presets', () => {
  it('renders preset names as a chip cloud', () => {
    render(<PlatformControlRenderer
      parsedData={enriched(
        { action: 'list-presets' },
        { action: 'list-presets', presets: ['daily', 'every-hour', 'weekdays'], note: 'Use either preset name or raw cron.' }
      )}
    />);
    expect(document.body.textContent).toMatch(/daily/);
    expect(document.body.textContent).toMatch(/every-hour/);
    expect(document.body.textContent).toMatch(/Use either preset name/);
  });
});

describe('list-capabilities (single-slice — schedule only)', () => {
  it('renders the schedule slice with level + notes', () => {
    render(<PlatformControlRenderer
      parsedData={enriched(
        { action: 'list-capabilities' },
        {
          action: 'list-capabilities',
          capabilities: {
            scheduledTasks: {
              level: 'own',
              canMutateOwn: true, canListOwn: true, canMutateAll: false, canListAll: false,
              notes: ['Flow-target schedules are not reachable from this tool.'],
            },
          },
        }
      )}
    />);
    expect(document.body.textContent).toMatch(/Scheduled tasks/);
    expect(document.body.textContent).toMatch(/level: own/);
    expect(document.body.textContent).toMatch(/Flow-target schedules are not reachable/);
  });

  it('renders for "all" level', () => {
    render(<PlatformControlRenderer
      parsedData={enriched(
        { action: 'list-capabilities' },
        { action: 'list-capabilities', capabilities: { scheduledTasks: { level: 'all' } } }
      )}
    />);
    expect(document.body.textContent).toMatch(/level: all/);
  });
});

describe('errors', () => {
  it('disabled error renders compact (gray) row', () => {
    render(<PlatformControlRenderer
      parsedData={enriched(
        { action: 'list-schedules' },
        { action: 'list-schedules', error: 'Scheduled-tasks access is disabled', disabled: true },
        false
      )}
    />);
    expect(screen.getByTestId('pc-error')).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/disabled/i);
  });

  it('non-disabled error renders rose-toned row', () => {
    render(<PlatformControlRenderer
      parsedData={enriched(
        { action: 'create-schedule' },
        { action: 'create-schedule', error: 'cronExpression is required' },
        false
      )}
    />);
    expect(screen.getByTestId('pc-error')).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/cronExpression is required/);
  });
});

describe('unknown action falls through to raw-result details', () => {
  it('renders a <details> with JSON when action is unknown to this renderer', () => {
    render(<PlatformControlRenderer
      parsedData={enriched(
        { action: 'mystery-action' },
        { action: 'mystery-action', some: 'data' }
      )}
    />);
    expect(document.body.textContent).toMatch(/Raw result/);
  });
});

describe('agent CRUD views', () => {
  it('list-agents renders one card per agent with self / created-by-me chips', () => {
    render(<PlatformControlRenderer
      parsedData={enriched(
        { action: 'list-agents' },
        {
          action: 'list-agents',
          agents: [
            { id: 'me',     name: 'Me',     createdBy: null },
            { id: 'mine',   name: 'Mine',   createdBy: 'me' },
            { id: 'theirs', name: 'Theirs', createdBy: 'someone' },
          ],
        }
      )}
      agentId="me"
    />);
    const cards = screen.getAllByTestId('pc-agent-card');
    expect(cards).toHaveLength(3);
    expect(document.body.textContent).toMatch(/this is you/);
    expect(document.body.textContent).toMatch(/created by you/);
  });

  it('create-agent renders the new agent card; clamp notice surfaces when present', () => {
    render(<PlatformControlRenderer
      parsedData={enriched(
        { action: 'create-agent' },
        {
          action: 'create-agent',
          agent: { id: 'new-1', name: 'New Agent', createdBy: 'me' },
          clamps: [
            { key: 'scheduledTasks', requested: 'all', clampedTo: 'own' },
            { key: 'agents', requested: 'all', clampedTo: 'self-created' },
          ],
        }
      )}
      agentId="me"
    />);
    expect(screen.getByTestId('pc-agent-card').textContent).toMatch(/New Agent/);
    expect(screen.getByTestId('pc-clamp-notice')).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/Permissions clamped/);
    expect(document.body.textContent).toMatch(/scheduledTasks/);
  });

  it('update-agent without clamps does NOT show the clamp notice', () => {
    render(<PlatformControlRenderer
      parsedData={enriched(
        { action: 'update-agent' },
        {
          action: 'update-agent',
          agent: { id: 'mine', name: 'Renamed', createdBy: 'me' },
          clamps: [],
        }
      )}
      agentId="me"
    />);
    expect(screen.queryByTestId('pc-clamp-notice')).toBeNull();
    expect(document.body.textContent).toMatch(/Renamed/);
  });

  it('delete-agent renders cascade report with counts and team list', () => {
    render(<PlatformControlRenderer
      parsedData={enriched(
        { action: 'delete-agent' },
        {
          action: 'delete-agent',
          agentId: 'mine',
          report: {
            schedulesDeleted: 2,
            memoriesCleaned: true,
            teamsLeft: ['team-a', 'team-b'],
            agentDeleted: true,
            errors: [],
          },
        }
      )}
    />);
    expect(screen.getByTestId('pc-cascade-report')).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/Schedules deleted:/);
    expect(document.body.textContent).toMatch(/Memories cleaned:/);
    expect(document.body.textContent).toMatch(/team-a, team-b/);
  });

  it('delete-agent with errors shows the expandable error list', () => {
    render(<PlatformControlRenderer
      parsedData={enriched(
        { action: 'delete-agent' },
        {
          action: 'delete-agent',
          agentId: 'mine',
          report: {
            schedulesDeleted: 0,
            memoriesCleaned: false,
            teamsLeft: [],
            agentDeleted: false,
            errors: [{ step: 'memories', error: 'disk full' }],
          },
        }
      )}
    />);
    expect(document.body.textContent).toMatch(/1 step error/);
    expect(document.body.textContent).toMatch(/disk full/);
  });
});

describe('team views', () => {
  it('list-teams renders one card per team with owner / member chips', () => {
    render(<PlatformControlRenderer
      parsedData={enriched(
        { action: 'list-teams' },
        {
          action: 'list-teams',
          teams: [
            { id: 't1', name: 'Mine',   memberAgentIds: [],       createdBy: 'me' },
            { id: 't2', name: 'Joined', memberAgentIds: ['me'],   createdBy: 'someone' },
          ],
        }
      )}
      agentId="me"
    />);
    const cards = screen.getAllByTestId('pc-team-card');
    expect(cards).toHaveLength(2);
    expect(document.body.textContent).toMatch(/you own this/);
    expect(document.body.textContent).toMatch(/you're a member/);
  });

  it('create-team renders the new team card', () => {
    render(<PlatformControlRenderer
      parsedData={enriched(
        { action: 'create-team' },
        { action: 'create-team', team: { id: 't1', name: 'New Team', memberAgentIds: [], createdBy: 'me' } }
      )}
      agentId="me"
    />);
    expect(screen.getByTestId('pc-team-card').textContent).toMatch(/New Team/);
  });

  it('delete-team renders minimal removed banner with the teamId', () => {
    render(<PlatformControlRenderer
      parsedData={enriched(
        { action: 'delete-team' },
        { action: 'delete-team', teamId: 'team-x' }
      )}
    />);
    expect(screen.getByTestId('pc-team-deleted')).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/team-x/);
  });

  it('add-team-member shows "joined team" when self adds itself', () => {
    render(<PlatformControlRenderer
      parsedData={enriched(
        { action: 'add-team-member' },
        {
          action: 'add-team-member',
          agentId: 'me', teamId: 't1',
          team: { id: 't1', name: 'T1', memberAgentIds: ['me'], createdBy: 'someone' },
        }
      )}
      agentId="me"
    />);
    expect(document.body.textContent).toMatch(/joined team/);
  });

  it('remove-team-member shows "left team" when self removes itself', () => {
    render(<PlatformControlRenderer
      parsedData={enriched(
        { action: 'remove-team-member' },
        {
          action: 'remove-team-member',
          agentId: 'me', teamId: 't1',
          team: { id: 't1', name: 'T1', memberAgentIds: [], createdBy: 'someone' },
        }
      )}
      agentId="me"
    />);
    expect(document.body.textContent).toMatch(/left team/);
  });
});

describe('extended capabilities view', () => {
  it('renders all three slices when present', () => {
    render(<PlatformControlRenderer
      parsedData={enriched(
        { action: 'list-capabilities' },
        {
          action: 'list-capabilities',
          capabilities: {
            scheduledTasks: { level: 'own', notes: ['flow note'] },
            agents:         { level: 'self-created', maxAgentsCreated: 3, notes: ['agent note'] },
            teams:          { scope: { member: true, ownedByMe: true, all: false }, disabled: false, notes: ['team note'] },
          },
        }
      )}
    />);
    const view = screen.getByTestId('pc-capabilities');
    expect(view.textContent).toMatch(/Scheduled tasks/);
    expect(view.textContent).toMatch(/Agents/);
    expect(view.textContent).toMatch(/Teams/);
    expect(view.textContent).toMatch(/quota: 3/);
    expect(view.textContent).toMatch(/member/);
    expect(view.textContent).toMatch(/ownedByMe/);
    // Notes from each slice
    expect(view.textContent).toMatch(/flow note/);
    expect(view.textContent).toMatch(/agent note/);
    expect(view.textContent).toMatch(/team note/);
  });

  it('shows "disabled" tags + "quota: unlimited" defaults', () => {
    render(<PlatformControlRenderer
      parsedData={enriched(
        { action: 'list-capabilities' },
        {
          action: 'list-capabilities',
          capabilities: {
            scheduledTasks: { level: 'disabled' },
            agents:         { level: 'all' },                             // no quota
            teams:          { scope: { member: false, ownedByMe: false, all: false }, disabled: true },
          },
        }
      )}
    />);
    expect(document.body.textContent).toMatch(/quota: unlimited/);
    expect(document.body.textContent).toMatch(/disabled/);
  });
});
