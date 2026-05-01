import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PlusIcon,
  PlayIcon,
  PauseIcon,
  TrashIcon,
  ChatBubbleLeftRightIcon,
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  ArrowsUpDownIcon,
  CodeBracketIcon,
  ShieldCheckIcon,
  CubeTransparentIcon,
  BoltIcon,
  UserGroupIcon,
  ChevronDownIcon,
  UserMinusIcon,
  MagnifyingGlassIcon
} from '@heroicons/react/24/outline';
import { useAppStore } from '../stores/appStore.js';
import { useModelsStore } from '../stores/modelsStore.js';
import { api } from '../services/api.js';
import {
  AGENT_TEMPLATES,
  AGENT_TEMPLATE_CONFIGS,
  resolvePreferredModel
} from '../constants/index.js';
import PilotCard from './PilotCard.jsx';
import TeamFrame from './TeamFrame.jsx';
import TeamCreationModal from './TeamCreationModal.jsx';
import AgentCreationModal from './AgentCreationModal.jsx';
// AgentEditModal and AgentImportModal are now mounted globally in
// GlobalAgentModals.jsx (so keyboard shortcuts in Layout can open them
// from any route). AgentManager triggers them via openModal(...).
import TeamLoadModal from './TeamLoadModal.jsx';
import TeamTaskBoard from './TeamTaskBoard.jsx';
import LoadingSpinner from './LoadingSpinner.jsx';
import toast from 'react-hot-toast';
import { formatShortcut } from '../utils/keyboardShortcuts.js';

// Express agent name generator
const EXPRESS_NAMES = ['Swift', 'Bolt', 'Flash', 'Rapid', 'Quick', 'Turbo', 'Dash', 'Spark', 'Blitz', 'Zoom'];
const getExpressAgentName = (prefix) => {
  const randomName = EXPRESS_NAMES[Math.floor(Math.random() * EXPRESS_NAMES.length)];
  const serial = Date.now().toString().slice(-4);
  return `${prefix} ${randomName} ${serial}`;
};

// Map template IDs to expressTemplates keys
const EXPRESS_TEMPLATE_KEYS = {
  [AGENT_TEMPLATES.CODING_ASSISTANT]: 'coding',
  [AGENT_TEMPLATES.SECURITY_ARCHITECT]: 'security',
  [AGENT_TEMPLATES.SYSTEM_ANALYST]: 'coding' // Uses same config as coding
};

// Fetch all available tool IDs from backend (single source of truth)
const fetchAllToolIds = async () => {
  try {
    const response = await api.getTools();
    if (response.success && response.tools) {
      return response.tools.map(t => t.id);
    }
  } catch (e) {
    console.warn('Failed to fetch tools for express create:', e.message);
  }
  return null;
};

