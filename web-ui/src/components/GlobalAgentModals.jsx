/**
 * GlobalAgentModals — host for agent-related modals that should be
 * openable from any route, driven by the `modals` slice in appStore.
 *
 * Why this exists: `AgentManager.jsx` used to own the modal state
 * locally, so shortcuts like Alt+P and Alt+T only worked while on the
 * /agents route. Lifting the four highest-leverage modals up here lets
 * keyboard shortcuts (defined in Layout.jsx) open them from chat,
 * flows, gallery, anywhere — with the edit modal aware of the
 * currently-selected chat agent.
 *
 * The four hosted modals:
 *   - Create Pilot     (createAgent)   — Alt+P
 *   - Create Team      (createTeam)    — Alt+T
 *   - Edit Pilot       (editAgent)     — Alt+E (current agent aware)
 *   - Load/Import Pilot (importAgent)  — Alt+L
 *
 * AgentManager still triggers these via openModal/closeModal store
 * actions, so its existing buttons keep working.
 */
import React from 'react';
import toast from 'react-hot-toast';
import { useAppStore } from '../stores/appStore.js';
import AgentCreationModal from './AgentCreationModal.jsx';
import AgentEditModal from './AgentEditModal.jsx';
import AgentImportModal from './AgentImportModal.jsx';
import TeamCreationModal from './TeamCreationModal.jsx';

function GlobalAgentModals() {
  const modals = useAppStore(s => s.modals);
  const closeModal = useAppStore(s => s.closeModal);
  const refreshAgents = useAppStore(s => s.refreshAgents);
  const switchAgent = useAppStore(s => s.switchAgent);
  const createTeam = useAppStore(s => s.createTeam);
  const agents = useAppStore(s => s.agents);
  const currentAgent = useAppStore(s => s.currentAgent);

  // Defensive: store may not be fully initialized in tests.
  if (!modals) return null;

  return (
    <>
      {modals.createAgent && (
        <AgentCreationModal
          onClose={() => closeModal('createAgent')}
          onSuccess={() => {
            closeModal('createAgent');
            // refreshAgents may already be triggered by the modal
            // itself; calling here is idempotent and ensures global
            // openers (e.g. Alt+P from chat) see the new pilot.
            if (typeof refreshAgents === 'function') refreshAgents();
          }}
        />
      )}

      {modals.editAgent && (
        <AgentEditModal
          agent={modals.editAgent}
          onClose={() => closeModal('editAgent')}
          onSuccess={() => {
            closeModal('editAgent');
            if (typeof refreshAgents === 'function') refreshAgents();
          }}
        />
      )}

      {modals.importAgent && (
        <AgentImportModal
          isOpen={true}
          onClose={() => closeModal('importAgent')}
          onImport={async (agent) => {
            // Modal stays open after each load so the user can batch-load
            // multiple pilots in one session. The user dismisses with X
            // or Esc when done. The modal updates the row's "isLoaded"
            // state inline so the loaded agent visibly flips state.
            //
            // Auto-switch was a single-load convenience that becomes
            // confusing in batch mode (every load would yank the chat
            // view to a new agent). We only auto-switch when the user
            // had NO active pilot before — that's the genuine "starting
            // fresh, this is the first one" case where the switch is
            // expected. Subsequent loads leave the active agent alone.
            const wasFirstLoad = !currentAgent?.id && (!agents || agents.length === 0);
            if (typeof refreshAgents === 'function') await refreshAgents();
            if (wasFirstLoad && agent?.id && typeof switchAgent === 'function') {
              try { await switchAgent(agent.id); } catch { /* non-fatal */ }
            }
          }}
          activeAgents={agents || []}
        />
      )}

      {modals.createTeam && (
        <TeamCreationModal
          onClose={() => closeModal('createTeam')}
          onSubmit={async (teamData) => {
            try {
              if (typeof createTeam === 'function') {
                await createTeam(teamData);
                toast.success(`Team "${teamData.name}" created!`);
              }
              closeModal('createTeam');
            } catch (err) {
              toast.error(`Failed to create team: ${err.message}`);
            }
          }}
        />
      )}
    </>
  );
}

export default GlobalAgentModals;
