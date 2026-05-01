import React, { useState, useMemo, useEffect } from 'react';
import { useAppStore } from '../stores/appStore.js';
import {
  CheckCircleIcon,
  ClockIcon,
  ExclamationCircleIcon,
  UserGroupIcon
} from '@heroicons/react/24/outline';

const STATUS_COLORS = {
  pending: 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
  in_progress: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 animate-pulse',
  completed: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
  blocked: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  cancelled: 'bg-gray-100 dark:bg-gray-800 text-gray-400'
};

function TaskCard({ task }) {
  const [expanded, setExpanded] = useState(false);
  const statusClass = STATUS_COLORS[task.status] || STATUS_COLORS.pending;
  const text = task.title || task.name || task.description || 'Untitled';
  const hasDescription = task.description && task.description !== text;
  const isLong = text.length > 50 || hasDescription;

  return (
    <div
      className={`px-2.5 py-1.5 rounded-md text-xs ${statusClass} mb-1 ${isLong ? 'cursor-pointer' : ''}`}
      onClick={() => isLong && setExpanded(!expanded)}
      title={isLong && !expanded ? text : undefined}
    >
      <div className={`font-medium ${expanded ? 'whitespace-pre-wrap break-words' : 'truncate'}`}>
        {text}
      </div>
      <div className="flex items-center gap-1 mt-0.5">
        {task.priority && task.priority !== 'normal' && (
          <span className="text-[10px] opacity-70">{task.priority}</span>
        )}
        {isLong && (
          <span className="text-[9px] opacity-50 ml-auto">
            {expanded ? '▲ less' : '▼ more'}
          </span>
        )}
      </div>
      {expanded && task.description && task.title && task.description !== task.title && (
        <div className="text-[10px] opacity-75 mt-1 pt-1 border-t border-current/10 whitespace-pre-wrap break-words">
          {task.description}
        </div>
      )}
    </div>
  );
}

function AgentColumn({ agent, tasks }) {
  const completedCount = tasks.filter(t => t.status === 'completed').length;

  return (
    <div className="flex-shrink-0 w-56 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Agent header */}
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="font-medium text-sm text-gray-800 dark:text-gray-200 truncate">{agent.name}</div>
        <div className="text-[10px] text-gray-400 mt-0.5">
          {completedCount}/{tasks.length} tasks
          {agent.status === 'paused' && <span className="ml-1 text-yellow-500">paused</span>}
        </div>
      </div>
      {/* Task list */}
      <div className="p-2 max-h-[400px] overflow-y-auto space-y-1">
        {tasks.length === 0 ? (
          <div className="text-[11px] text-gray-400 text-center py-4 italic">No tasks</div>
        ) : (
          tasks.map((task, i) => <TaskCard key={task.id || i} task={task} />)
        )}
      </div>
    </div>
  );
}

