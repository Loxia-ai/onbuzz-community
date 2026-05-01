/**
 * Modal slice in appStore — feeds GlobalAgentModals and the keyboard
 * shortcuts in Layout. The flag for editAgent carries the agent object
 * (so the global modal knows which one to edit); the others are booleans.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../appStore.js';

beforeEach(() => {
  // Reset modal slice to defaults — other slices are left as-is.
  useAppStore.setState({
    modals: { editAgent: null, importAgent: false, createAgent: false, createTeam: false },
  });
});

describe('appStore.modals', () => {
  it('defaults are: editAgent null, three booleans false', () => {
    const m = useAppStore.getState().modals;
    expect(m).toEqual({ editAgent: null, importAgent: false, createAgent: false, createTeam: false });
  });

  it('openModal("createAgent") sets the boolean to true', () => {
    useAppStore.getState().openModal('createAgent');
    expect(useAppStore.getState().modals.createAgent).toBe(true);
  });

  it('openModal("editAgent", agent) carries the agent object', () => {
    const agent = { id: 'a1', name: 'Coder' };
    useAppStore.getState().openModal('editAgent', agent);
    expect(useAppStore.getState().modals.editAgent).toBe(agent);
  });

  it('openModal("editAgent") with no payload becomes null (no modal opens)', () => {
    useAppStore.getState().openModal('editAgent');
    expect(useAppStore.getState().modals.editAgent).toBeNull();
  });

  it('closeModal sets boolean back to false', () => {
    useAppStore.getState().openModal('createTeam');
    useAppStore.getState().closeModal('createTeam');
    expect(useAppStore.getState().modals.createTeam).toBe(false);
  });

  it('closeModal("editAgent") sets the agent back to null', () => {
    useAppStore.getState().openModal('editAgent', { id: 'a1' });
    useAppStore.getState().closeModal('editAgent');
    expect(useAppStore.getState().modals.editAgent).toBeNull();
  });

  it('opening one modal does not affect the others', () => {
    useAppStore.getState().openModal('createAgent');
    expect(useAppStore.getState().modals).toEqual({
      editAgent: null,
      importAgent: false,
      createAgent: true,
      createTeam: false,
    });
  });
});