// Find the best opus model (highest version) from available models
const findBestOpusModel = (availableModels) => {
  const opusModels = (availableModels || []).filter(m =>
    (m.name || '').toLowerCase().includes('opus')
  );
  if (opusModels.length === 0) return null;
  opusModels.sort((a, b) => {
    const extract = (m) => (m.name || '').match(/(\d+)/g)?.map(Number) || [0];
    const aV = extract(a), bV = extract(b);
    for (let i = 0; i < Math.max(aV.length, bV.length); i++) {
      const diff = (bV[i] || 0) - (aV[i] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });
  return opusModels[0];
};

function AgentManager() {
  const navigate = useNavigate();
  const {
    agents,
    currentAgent,
    switchAgent,
    pauseAgent,
    resumeAgent,
    deleteAgent,
    unloadAgent,
    duplicateAgent,
    refreshAgents,
    createAgent,
    loading,
    getAgentStatus,
    // Team state and actions
    teams,
    teamsLoading,
    fetchTeams,
    createTeam,
    updateTeam,
    deleteTeam: deleteTeamAction,
    loadTeam,
    addAgentToTeam,
    removeAgentFromTeam,
    getAgentTeams,
    getUnassignedAgents
  } = useAppStore();

  const { models, fetchModels } = useModelsStore();

  // UI State.
  // Three of the modals (create-pilot / edit-pilot / load-pilot) are
  // now hosted globally via GlobalAgentModals so keyboard shortcuts in
  // Layout can open them from any route. AgentManager opens them via
  // the store's openModal action.
  // showCreateTeam stays LOCAL because the drag-drop flow needs to pair
  // it with `pendingTeamAgent` — the global team modal handles only the
  // plain "create team" case.
  const openModal = useAppStore(s => s.openModal);
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [showLoadMenu, setShowLoadMenu] = useState(false);
  const [showTeamLoadModal, setShowTeamLoadModal] = useState(false);
  const [savedAgentsList, setSavedAgentsList] = useState([]);
  const [agentToClone, setAgentToClone] = useState(null);
  const [agentToUnload, setAgentToUnload] = useState(null);
  const [agentToDelete, setAgentToDelete] = useState(null);
  const [teamToEdit, setTeamToEdit] = useState(null);
  const [teamToDelete, setTeamToDelete] = useState(null);
  const [actionLoading, setActionLoading] = useState({});
  const [teamActionLoading, setTeamActionLoading] = useState({});
  const [expressCreating, setExpressCreating] = useState(null);
  const [teamsFirst, setTeamsFirst] = useState(true); // Toggle section order

  // Stage 8B: Manager view toggle (squadron vs task board)
  const [managerView, setManagerView] = useState('squadron'); // 'squadron' or 'tasks'

  // Stage 4A: Expandable agent list + filter
  const [pilotFilter, setPilotFilter] = useState('');
  const [pilotsExpanded, setPilotsExpanded] = useState(false);

  // Stage 4B: Two-level team → agent hierarchy toggle
  const [viewMode, setViewMode] = useState('flat'); // 'flat' or 'team'
  const [collapsedTeams, setCollapsedTeams] = useState(new Set());

  // Drag and drop state
  // TODO: Consider @dnd-kit library for enhanced touch support in the future
  const [draggedAgent, setDraggedAgent] = useState(null);
  const [draggedAgentTeamId, setDraggedAgentTeamId] = useState(null); // Track which team the dragged agent is from
  const [dropTargetTeamId, setDropTargetTeamId] = useState(null);
  const [isTeamSectionDropTarget, setIsTeamSectionDropTarget] = useState(false);
  const [isRemoveZoneTarget, setIsRemoveZoneTarget] = useState(false);
  const [pendingTeamAgent, setPendingTeamAgent] = useState(null); // Agent to add to newly created team
  const [isUnassignedSectionVisible, setIsUnassignedSectionVisible] = useState(true);
  const unassignedSectionRef = useRef(null);
  const removeZoneRef = useRef(null);
  const unassignedDropRef = useRef(null);

  // Highlighted agent state (for newly created agents)
  const [highlightedAgentId, setHighlightedAgentId] = useState(null);
  const agentCardRefs = useRef({});

  // Clear highlight after 3 seconds and scroll to the agent
  useEffect(() => {
    if (highlightedAgentId) {
      // Scroll to the highlighted agent card
      const cardRef = agentCardRefs.current[highlightedAgentId];
      if (cardRef) {
        setTimeout(() => {
          cardRef.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100); // Small delay to ensure the card is rendered
      }

      // Clear highlight after 3 seconds
      const timer = setTimeout(() => {
        setHighlightedAgentId(null);
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [highlightedAgentId]);

  // Fetch teams on mount
  useEffect(() => {
    refreshAgents();
    fetchTeams();
  }, [refreshAgents, fetchTeams]);

  // Keyboard shortcuts (Alt+P / Alt+T / Alt+E / Alt+L) are now wired
  // in Layout.jsx so they fire from any route, not just /agents. The
  // listener that used to live here was removed.

  // Fetch saved agents when team load modal opens
  useEffect(() => {
    if (showTeamLoadModal) {
      fetch('/api/agents/available')
        .then(res => res.json())
        .then(data => {
          if (data.success && data.agents) {
            setSavedAgentsList(data.agents);
          }
        })
        .catch(err => console.error('Failed to fetch saved agents:', err));
    }
  }, [showTeamLoadModal]);

  // Track visibility of unassigned section for floating drop zone
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsUnassignedSectionVisible(entry.isIntersecting);
      },
      { threshold: 0.1 } // Consider visible if at least 10% is showing
    );

    if (unassignedSectionRef.current) {
      observer.observe(unassignedSectionRef.current);
    }

    return () => observer.disconnect();
  }, []);

  // Touch drop event handlers using event delegation
  useEffect(() => {
    const handleTouchDrop = async (e) => {
      const dropZone = e.target.closest('[data-drop-zone]');
      if (!dropZone) return;

      const zoneId = dropZone.getAttribute('data-drop-zone');
      const { agentId } = e.detail || {};

      // Handle remove zones (floating zone, unassigned area, unassigned grid)
      if (['remove-zone', 'unassigned-area', 'unassigned-grid'].includes(zoneId)) {
        if (!agentId || !draggedAgentTeamId) return;

        try {
          await removeAgentFromTeam(draggedAgentTeamId, agentId);
          toast.success('Pilot removed from team');
        } catch (error) {
          toast.error(`Failed to remove: ${error.message}`);
        }

        setDraggedAgent(null);
        setDraggedAgentTeamId(null);
        setIsRemoveZoneTarget(false);
      }
    };

    const handleTouchDragEnter = (e) => {
      const dropZone = e.target.closest('[data-drop-zone]');
      if (!dropZone) return;

      const zoneId = dropZone.getAttribute('data-drop-zone');
      if (['remove-zone', 'unassigned-area', 'unassigned-grid'].includes(zoneId)) {
        setIsRemoveZoneTarget(true);
      }
    };

    const handleTouchDragLeave = (e) => {
      const dropZone = e.target.closest('[data-drop-zone]');
      if (!dropZone) return;

      const zoneId = dropZone.getAttribute('data-drop-zone');
      if (['remove-zone', 'unassigned-area', 'unassigned-grid'].includes(zoneId)) {
        setIsRemoveZoneTarget(false);
      }
    };

    // Use event delegation on document
    document.addEventListener('touchdrop', handleTouchDrop);
    document.addEventListener('touchdragenter', handleTouchDragEnter);
    document.addEventListener('touchdragleave', handleTouchDragLeave);

    return () => {
      document.removeEventListener('touchdrop', handleTouchDrop);
      document.removeEventListener('touchdragenter', handleTouchDragEnter);
      document.removeEventListener('touchdragleave', handleTouchDragLeave);
    };
  }, [draggedAgentTeamId, removeAgentFromTeam]);

  // Get unassigned agents (not in any team)
  const unassignedAgents = getUnassignedAgents ? getUnassignedAgents() : agents.filter(a => {
    const agentTeams = teams.filter(t => t.memberAgentIds?.includes(a.id));
    return agentTeams.length === 0;
  });

  // Stage 4A: Filter and paginate unassigned agents
  const filteredUnassigned = unassignedAgents.filter(a => !pilotFilter || a.name.toLowerCase().includes(pilotFilter.toLowerCase()));
  const visiblePilots = pilotsExpanded ? filteredUnassigned : filteredUnassigned.slice(0, 5);

  // Stage 4B: Group all agents by team for team view mode
  const agentsByTeam = React.useMemo(() => {
    const grouped = {};
    teams.forEach(team => {
      const members = (team.memberAgentIds || [])
        .map(id => agents.find(a => a && a.id === id))
        .filter(Boolean);
      if (members.length > 0) {
        grouped[team.id] = { team, members };
      }
    });
    return grouped;
  }, [teams, agents]);

  // Get visible teams: teams with loaded members OR empty teams (no members assigned)
  // Hide teams that have members but none are loaded (can be loaded via Load Team modal)
  const visibleTeams = teams.filter(team => {
    const memberCount = team.memberAgentIds?.length || 0;
    if (memberCount === 0) return true; // Show empty teams so users can add members
    // Show teams that have at least one loaded member
    return team.memberAgentIds?.some(agentId => agents.some(a => a.id === agentId));
  });

  // Count of teams with loaded members (for stats)
  const loadedTeamsCount = teams.filter(team => {
    return team.memberAgentIds?.some(agentId => agents.some(a => a.id === agentId));
  }).length;

  // Express agent creation
  const handleExpressCreate = async (templateId) => {
    if (loading || expressCreating) return;
    setExpressCreating(templateId);

    try {
      const templateConfig = AGENT_TEMPLATE_CONFIGS[templateId];
      const prefixMap = {
        [AGENT_TEMPLATES.CODING_ASSISTANT]: 'Coder',
        [AGENT_TEMPLATES.SECURITY_ARCHITECT]: 'SecArch',
        [AGENT_TEMPLATES.SYSTEM_ANALYST]: 'Analyst',
        [AGENT_TEMPLATES.TEAM_MANAGER]: 'Manager'
      };
      const prefix = prefixMap[templateId] || 'Agent';
      const name = getExpressAgentName(prefix);
      // Fetch all tools from backend — single source of truth (no hardcoded lists)
      const allToolIds = await fetchAllToolIds();
      const capabilities = allToolIds || [];

      let availableModels = models;
      if (!availableModels || availableModels.length === 0) {
        await fetchModels();
        availableModels = useModelsStore.getState().models;
      }

      // Use the template model resolver (exact match → term scoring → random)
      const modelsList = availableModels.map(m => ({ id: m.name, modelName: m.name, ...m }));
      let selectedModelId = resolvePreferredModel(templateId, modelsList);

      // Final fallback to first available model
      if (!selectedModelId && availableModels?.length > 0) {
        selectedModelId = availableModels[0].name;
      }

      if (!selectedModelId) {
        throw new Error('No models available.');
      }

      let workingDirectory = null;
      try {
        const sysInfo = await api.getSystemInfo();
        if (sysInfo.success && sysInfo.data?.homedir) {
          const homedir = sysInfo.data.homedir;
          const platform = sysInfo.data.platform;
          const sep = platform === 'win32' ? '\\' : '/';
          workingDirectory = `${homedir}${sep}Loxia`;
        }
      } catch (e) {
        console.warn('Could not get system info:', e.message);
      }

      const newAgent = await createAgent(name, selectedModelId, templateConfig.prompt, {
        dynamicModelRouting: false,
        capabilities,
        directoryAccess: workingDirectory ? {
          workingDirectory,
          readOnlyDirectories: [],
          writeEnabledDirectories: [],
          restrictToProject: false,
          allowSystemAccess: false
        } : null
      });

      toast.success(`${templateConfig.name} "${name}" created!`);

      // Highlight the newly created agent and scroll to it
      if (newAgent?.id) {
        setHighlightedAgentId(newAgent.id);
      }
    } catch (error) {
      toast.error(`Failed to create: ${error.message}`);
    } finally {
      setExpressCreating(null);
    }
  };

  // Agent handlers
  const handleOpenChat = (agent) => {
    switchAgent(agent.id);
    navigate('/');
  };

  const handleAgentSettings = (agent) => {
    openModal('editAgent', agent);
  };

  const handlePauseAgent = async (agent) => {
    setActionLoading(prev => ({ ...prev, [agent.id]: true }));
    try {
      await pauseAgent(agent.id, 60, 'Paused from Squadron HQ');
      toast.success(`${agent.name} paused`);
    } catch (error) {
      toast.error(`Failed to pause: ${error.message}`);
    } finally {
      setActionLoading(prev => ({ ...prev, [agent.id]: false }));
    }
  };

  const handleResumeAgent = async (agent) => {
    setActionLoading(prev => ({ ...prev, [agent.id]: true }));
    try {
      await resumeAgent(agent.id);
      toast.success(`${agent.name} resumed`);
    } catch (error) {
      toast.error(`Failed to resume: ${error.message}`);
    } finally {
      setActionLoading(prev => ({ ...prev, [agent.id]: false }));
    }
  };

  const handleRenameAgent = async (agent, newName) => {
    const { sessionId, projectDir } = useAppStore.getState();
    try {
      const response = await api.updateAgent(sessionId, agent.id, { name: newName }, projectDir);
      if (response.success) {
        await refreshAgents();
        toast.success(`Renamed to "${newName}"`);
      } else {
        toast.error(response.error || 'Failed to rename');
      }
    } catch (error) {
      toast.error(`Rename failed: ${error.message}`);
    }
  };

  const handleUnloadAgent = async () => {
    if (!agentToUnload) return;
    setActionLoading(prev => ({ ...prev, [agentToUnload.id]: true }));
    try {
      await unloadAgent(agentToUnload.id);
      toast.success(`${agentToUnload.name} unloaded`);
      setAgentToUnload(null);
    } catch (error) {
      toast.error(`Failed to unload: ${error.message}`);
    } finally {
      setActionLoading(prev => ({ ...prev, [agentToUnload.id]: false }));
    }
  };

  const handleDeleteAgent = async () => {
    if (!agentToDelete) return;
    setActionLoading(prev => ({ ...prev, [agentToDelete.id]: true }));
    try {
      await deleteAgent(agentToDelete.id);
      toast.success(`${agentToDelete.name} deleted`);
      setAgentToDelete(null);
    } catch (error) {
      toast.error(`Failed to delete: ${error.message}`);
    } finally {
      setActionLoading(prev => ({ ...prev, [agentToDelete.id]: false }));
    }
  };

  const handleQuickClone = async (agent) => {
    setActionLoading(prev => ({ ...prev, [agent.id]: true }));
    try {
      const newAgent = await duplicateAgent(agent.id, { keepConversation: false });
      toast.success(`Cloned as "${newAgent.name}"`);
    } catch (error) {
      toast.error(`Failed to clone: ${error.message}`);
    } finally {
      setActionLoading(prev => ({ ...prev, [agent.id]: false }));
    }
  };

  const handleCloneWithSettings = (agent) => {
    setAgentToClone(agent);
  };

  const handleImportAgent = (agent) => {
    refreshAgents();
    switchAgent(agent.id);
  };

  // Team handlers
  const handleCreateTeam = async (teamData) => {
    try {
      const newTeam = await createTeam(teamData);
      toast.success(`Team "${teamData.name}" created!`);
      setShowCreateTeam(false);

      // If we have a pending agent to add, add it to the new team
      if (pendingTeamAgent) {
        try {
          await addAgentToTeam(newTeam.id, pendingTeamAgent.id);
          toast.success(`${pendingTeamAgent.name} added to team`);
        } catch (err) {
          console.error('Failed to add agent to new team:', err);
        }
        setPendingTeamAgent(null);
      }
    } catch (error) {
      toast.error(`Failed to create team: ${error.message}`);
    }
  };

  const handleEditTeam = async (teamData) => {
    if (!teamToEdit) return;
    try {
      await updateTeam(teamToEdit.id, teamData);
      toast.success(`Team "${teamData.name}" updated!`);
      setTeamToEdit(null);
    } catch (error) {
      toast.error(`Failed to update team: ${error.message}`);
    }
  };

  const handleDeleteTeam = async () => {
    if (!teamToDelete) return;
    try {
      await deleteTeamAction(teamToDelete.id);
      toast.success(`Team "${teamToDelete.name}" deleted`);
      setTeamToDelete(null);
    } catch (error) {
      toast.error(`Failed to delete team: ${error.message}`);
    }
  };

  const handleLoadTeam = async (teamId) => {
    setTeamActionLoading(prev => ({ ...prev, [teamId]: true }));
    try {
      const result = await loadTeam(teamId);
      const loadedCount = result.loadResults?.filter(r => r.status === 'loaded').length || 0;
      const alreadyCount = result.loadResults?.filter(r => r.status === 'already_loaded').length || 0;
      toast.success(`Loaded ${loadedCount} pilots (${alreadyCount} already loaded)`);
    } catch (error) {
      toast.error(`Failed to load team: ${error.message}`);
    } finally {
      setTeamActionLoading(prev => ({ ...prev, [teamId]: false }));
    }
  };

  // Team batch operations
  const handlePauseTeam = async (team) => {
    const memberAgents = agents.filter(a => team.memberAgentIds?.includes(a.id));
    if (memberAgents.length === 0) return;

    setTeamActionLoading(prev => ({ ...prev, [team.id]: true }));
    try {
      let pausedCount = 0;
      for (const agent of memberAgents) {
        try {
          await pauseAgent(agent.id, 60, 'Paused with team');
          pausedCount++;
        } catch (e) {
          console.error(`Failed to pause ${agent.name}:`, e);
        }
      }
      toast.success(`Paused ${pausedCount} pilots in ${team.name}`);
    } finally {
      setTeamActionLoading(prev => ({ ...prev, [team.id]: false }));
    }
  };

  const handleResumeTeam = async (team) => {
    const memberAgents = agents.filter(a => team.memberAgentIds?.includes(a.id));
    if (memberAgents.length === 0) return;

    setTeamActionLoading(prev => ({ ...prev, [team.id]: true }));
    try {
      let resumedCount = 0;
      for (const agent of memberAgents) {
        try {
          await resumeAgent(agent.id);
          resumedCount++;
        } catch (e) {
          console.error(`Failed to resume ${agent.name}:`, e);
        }
      }
      toast.success(`Resumed ${resumedCount} pilots in ${team.name}`);
    } finally {
      setTeamActionLoading(prev => ({ ...prev, [team.id]: false }));
    }
  };

  const handleUnloadTeam = async (team) => {
    const memberAgents = agents.filter(a => team.memberAgentIds?.includes(a.id));
    if (memberAgents.length === 0) return;

    // Find all OTHER loaded teams (teams with at least one loaded member, excluding the team being unloaded)
    const otherLoadedTeams = teams.filter(t => {
      if (t.id === team.id) return false; // Exclude the team being unloaded
      // Check if this team has any loaded members
      const hasLoadedMembers = t.memberAgentIds?.some(agentId =>
        agents.some(a => a.id === agentId)
      );
      return hasLoadedMembers;
    });

    // Get all agent IDs that are in other loaded teams
    const agentIdsInOtherLoadedTeams = new Set();
    otherLoadedTeams.forEach(t => {
      t.memberAgentIds?.forEach(agentId => {
        if (agents.some(a => a.id === agentId)) {
          agentIdsInOtherLoadedTeams.add(agentId);
        }
      });
    });

    // Only unload agents that are NOT in any other loaded team
    const agentsToUnload = memberAgents.filter(a => !agentIdsInOtherLoadedTeams.has(a.id));
    const agentsKept = memberAgents.filter(a => agentIdsInOtherLoadedTeams.has(a.id));

    if (agentsToUnload.length === 0) {
      toast.info(`All pilots in ${team.name} are in other active teams - none unloaded`);
      return;
    }

    setTeamActionLoading(prev => ({ ...prev, [team.id]: true }));
    try {
      let unloadedCount = 0;
      for (const agent of agentsToUnload) {
        try {
          await unloadAgent(agent.id);
          unloadedCount++;
        } catch (e) {
          console.error(`Failed to unload ${agent.name}:`, e);
        }
      }

      if (agentsKept.length > 0) {
        toast.success(`Unloaded ${unloadedCount} pilots from ${team.name} (${agentsKept.length} kept in other teams)`);
      } else {
        toast.success(`Unloaded ${unloadedCount} pilots from ${team.name}`);
      }
    } finally {
      setTeamActionLoading(prev => ({ ...prev, [team.id]: false }));
    }
  };

  const handleEnableAutopilot = async (team) => {
    const memberAgents = agents.filter(a => team.memberAgentIds?.includes(a.id));
    if (memberAgents.length === 0) return;

    setTeamActionLoading(prev => ({ ...prev, [team.id]: true }));
    try {
      let count = 0;
      for (const agent of memberAgents) {
        try {
          await api.setAgentMode(agent.id, 'agent');
          count++;
        } catch (e) {
          console.error(`Failed to set autopilot for ${agent.name}:`, e);
        }
      }
      toast.success(`Enabled Autopilot for ${count} pilots in ${team.name}`);
      refreshAgents();
    } finally {
      setTeamActionLoading(prev => ({ ...prev, [team.id]: false }));
    }
  };

  const handleDisableAutopilot = async (team) => {
    const memberAgents = agents.filter(a => team.memberAgentIds?.includes(a.id));
    if (memberAgents.length === 0) return;

    setTeamActionLoading(prev => ({ ...prev, [team.id]: true }));
    try {
      let count = 0;
      for (const agent of memberAgents) {
        try {
          await api.setAgentMode(agent.id, 'chat');
          count++;
        } catch (e) {
          console.error(`Failed to set chat mode for ${agent.name}:`, e);
        }
      }
      toast.success(`Switched ${count} pilots to Chat mode in ${team.name}`);
      refreshAgents();
    } finally {
      setTeamActionLoading(prev => ({ ...prev, [team.id]: false }));
    }
  };

  const handleRemoveAgentFromTeam = async (teamId, agentId) => {
    try {
      await removeAgentFromTeam(teamId, agentId);
      toast.success('Pilot removed from team');
    } catch (error) {
      toast.error(`Failed to remove: ${error.message}`);
    }
  };

  // Drag and drop handlers
  const handleDragStart = (e, agent, fromTeamId = null) => {
    setDraggedAgent(agent);
    // Find which team this agent belongs to (if any)
    if (fromTeamId) {
      setDraggedAgentTeamId(fromTeamId);
    } else {
      const agentTeam = teams.find(t => t.memberAgentIds?.includes(agent.id));
      setDraggedAgentTeamId(agentTeam?.id || null);
    }
  };

  const handleDragEnd = () => {
    setDraggedAgent(null);
    setDraggedAgentTeamId(null);
    setDropTargetTeamId(null);
    setIsTeamSectionDropTarget(false);
    setIsRemoveZoneTarget(false);
  };

  // Remove zone handlers (floating circle or unassigned area)
  const handleRemoveZoneDragOver = (e) => {
    e.preventDefault();
    setIsRemoveZoneTarget(true);
  };

  const handleRemoveZoneDragLeave = () => {
    setIsRemoveZoneTarget(false);
  };

  const handleRemoveZoneDrop = async (e) => {
    e.preventDefault();
    const agentId = e.dataTransfer.getData('agentId');

    if (!agentId || !draggedAgentTeamId) return;

    try {
      await removeAgentFromTeam(draggedAgentTeamId, agentId);
      toast.success('Pilot removed from team');
    } catch (error) {
      toast.error(`Failed to remove: ${error.message}`);
    }

    setDraggedAgent(null);
    setDraggedAgentTeamId(null);
    setIsRemoveZoneTarget(false);
  };

  const handleDragOver = (e, teamId) => {
    setDropTargetTeamId(teamId);
  };

  const handleDragLeave = () => {
    setDropTargetTeamId(null);
  };

  const handleDrop = async (e, teamId) => {
    e.preventDefault();
    const agentId = e.dataTransfer.getData('agentId');

    if (!agentId || !teamId) return;

    // Check if already in this team
    const team = teams.find(t => t.id === teamId);
    if (team?.memberAgentIds?.includes(agentId)) {
      toast.error('Pilot is already in this team');
      return;
    }

    try {
      await addAgentToTeam(teamId, agentId);
      toast.success('Pilot added to team');
    } catch (error) {
      toast.error(`Failed to add: ${error.message}`);
    }

    setDraggedAgent(null);
    setDropTargetTeamId(null);
  };

  // Handle drop on the Teams section header (create new team)
  const handleTeamSectionDragOver = (e) => {
    e.preventDefault();
    setIsTeamSectionDropTarget(true);
  };

  const handleTeamSectionDragLeave = () => {
    setIsTeamSectionDropTarget(false);
  };

  const handleTeamSectionDrop = (e) => {
    e.preventDefault();
    const agentId = e.dataTransfer.getData('agentId');
    const agent = agents.find(a => a.id === agentId);

    if (agent) {
      // Set pending agent and open create team modal
      setPendingTeamAgent(agent);
      setShowCreateTeam(true);
    }

    setDraggedAgent(null);
    setIsTeamSectionDropTarget(false);
  };

  // Get team colors for an agent
  const getAgentTeamColors = (agentId) => {
    const agentTeams = teams.filter(t => t.memberAgentIds?.includes(agentId));
    return agentTeams.map(t => t.color || '#3B82F6');
  };

  // Stats calculations
  const activeCount = agents.filter(a => a && getAgentStatus(a) === 'active').length;
  const pausedCount = agents.filter(a => a && getAgentStatus(a) === 'paused').length;

  return (
    <div className="max-w-7xl mx-auto">
      {/* Sticky Header */}
      <div className="sticky top-0 z-30 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
        {/* Main Header Row */}
        <div className="px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Squadron Headquarters
            </h1>
          </div>

          <div className="flex items-center gap-2">
            {/* Express Create Buttons */}
            <div className="hidden md:flex items-center gap-1.5 pr-3 border-r border-gray-300 dark:border-gray-600">
              <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center">
                <BoltIcon className="w-3.5 h-3.5 mr-1" />
              </span>
              <button
                onClick={() => handleExpressCreate(AGENT_TEMPLATES.CODING_ASSISTANT)}
                disabled={loading || expressCreating}
                className="flex items-center px-2 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors disabled:opacity-50"
                title="Quick create Coding Pilot"
              >
                {expressCreating === AGENT_TEMPLATES.CODING_ASSISTANT ? (
                  <LoadingSpinner size="xs" />
                ) : (
                  <CodeBracketIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                )}
              </button>
              <button
                onClick={() => handleExpressCreate(AGENT_TEMPLATES.SECURITY_ARCHITECT)}
                disabled={loading || expressCreating}
                className="flex items-center px-2 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-600 hover:border-purple-400 dark:hover:border-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors disabled:opacity-50"
                title="Quick create Security Pilot"
              >
                {expressCreating === AGENT_TEMPLATES.SECURITY_ARCHITECT ? (
                  <LoadingSpinner size="xs" />
                ) : (
                  <ShieldCheckIcon className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                )}
              </button>
              <button
                onClick={() => handleExpressCreate(AGENT_TEMPLATES.SYSTEM_ANALYST)}
                disabled={loading || expressCreating}
                className="flex items-center px-2 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-600 hover:border-teal-400 dark:hover:border-teal-500 hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors disabled:opacity-50"
                title="Quick create System Analyst"
              >
                {expressCreating === AGENT_TEMPLATES.SYSTEM_ANALYST ? (
                  <LoadingSpinner size="xs" />
                ) : (
                  <CubeTransparentIcon className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                )}
              </button>
              <button
                onClick={() => handleExpressCreate(AGENT_TEMPLATES.TEAM_MANAGER)}
                disabled={loading || expressCreating}
                className="flex items-center px-2 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-600 hover:border-amber-400 dark:hover:border-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors disabled:opacity-50"
                title="Quick create Team Manager"
              >
                {expressCreating === AGENT_TEMPLATES.TEAM_MANAGER ? (
                  <LoadingSpinner size="xs" />
                ) : (
                  <UserGroupIcon className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                )}
              </button>
            </div>

            {/* Load Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowLoadMenu(!showLoadMenu)}
                className="button-secondary text-sm py-2 pr-2"
                disabled={loading}
              >
                <ArrowDownTrayIcon className="w-4 h-4 mr-1.5" />
                Load
                <ChevronDownIcon className="w-4 h-4 ml-1" />
              </button>

              {showLoadMenu && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowLoadMenu(false)}
                  />
                  <div className="absolute right-0 mt-1 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-20 py-1">
                    <button
                      onClick={() => { setShowLoadMenu(false); openModal('importAgent'); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      <ChatBubbleLeftRightIcon className="w-4 h-4 text-loxia-600 dark:text-loxia-400" />
                      Load Pilot
                    </button>
                    <button
                      onClick={() => { setShowLoadMenu(false); setShowTeamLoadModal(true); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      <UserGroupIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      Load Team
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Create Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowCreateMenu(!showCreateMenu)}
                className="button-primary text-sm py-2 pr-2"
                disabled={loading}
              >
                <PlusIcon className="w-4 h-4 mr-1.5" />
                Create
                <ChevronDownIcon className="w-4 h-4 ml-1" />
              </button>

              {showCreateMenu && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowCreateMenu(false)}
                  />
                  <div className="absolute right-0 mt-1 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-20 py-1">
                    <button
                      onClick={() => { setShowCreateMenu(false); openModal('createAgent'); }}
                      className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      <span className="flex items-center">
                        <ChatBubbleLeftRightIcon className="w-4 h-4 mr-2 text-loxia-600 dark:text-loxia-400" />
                        Create Pilot
                      </span>
                      <kbd className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
                        {formatShortcut({ alt: true, key: 'P' })}
                      </kbd>
                    </button>
                    <button
                      onClick={() => { setShowCreateMenu(false); openModal('createTeam'); }}
                      className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      <span className="flex items-center">
                        <UserGroupIcon className="w-4 h-4 mr-2 text-blue-600 dark:text-blue-400" />
                        Create Team
                      </span>
                      <kbd className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
                        {formatShortcut({ alt: true, key: 'T' })}
                      </kbd>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Stats Bar - Thin & Modern */}
        <div className="px-6 py-2 flex items-center justify-between text-sm border-t border-gray-100 dark:border-gray-800 bg-white/50 dark:bg-gray-800/50">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-loxia-500"></div>
              <span className="text-gray-600 dark:text-gray-400">Pilots:</span>
              <span className="font-semibold text-gray-900 dark:text-gray-100">{agents.length}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-green-500"></div>
              <span className="text-gray-600 dark:text-gray-400">Active:</span>
              <span className="font-semibold text-green-600 dark:text-green-400">{activeCount}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-yellow-500"></div>
              <span className="text-gray-600 dark:text-gray-400">Paused:</span>
              <span className="font-semibold text-yellow-600 dark:text-yellow-400">{pausedCount}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-blue-500"></div>
              <span className="text-gray-600 dark:text-gray-400">Teams:</span>
              <span className="font-semibold text-blue-600 dark:text-blue-400">
                {loadedTeamsCount !== teams.length ? `${loadedTeamsCount}/${teams.length}` : teams.length}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Swap Order Button — only relevant for Squadron view */}
            {managerView === 'squadron' && (
              <button
                onClick={() => setTeamsFirst(!teamsFirst)}
                className="flex items-center gap-1.5 px-2 py-1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                title={teamsFirst ? 'Show Unassigned Aircrew first' : 'Show Teams first'}
              >
                <span className="hidden sm:inline text-xs">{teamsFirst ? 'Teams' : 'Unassigned Aircrew'}</span>
                <ArrowsUpDownIcon className="w-4 h-4" />
              </button>
            )}

            {/* View Toggle */}
            <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
              <button
                onClick={() => setManagerView('squadron')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  managerView === 'squadron' ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'
                }`}
              >
                Squadron
              </button>
              <button
                onClick={() => setManagerView('tasks')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  managerView === 'tasks' ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'
                }`}
              >
                Task Board
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content Area */}
      {managerView === 'tasks' ? (
        <TeamTaskBoard />
      ) : (
      <div className="p-6">

      {/* Sections Container - use flex-col-reverse to swap order */}
      <div className={`flex flex-col ${teamsFirst ? '' : 'flex-col-reverse'}`}>

      {/* Teams Section */}
      <div className="mb-8">
        {/* Teams Header - Drop zone for creating new team */}
        <div
          onDragOver={handleTeamSectionDragOver}
          onDragLeave={handleTeamSectionDragLeave}
          onDrop={handleTeamSectionDrop}
          className={`
            flex items-center justify-between mb-4 p-2 -m-2 rounded-lg transition-all
            ${isTeamSectionDropTarget ? 'bg-blue-50 dark:bg-blue-900/20 border-2 border-dashed border-blue-400' : ''}
          `}
        >
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <UserGroupIcon className="w-5 h-5" />
            Teams
            {isTeamSectionDropTarget && (
              <span className="text-sm font-normal text-blue-600 dark:text-blue-400">
                - Drop here to create new team
              </span>
            )}
          </h2>
        </div>

        {teamsLoading ? (
          <div className="flex items-center justify-center py-8">
            <LoadingSpinner size="md" />
          </div>
        ) : visibleTeams.length === 0 ? (
          <div
            onDragOver={handleTeamSectionDragOver}
            onDragLeave={handleTeamSectionDragLeave}
            onDrop={handleTeamSectionDrop}
            className={`
              bg-gray-50 dark:bg-gray-800/50 rounded-xl border-2 border-dashed p-8 text-center transition-all
              ${isTeamSectionDropTarget
                ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                : 'border-gray-300 dark:border-gray-600'}
            `}
          >
            <UserGroupIcon className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
            <h3 className="text-lg font-medium text-gray-700 dark:text-gray-300 mb-2">
              {isTeamSectionDropTarget ? 'Drop to create new team' : teams.length > 0 ? 'No teams loaded' : 'No teams yet'}
            </h3>
            <p className="text-gray-500 dark:text-gray-400">
              {teams.length > 0 ? (
                <>Use <strong>Load → Load Team</strong> to load an existing team</>
              ) : (
                <>Drag a pilot here or press <kbd className="px-1.5 py-0.5 text-xs bg-gray-200 dark:bg-gray-700 rounded">Alt+T</kbd> to create a team</>
              )}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {visibleTeams.map(team => (
              <TeamFrame
                key={team.id}
                team={team}
                agents={agents}
                currentAgentId={currentAgent?.id}
                isDropTarget={dropTargetTeamId === team.id}
                isLoading={teamActionLoading[team.id]}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onLoadTeam={handleLoadTeam}
                onEditTeam={(t) => setTeamToEdit(t)}
                onDeleteTeam={(t) => setTeamToDelete(t)}
                onPauseTeam={handlePauseTeam}
                onResumeTeam={handleResumeTeam}
                onUnloadTeam={handleUnloadTeam}
                onEnableAutopilot={handleEnableAutopilot}
                onDisableAutopilot={handleDisableAutopilot}
                onRemoveAgent={handleRemoveAgentFromTeam}
                onAgentChat={handleOpenChat}
                onAgentSettings={handleAgentSettings}
                onAgentPause={handlePauseAgent}
                onAgentResume={handleResumeAgent}
                onAgentRename={handleRenameAgent}
                onAgentUnload={(a) => setAgentToUnload(a)}
                onAgentDelete={(a) => setAgentToDelete(a)}
                onAgentQuickClone={handleQuickClone}
                onAgentCloneWithSettings={handleCloneWithSettings}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              />
            ))}
          </div>
        )}
      </div>

      {/* Floating Remove Zone - appears when dragging a team member AND unassigned section is out of view */}
      {draggedAgent && draggedAgentTeamId && !isUnassignedSectionVisible && (
        <div
          ref={removeZoneRef}
          data-drop-zone="remove-zone"
          onDragOver={handleRemoveZoneDragOver}
          onDragLeave={handleRemoveZoneDragLeave}
          onDrop={handleRemoveZoneDrop}
          className={`
            fixed bottom-8 left-1/2 -translate-x-1/2 z-40
            flex items-center gap-3 px-6 py-4 rounded-full
            shadow-lg border-2 transition-all duration-200
            ${isRemoveZoneTarget
              ? 'bg-red-50 dark:bg-red-900/30 border-red-400 scale-110'
              : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600'}
          `}
        >
          <UserMinusIcon className={`w-6 h-6 ${isRemoveZoneTarget ? 'text-red-500' : 'text-gray-400'}`} />
          <span className={`font-medium ${isRemoveZoneTarget ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-300'}`}>
            {isRemoveZoneTarget ? 'Release to remove from team' : 'Drop here to remove from team'}
          </span>
        </div>
      )}

      {/* Unassigned Pilots Section */}
      <div ref={unassignedSectionRef} className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {viewMode === 'team' ? 'All Pilots' : 'Unassigned Pilots'} ({viewMode === 'team' ? agents.length : unassignedAgents.length})
            </h2>
            {/* Stage 4B: View mode toggle */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setViewMode(viewMode === 'flat' ? 'team' : 'flat')}
                className={`text-xs px-2 py-0.5 rounded transition-colors ${
                  viewMode === 'team'
                    ? 'bg-loxia-100 text-loxia-700 dark:bg-loxia-900/30 dark:text-loxia-400'
                    : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                }`}
                title={viewMode === 'flat' ? 'Group by team' : 'Show flat list'}
              >
                {viewMode === 'team' ? 'By Team' : 'Flat'}
              </button>
            </div>
          </div>
        </div>

        {agents.length === 0 ? (
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 p-8 text-center">
            <ChatBubbleLeftRightIcon className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
            <h3 className="text-lg font-medium text-gray-700 dark:text-gray-300 mb-2">No pilots deployed yet</h3>
            <p className="text-gray-500 dark:text-gray-400 mb-4">
              Deploy your first AI pilot to get started
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={() => handleExpressCreate(AGENT_TEMPLATES.CODING_ASSISTANT)}
                disabled={loading || expressCreating}
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 border-gray-200 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors disabled:opacity-50"
              >
                {expressCreating === AGENT_TEMPLATES.CODING_ASSISTANT ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <CodeBracketIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                )}
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Coding Pilot</span>
              </button>
              <button
                onClick={() => handleExpressCreate(AGENT_TEMPLATES.SECURITY_ARCHITECT)}
                disabled={loading || expressCreating}
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 border-gray-200 dark:border-gray-700 hover:border-purple-400 dark:hover:border-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors disabled:opacity-50"
              >
                {expressCreating === AGENT_TEMPLATES.SECURITY_ARCHITECT ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <ShieldCheckIcon className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                )}
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Security Architect</span>
              </button>
              <button
                onClick={() => handleExpressCreate(AGENT_TEMPLATES.SYSTEM_ANALYST)}
                disabled={loading || expressCreating}
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 border-gray-200 dark:border-gray-700 hover:border-teal-400 dark:hover:border-teal-500 hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors disabled:opacity-50"
              >
                {expressCreating === AGENT_TEMPLATES.SYSTEM_ANALYST ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <CubeTransparentIcon className="w-5 h-5 text-teal-600 dark:text-teal-400" />
                )}
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">System Analyst</span>
              </button>
              <button
                onClick={() => handleExpressCreate(AGENT_TEMPLATES.TEAM_MANAGER)}
                disabled={loading || expressCreating}
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 border-gray-200 dark:border-gray-700 hover:border-amber-400 dark:hover:border-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors disabled:opacity-50"
              >
                {expressCreating === AGENT_TEMPLATES.TEAM_MANAGER ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <UserGroupIcon className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                )}
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Team Manager</span>
              </button>
            </div>
          </div>
        ) : viewMode === 'team' ? (
          /* Stage 4B: Team-grouped view */
          <div>
            {/* Search filter for team view */}
            <div className="relative mb-3">
              <MagnifyingGlassIcon className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={pilotFilter}
                onChange={(e) => setPilotFilter(e.target.value)}
                placeholder="Filter pilots..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md text-gray-700 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-loxia-500"
              />
            </div>

            {/* Team sections */}
            {Object.entries(agentsByTeam).map(([teamId, { team, members }]) => {
              const filteredMembers = members.filter(a => !pilotFilter || a.name.toLowerCase().includes(pilotFilter.toLowerCase()));
              if (filteredMembers.length === 0) return null;
              const isCollapsed = collapsedTeams.has(teamId);
              return (
                <div key={teamId} className="mb-4">
                  <button
                    onClick={() => {
                      setCollapsedTeams(prev => {
                        const next = new Set(prev);
                        if (next.has(teamId)) next.delete(teamId);
                        else next.add(teamId);
                        return next;
                      });
                    }}
                    className="flex items-center gap-2 w-full text-left mb-2 group"
                  >
                    <ChevronDownIcon className={`w-4 h-4 text-gray-400 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: team.color || '#3B82F6' }}
                    />
                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 group-hover:text-loxia-600 dark:group-hover:text-loxia-400 transition-colors">
                      {team.name}
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded-full">
                      {filteredMembers.length}
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pl-6">
                      {filteredMembers.map(agent => (
                        <PilotCard
                          key={agent.id}
                          ref={el => { agentCardRefs.current[agent.id] = el; }}
                          agent={agent}
                          teamColors={getAgentTeamColors(agent.id)}
                          isCurrent={currentAgent?.id === agent.id}
                          isDragging={draggedAgent?.id === agent.id}
                          isLoading={actionLoading[agent.id]}
                          isHighlighted={highlightedAgentId === agent.id}
                          onDragStart={handleDragStart}
                          onDragEnd={handleDragEnd}
                          onChat={handleOpenChat}
                          onSettings={handleAgentSettings}
                          onPause={handlePauseAgent}
                          onResume={handleResumeAgent}
                          onRename={handleRenameAgent}
                          onUnload={(a) => setAgentToUnload(a)}
                          onDelete={(a) => setAgentToDelete(a)}
                          onQuickClone={handleQuickClone}
                          onCloneWithSettings={handleCloneWithSettings}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Unassigned pseudo-team */}
            {(() => {
              const filteredUA = unassignedAgents.filter(a => a && (!pilotFilter || a.name.toLowerCase().includes(pilotFilter.toLowerCase())));
              if (filteredUA.length === 0 && Object.keys(agentsByTeam).length > 0) return null;
              const isCollapsed = collapsedTeams.has('__unassigned__');
              return (
                <div className="mb-4">
                  <button
                    onClick={() => {
                      setCollapsedTeams(prev => {
                        const next = new Set(prev);
                        if (next.has('__unassigned__')) next.delete('__unassigned__');
                        else next.add('__unassigned__');
                        return next;
                      });
                    }}
                    className="flex items-center gap-2 w-full text-left mb-2 group"
                  >
                    <ChevronDownIcon className={`w-4 h-4 text-gray-400 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                    <span className="w-3 h-3 rounded-full flex-shrink-0 bg-gray-400" />
                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 group-hover:text-loxia-600 dark:group-hover:text-loxia-400 transition-colors">
                      Unassigned
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded-full">
                      {filteredUA.length}
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div
                      data-drop-zone="unassigned-grid"
                      onDragOver={draggedAgentTeamId ? handleRemoveZoneDragOver : undefined}
                      onDragLeave={draggedAgentTeamId ? handleRemoveZoneDragLeave : undefined}
                      onDrop={draggedAgentTeamId ? handleRemoveZoneDrop : undefined}
                      className={`
                        grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pl-6 p-2 rounded-lg transition-all
                        ${isRemoveZoneTarget && draggedAgentTeamId
                          ? 'bg-orange-50 dark:bg-orange-900/20 ring-2 ring-orange-400 ring-dashed'
                          : ''}
                      `}
                    >
                      {filteredUA.map(agent => (
                        <PilotCard
                          key={agent.id}
                          ref={el => { agentCardRefs.current[agent.id] = el; }}
                          agent={agent}
                          teamColors={getAgentTeamColors(agent.id)}
                          isCurrent={currentAgent?.id === agent.id}
                          isDragging={draggedAgent?.id === agent.id}
                          isLoading={actionLoading[agent.id]}
                          isHighlighted={highlightedAgentId === agent.id}
                          onDragStart={handleDragStart}
                          onDragEnd={handleDragEnd}
                          onChat={handleOpenChat}
                          onSettings={handleAgentSettings}
                          onPause={handlePauseAgent}
                          onResume={handleResumeAgent}
                          onRename={handleRenameAgent}
                          onUnload={(a) => setAgentToUnload(a)}
                          onDelete={(a) => setAgentToDelete(a)}
                          onQuickClone={handleQuickClone}
                          onCloneWithSettings={handleCloneWithSettings}
                        />
                      ))}
                      {filteredUA.length === 0 && (
                        <p className="col-span-full text-sm text-gray-400 dark:text-gray-500 text-center py-4">
                          {pilotFilter ? 'No matching pilots' : 'All pilots are assigned to teams'}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        ) : unassignedAgents.length === 0 ? (
          <div
            ref={unassignedDropRef}
            data-drop-zone="unassigned-area"
            onDragOver={draggedAgentTeamId ? handleRemoveZoneDragOver : undefined}
            onDragLeave={draggedAgentTeamId ? handleRemoveZoneDragLeave : undefined}
            onDrop={draggedAgentTeamId ? handleRemoveZoneDrop : undefined}
            className={`
              rounded-xl border-2 border-dashed p-6 text-center transition-all
              ${isRemoveZoneTarget && draggedAgentTeamId
                ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-400'
                : 'bg-gray-50 dark:bg-gray-800/50 border-gray-300 dark:border-gray-600'}
            `}
          >
            <UserMinusIcon className={`w-8 h-8 mx-auto mb-2 ${isRemoveZoneTarget ? 'text-orange-500' : 'text-gray-300 dark:text-gray-600'}`} />
            <p className={`${isRemoveZoneTarget ? 'text-orange-600 dark:text-orange-400 font-medium' : 'text-gray-500 dark:text-gray-400'}`}>
              {isRemoveZoneTarget ? 'Drop to remove from team' : 'All pilots are assigned to teams'}
            </p>
          </div>
        ) : (
          /* Stage 4A: Flat view with filter and expand/collapse */
          <div>
            {/* Search filter */}
            <div className="relative mb-3">
              <MagnifyingGlassIcon className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={pilotFilter}
                onChange={(e) => setPilotFilter(e.target.value)}
                placeholder="Filter pilots..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md text-gray-700 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-loxia-500"
              />
            </div>

            <div
              data-drop-zone="unassigned-grid"
              onDragOver={draggedAgentTeamId ? handleRemoveZoneDragOver : undefined}
              onDragLeave={draggedAgentTeamId ? handleRemoveZoneDragLeave : undefined}
              onDrop={draggedAgentTeamId ? handleRemoveZoneDrop : undefined}
              className={`
                grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-2 -m-2 rounded-lg transition-all
                ${isRemoveZoneTarget && draggedAgentTeamId
                  ? 'bg-orange-50 dark:bg-orange-900/20 ring-2 ring-orange-400 ring-dashed'
                  : ''}
              `}
            >
              {visiblePilots.filter(a => a).map(agent => (
                <PilotCard
                  key={agent.id}
                  ref={el => { agentCardRefs.current[agent.id] = el; }}
                  agent={agent}
                  teamColors={getAgentTeamColors(agent.id)}
                  isCurrent={currentAgent?.id === agent.id}
                  isDragging={draggedAgent?.id === agent.id}
                  isLoading={actionLoading[agent.id]}
                  isHighlighted={highlightedAgentId === agent.id}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onChat={handleOpenChat}
                  onSettings={handleAgentSettings}
                  onPause={handlePauseAgent}
                  onResume={handleResumeAgent}
                  onRename={handleRenameAgent}
                  onUnload={(a) => setAgentToUnload(a)}
                  onDelete={(a) => setAgentToDelete(a)}
                  onQuickClone={handleQuickClone}
                  onCloneWithSettings={handleCloneWithSettings}
                />
              ))}
            </div>

            {/* Expand/collapse toggle */}
            {filteredUnassigned.length > 5 && (
              <button
                onClick={() => setPilotsExpanded(!pilotsExpanded)}
                className="w-full mt-2 py-1.5 text-xs text-gray-500 hover:text-loxia-600 dark:text-gray-400 dark:hover:text-loxia-400 flex items-center justify-center gap-1 transition-colors"
              >
                {pilotsExpanded ? 'Show less' : `Show ${filteredUnassigned.length - 5} more`}
                <ChevronDownIcon className={`w-3.5 h-3.5 transition-transform ${pilotsExpanded ? 'rotate-180' : ''}`} />
              </button>
            )}

            {filteredUnassigned.length === 0 && pilotFilter && (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">
                No pilots matching "{pilotFilter}"
              </p>
            )}
          </div>
        )}
      </div>
      </div>{/* End Sections Container */}
      </div>
      )}{/* End Content Area */}

      {/*
        Create-Pilot, Edit-Pilot, Import-Pilot modals: now hosted in
        <GlobalAgentModals /> mounted from Layout.jsx so they open from
        ANY route (chat, flows, etc.) via keyboard shortcuts (Alt+P,
        Alt+E, Alt+L). AgentManager triggers them via the store action
        openModal('createAgent' | 'editAgent' | 'importAgent', ...).
      */}

      {/* Clone & Configure Modal — stays local (couples to agentToClone) */}
      {agentToClone && (
        <AgentCreationModal
          sourceAgent={agentToClone}
          onClose={() => setAgentToClone(null)}
          onSuccess={() => {
            setAgentToClone(null);
            refreshAgents();
          }}
        />
      )}

      {/* Team Load Modal */}
      {showTeamLoadModal && (
        <TeamLoadModal
          isOpen={showTeamLoadModal}
          onClose={() => setShowTeamLoadModal(false)}
          teams={teams}
          agents={agents}
          savedAgents={savedAgentsList}
          onLoadTeam={handleLoadTeam}
        />
      )}

      {/* Create Team Modal */}
      {showCreateTeam && (
        <TeamCreationModal
          onClose={() => {
            setShowCreateTeam(false);
            setPendingTeamAgent(null);
          }}
          onSubmit={handleCreateTeam}
        />
      )}

      {/* Edit Team Modal */}
      {teamToEdit && (
        <TeamCreationModal
          team={teamToEdit}
          onClose={() => setTeamToEdit(null)}
          onSubmit={handleEditTeam}
        />
      )}

      {/* Unload Confirmation Modal */}
      {agentToUnload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md">
            <div className="p-6">
              <div className="flex items-center mb-4">
                <div className="w-12 h-12 bg-orange-100 dark:bg-orange-900/20 rounded-full flex items-center justify-center mr-4">
                  <ArrowUpTrayIcon className="w-6 h-6 text-orange-600 dark:text-orange-400" />
                </div>
                <div>
                  <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                    Unload Pilot
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Remove from memory, keep data
                  </p>
                </div>
              </div>

              <p className="text-gray-700 dark:text-gray-300 mb-6">
                Unload <strong>"{agentToUnload.name}"</strong>? Data will be preserved for later reload.
              </p>

              <div className="flex justify-end space-x-3">
                <button onClick={() => setAgentToUnload(null)} className="button-secondary">
                  Cancel
                </button>
                <button
                  onClick={handleUnloadAgent}
                  className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 flex items-center"
                  disabled={actionLoading[agentToUnload.id]}
                >
                  {actionLoading[agentToUnload.id] ? <LoadingSpinner size="xs" className="mr-2" /> : <ArrowUpTrayIcon className="w-4 h-4 mr-2" />}
                  Unload
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Agent Confirmation Modal */}
      {agentToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md">
            <div className="p-6">
              <div className="flex items-center mb-4">
                <div className="w-12 h-12 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center mr-4">
                  <TrashIcon className="w-6 h-6 text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                    Delete Pilot
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    This action cannot be undone
                  </p>
                </div>
              </div>

              <p className="text-gray-700 dark:text-gray-300 mb-6">
                Delete <strong>"{agentToDelete.name}"</strong> permanently?
              </p>

              <div className="flex justify-end space-x-3">
                <button onClick={() => setAgentToDelete(null)} className="button-secondary">
                  Cancel
                </button>
                <button
                  onClick={handleDeleteAgent}
                  className="button-danger"
                  disabled={actionLoading[agentToDelete.id]}
                >
                  {actionLoading[agentToDelete.id] ? <LoadingSpinner size="xs" className="mr-2" /> : <TrashIcon className="w-4 h-4 mr-2" />}
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Team Confirmation */}
      {teamToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md">
            <div className="p-6">
              <div className="flex items-center mb-4">
                <div className="w-12 h-12 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center mr-4">
                  <TrashIcon className="w-6 h-6 text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                    Delete Team
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Pilots will become unassigned
                  </p>
                </div>
              </div>

              <p className="text-gray-700 dark:text-gray-300 mb-6">
                Delete team <strong>"{teamToDelete.name}"</strong>?
                The pilots in this team will not be deleted.
              </p>

              <div className="flex justify-end space-x-3">
                <button onClick={() => setTeamToDelete(null)} className="button-secondary">
                  Cancel
                </button>
                <button onClick={handleDeleteTeam} className="button-danger">
                  <TrashIcon className="w-4 h-4 mr-2" />
                  Delete Team
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AgentManager;