export default function TeamTaskBoard() {
  const agents = useAppStore(s => s.agents);
  const teams = useAppStore(s => s.teams);
  const agentMessages = useAppStore(s => s.agentMessages);
  const agentHistoryLoaded = useAppStore(s => s.agentHistoryLoaded);
  const sessionId = useAppStore(s => s.sessionId);
  const projectDir = useAppStore(s => s.projectDir);
  const [activeTab, setActiveTab] = useState('all');

  // Auto-fetch message history for all agents when Task Board mounts
  // (agentMessages is only populated when you visit an agent in chat view)
  const fetchedRef = React.useRef(new Set());
  useEffect(() => {
    if (!agents || !sessionId) return;
    let cancelled = false;
    const loadMissing = async () => {
      const { api } = await import('../services/api.js');
      for (const agent of agents) {
        if (cancelled) break;
        if (fetchedRef.current.has(agent.id)) continue;
        fetchedRef.current.add(agent.id); // mark immediately to prevent double-fetch
        const state = useAppStore.getState();
        if (state.agentHistoryLoaded?.has(agent.id)) continue;
        if (state.agentMessages.has(agent.id) && state.agentMessages.get(agent.id).length > 0) continue;
        try {
          const res = await api.getAgentConversations(sessionId, agent.id, projectDir);
          if (res.success && res.data?.conversations?.full?.messages) {
            const msgs = res.data.conversations.full.messages.filter(m =>
              m.type !== 'scheduler-prompt' && m.type !== 'tool-result'
            );
            useAppStore.setState(s => {
              const updated = new Map(s.agentMessages).set(agent.id, msgs);
              const loaded = new Set(s.agentHistoryLoaded || []);
              loaded.add(agent.id);
              return { agentMessages: updated, agentHistoryLoaded: loaded };
            });
          }
        } catch {}
      }
    };
    loadMissing();
    return () => { cancelled = true; };
  }, [agents, sessionId, projectDir]); // no agentMessages/agentHistoryLoaded — avoids re-trigger loop

  // Extract tasks from each agent's message history
  const agentTasks = useMemo(() => {
    const result = new Map();
    if (!agents) return result;

    for (const agent of agents) {
      const msgs = agentMessages?.get(agent.id) || [];
      let tasks = [];
      // Walk backwards; first taskmanager result we find is the agent's
      // current task list (including empty, which means "no tasks right
      // now" — not "keep looking for an older non-empty result"). The
      // backend taskmanager tool emits `result.tasks` on every action.
      let foundLatest = false;

      for (let i = msgs.length - 1; i >= 0 && !foundLatest; i--) {
        const msg = msgs[i];
        if (!msg.toolResults) continue;
        for (const tr of msg.toolResults) {
          if (tr.toolId === 'taskmanager' && tr.status === 'completed' && tr.result) {
            const r = tr.result;
            const taskList = r.tasks ?? r.data?.tasks ?? r.result?.tasks;
            if (Array.isArray(taskList)) {
              tasks = taskList;
              foundLatest = true;
              break;
            }
          }
        }
      }

      result.set(agent.id, { agent, tasks });
    }
    return result;
  }, [agents, agentMessages]);

  // Helper: get active (loaded) agents for a team
  // Teams store members in `memberAgentIds` (array of ID strings)
  const getTeamActiveAgents = (team) => {
    if (!team?.memberAgentIds || !agents) return [];
    return agents.filter(a => team.memberAgentIds.includes(a.id));
  };

  // Build team tabs — only show teams that have at least one loaded agent
  const teamTabs = useMemo(() => {
    const tabs = [{ id: 'all', name: 'All Agents' }];
    if (teams) {
      teams.forEach(t => {
        const activeMembers = getTeamActiveAgents(t);
        if (activeMembers.length > 0) {
          tabs.push({ id: t.id, name: t.name, count: activeMembers.length });
        }
      });
    }
    // Add Unassigned only if there are any unassigned agents
    if (agents) {
      const assignedIds = new Set();
      teams?.forEach(t => (t.memberAgentIds || []).forEach(id => assignedIds.add(id)));
      const unassignedCount = agents.filter(a => !assignedIds.has(a.id)).length;
      if (unassignedCount > 0) {
        tabs.push({ id: 'unassigned', name: 'Unassigned', count: unassignedCount });
      }
    }
    return tabs;
  }, [teams, agents]);

  // Reset activeTab if it's no longer in the available tabs
  useEffect(() => {
    if (!teamTabs.find(t => t.id === activeTab)) {
      setActiveTab('all');
    }
  }, [teamTabs, activeTab]);

  // Filter agents by active tab
  const visibleAgents = useMemo(() => {
    if (!agents) return [];
    if (activeTab === 'all') return agents;
    if (activeTab === 'unassigned') {
      const assignedIds = new Set();
      teams?.forEach(t => (t.memberAgentIds || []).forEach(id => assignedIds.add(id)));
      return agents.filter(a => !assignedIds.has(a.id));
    }
    // Specific team — use memberAgentIds (the correct field)
    const team = teams?.find(t => t.id === activeTab);
    return getTeamActiveAgents(team);
  }, [agents, teams, activeTab]);

  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-200 dark:border-gray-700 overflow-x-auto flex-shrink-0">
        {teamTabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1 text-xs font-medium rounded-full whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              activeTab === tab.id
                ? 'bg-loxia-600 text-white'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            {tab.name}
            {tab.count !== undefined && (
              <span className={`text-[10px] px-1 rounded-full ${activeTab === tab.id ? 'bg-white/20' : 'bg-gray-200 dark:bg-gray-700'}`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Agent columns */}
      <div className="flex-1 overflow-x-auto p-4">
        {visibleAgents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <UserGroupIcon className="w-12 h-12 mb-3 opacity-50" />
            <p className="text-sm">No agents in this view</p>
          </div>
        ) : (
          <div className="flex gap-3 min-h-full">
            {visibleAgents.map(agent => {
              const data = agentTasks.get(agent.id);
              return (
                <AgentColumn
                  key={agent.id}
                  agent={agent}
                  tasks={data?.tasks || []}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
