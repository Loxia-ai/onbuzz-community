/**
 * PlatformControlConfigurator — three-level radio for scheduled-tasks
 * permission. Selecting a level should call onChange with the merged
 * value object; default is 'disabled' when value is null/empty.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import PlatformControlConfigurator from '../PlatformControlConfigurator.jsx';

afterEach(() => cleanup());

describe('initial render', () => {
  it('defaults to "disabled" when value is null', () => {
    render(<PlatformControlConfigurator value={null} onChange={() => {}} />);
    expect(screen.getByTestId('scheduledTasks-disabled').checked).toBe(true);
    expect(screen.getByTestId('scheduledTasks-own').checked).toBe(false);
    expect(screen.getByTestId('scheduledTasks-all').checked).toBe(false);
  });

  it('honors a pre-existing value', () => {
    render(<PlatformControlConfigurator value={{ scheduledTasks: 'own' }} onChange={() => {}} />);
    expect(screen.getByTestId('scheduledTasks-own').checked).toBe(true);
    expect(screen.getByTestId('scheduledTasks-disabled').checked).toBe(false);
  });

  it('renders human-readable copy for each level', () => {
    render(<PlatformControlConfigurator value={null} onChange={() => {}} />);
    expect(document.body.textContent).toMatch(/Disabled/);
    expect(document.body.textContent).toMatch(/Own schedules only/);
    expect(document.body.textContent).toMatch(/All agents/);
  });
});

describe('selection', () => {
  it('clicking "own" calls onChange with merged value', () => {
    const onChange = vi.fn();
    render(<PlatformControlConfigurator value={null} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('scheduledTasks-own'));
    expect(onChange).toHaveBeenCalledWith({ scheduledTasks: 'own' });
  });

  it('clicking "all" merges with existing keys (does not overwrite)', () => {
    const onChange = vi.fn();
    // Future-proofing: simulate another feature key being already present.
    render(<PlatformControlConfigurator value={{ futureFeature: true }} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('scheduledTasks-all'));
    expect(onChange).toHaveBeenCalledWith({ futureFeature: true, scheduledTasks: 'all' });
  });

  it('clicking "disabled" returns to disabled state', () => {
    const onChange = vi.fn();
    render(<PlatformControlConfigurator value={{ scheduledTasks: 'all' }} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('scheduledTasks-disabled'));
    expect(onChange).toHaveBeenCalledWith({ scheduledTasks: 'disabled' });
  });
});

describe('disabled state (during save)', () => {
  it('disables all radios when `disabled` prop is true', () => {
    render(<PlatformControlConfigurator value={null} onChange={() => {}} disabled />);
    expect(screen.getByTestId('scheduledTasks-disabled').disabled).toBe(true);
    expect(screen.getByTestId('scheduledTasks-own').disabled).toBe(true);
    expect(screen.getByTestId('scheduledTasks-all').disabled).toBe(true);
  });
});

describe('agents section', () => {
  it('defaults to "disabled"', () => {
    render(<PlatformControlConfigurator value={null} onChange={() => {}} />);
    expect(screen.getByTestId('agents-disabled').checked).toBe(true);
    expect(screen.getByTestId('agents-self-created').checked).toBe(false);
    expect(screen.getByTestId('agents-all').checked).toBe(false);
  });

  it('selecting "self-created" merges with existing keys (does not overwrite scheduledTasks)', () => {
    const onChange = vi.fn();
    render(<PlatformControlConfigurator value={{ scheduledTasks: 'own' }} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('agents-self-created'));
    expect(onChange).toHaveBeenCalledWith({ scheduledTasks: 'own', agents: 'self-created' });
  });

  it('hides the maxAgentsCreated quota input when level is "disabled"', () => {
    render(<PlatformControlConfigurator value={null} onChange={() => {}} />);
    expect(screen.queryByTestId('agents-maxAgentsCreated')).toBeNull();
  });

  it('shows the maxAgentsCreated input once a non-disabled level is set', () => {
    render(<PlatformControlConfigurator value={{ agents: 'self-created' }} onChange={() => {}} />);
    expect(screen.getByTestId('agents-maxAgentsCreated')).toBeInTheDocument();
  });

  it('empty maxAgentsCreated → onChange receives null (unlimited)', () => {
    const onChange = vi.fn();
    render(<PlatformControlConfigurator value={{ agents: 'all', maxAgentsCreated: 5 }} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('agents-maxAgentsCreated'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith({ agents: 'all', maxAgentsCreated: null });
  });

  it('numeric maxAgentsCreated → onChange receives the number', () => {
    const onChange = vi.fn();
    render(<PlatformControlConfigurator value={{ agents: 'all' }} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('agents-maxAgentsCreated'), { target: { value: '3' } });
    expect(onChange).toHaveBeenCalledWith({ agents: 'all', maxAgentsCreated: 3 });
  });
});

describe('teams section (multi-select)', () => {
  it('defaults all three checkboxes to unchecked', () => {
    render(<PlatformControlConfigurator value={null} onChange={() => {}} />);
    expect(screen.getByTestId('teams-member').checked).toBe(false);
    expect(screen.getByTestId('teams-ownedByMe').checked).toBe(false);
    expect(screen.getByTestId('teams-all').checked).toBe(false);
  });

  it('checking a team scope merges into the teams object (multi-select)', () => {
    const onChange = vi.fn();
    render(<PlatformControlConfigurator value={null} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('teams-member'));
    expect(onChange).toHaveBeenCalledWith({
      teams: { member: true, ownedByMe: false, all: false },
    });
  });

  it('checking a second box does NOT clear the first (it\'s NOT radio)', () => {
    const onChange = vi.fn();
    render(<PlatformControlConfigurator
      value={{ teams: { member: true, ownedByMe: false, all: false } }}
      onChange={onChange}
    />);
    fireEvent.click(screen.getByTestId('teams-ownedByMe'));
    expect(onChange).toHaveBeenCalledWith({
      teams: { member: true, ownedByMe: true, all: false },
    });
  });

  it('unchecking a box clears just that flag', () => {
    const onChange = vi.fn();
    render(<PlatformControlConfigurator
      value={{ teams: { member: true, ownedByMe: true, all: false } }}
      onChange={onChange}
    />);
    fireEvent.click(screen.getByTestId('teams-member'));
    expect(onChange).toHaveBeenCalledWith({
      teams: { member: false, ownedByMe: true, all: false },
    });
  });

  it('all checkboxes disable when `disabled` prop is true', () => {
    render(<PlatformControlConfigurator value={null} onChange={() => {}} disabled />);
    expect(screen.getByTestId('teams-member').disabled).toBe(true);
    expect(screen.getByTestId('teams-ownedByMe').disabled).toBe(true);
    expect(screen.getByTestId('teams-all').disabled).toBe(true);
  });
});
