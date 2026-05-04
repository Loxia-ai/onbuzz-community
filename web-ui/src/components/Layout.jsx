import React, { useState, useEffect, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { brand } from '../config/brand.js';
import {
  Bars3Icon,
  XMarkIcon,
  ChatBubbleLeftRightIcon,
  CpuChipIcon,
  Cog6ToothIcon,
  SunIcon,
  MoonIcon,
  ShieldExclamationIcon,
  WifiIcon,
  ExclamationTriangleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  PlusIcon,
  KeyIcon,
  QuestionMarkCircleIcon,
  ShareIcon,
  ClockIcon,
  LightBulbIcon,
  MagnifyingGlassIcon,
  UserGroupIcon,
  ListBulletIcon,
  Squares2X2Icon,
  SparklesIcon
} from '@heroicons/react/24/outline';
import { useAppStore } from '../stores/appStore.js';
import { useAttentionRequired } from '../hooks/useAttentionRequired.js';
import AgentStatusIndicator from './AgentStatusIndicator.jsx';
import HelpModal from './HelpModal.jsx';
import GlobalAgentModals from './GlobalAgentModals.jsx';
import { matchesShortcut } from '../utils/keyboardShortcuts.js';

function Layout({ children }) {
  const location = useLocation();
  // showAgentDropdown removed — top bar now shows a static indicator, sidebar is used for switching
  const [showHelpModal, setShowHelpModal] = useState(false);

  const {
    sidebarOpen,
    toggleSidebar,
    darkMode,
    theme,
    toggleDarkMode,
    currentAgent,
    connected,
    agents,
    teams,
    error,
    clearError,
    switchAgent,
    // Aliased to avoid clashing with `openModal` from useAttentionRequired
    // below — both exist for different reasons (modals are global UI
    // state in our store; the attention-required hook owns its own
    // attention modal). Renaming the store accessor is the smallest
    // and least-surprising fix.
    openModal: openAgentModal,
  } = useAppStore();

  // No cloud-health polling in the OSS edition — the system runs
  // entirely locally. Provider connectivity is reported by the
  // individual provider's first request (401/timeout signals).
  useEffect(() => {
    return () => {};
  }, []); // no deps — runs once, polls on interval

  // Sidebar section collapse state
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [pilotsCollapsed, setPilotsCollapsed] = useState(false);

  // Pilots section state
  const [pilotFilter, setPilotFilter] = useState('');
  const [pilotsExpanded, setPilotsExpanded] = useState(false);
  const [pilotViewMode, setPilotViewMode] = useState('flat'); // 'flat' | 'team'
  const [collapsedTeams, setCollapsedTeams] = useState(new Set());

  // Filter + group logic for Pilots section
  const filteredAgents = (agents || []).filter(a =>
    a && (!pilotFilter || a.name?.toLowerCase().includes(pilotFilter.toLowerCase()))
  );
  const visiblePilots = pilotsExpanded ? filteredAgents : filteredAgents.slice(0, 5);

  // Group agents by team for team view
  const agentsByTeamForSidebar = React.useMemo(() => {
    if (!teams || !agents) return { teams: [], unassigned: filteredAgents };
    const grouped = [];
    const assignedIds = new Set();
    teams.forEach(team => {
      const members = (team.memberAgentIds || [])
        .map(id => agents.find(a => a && a.id === id))
        .filter(Boolean)
        .filter(a => !pilotFilter || a.name?.toLowerCase().includes(pilotFilter.toLowerCase()));
      (team.memberAgentIds || []).forEach(id => assignedIds.add(id));
      if (members.length > 0) {
        grouped.push({ team, members });
      }
    });
    const unassigned = filteredAgents.filter(a => !assignedIds.has(a.id));
    return { teams: grouped, unassigned };
  }, [teams, agents, pilotFilter, filteredAgents]);

  const toggleTeamCollapse = (teamId) => {
    setCollapsedTeams(prev => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };

  const { hasProvider, openModal } = useAttentionRequired();

  // Global keyboard shortcuts.
  // Editing-context guard: most shortcuts (especially Alt+letter ones)
  // should NOT fire while the user is typing in an input/textarea/
  // contenteditable. The user typed "Alt+P" expecting "create pilot",
  // but if focus is in the chat textarea they probably wanted to type
  // a literal "p". The guard returns early for letter-based shortcuts.
  const handleKeyDown = useCallback((e) => {
    const inEditableField =
      e.target.tagName === 'INPUT' ||
      e.target.tagName === 'TEXTAREA' ||
      e.target.isContentEditable;

    // Ctrl/Cmd + B — Toggle sidebar (allowed even in editable; Ctrl+B is global UX)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      if (inEditableField) return;
      e.preventDefault();
      toggleSidebar();
      return;
    }

    // Ctrl/Cmd + / — Show help (allow in editable — "?" key without modifier
    // would be hard to remap, but Ctrl+/ is unambiguous)
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      setShowHelpModal(true);
      return;
    }

    // Squadron / agent modal shortcuts. Skip when typing — Alt+E in a
    // textarea would otherwise hijack the user's input.
    if (inEditableField) return;

    // Alt+P — Create new pilot (works on every route)
    if (matchesShortcut(e, { ctrl: false, shift: false, alt: true, key: 'P' })) {
      e.preventDefault();
      openAgentModal('createAgent');
      return;
    }

    // Alt+T — Create new team
    if (matchesShortcut(e, { ctrl: false, shift: false, alt: true, key: 'T' })) {
      e.preventDefault();
      openAgentModal('createTeam');
      return;
    }

    // Alt+E — Edit currently-selected pilot. Reads currentAgent from
    // the store at fire time (not at handler creation) so the latest
    // selection is always used.
    if (matchesShortcut(e, { ctrl: false, shift: false, alt: true, key: 'E' })) {
      e.preventDefault();
      const agent = useAppStore.getState().currentAgent;
      if (agent) {
        openAgentModal('editAgent', agent);
      }
      // No-op if no current agent — silent rather than annoying. The
      // help modal explains this.
      return;
    }

    // Alt+L — Load (import) an existing pilot
    if (matchesShortcut(e, { ctrl: false, shift: false, alt: true, key: 'L' })) {
      e.preventDefault();
      openAgentModal('importAgent');
      return;
    }
  }, [toggleSidebar, openAgentModal]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const navigation = [
    { name: 'Live Chat', href: '/', icon: ChatBubbleLeftRightIcon },
    { name: 'My Squadron', href: '/agents', icon: CpuChipIcon },
    { name: 'Flows', href: '/flows', icon: ShareIcon },
    { name: 'Schedules', href: '/schedules', icon: ClockIcon },
    { name: 'Skills', href: '/skills', icon: LightBulbIcon },
    { name: 'Widget Gallery', href: '/widget-gallery', icon: Squares2X2Icon },
    { name: 'Settings', href: '/settings', icon: Cog6ToothIcon },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Sidebar */}
      <div className={`fixed inset-y-0 left-0 z-50 w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 transform transition-transform duration-300 ease-in-out flex flex-col ${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        
        {/* Header */}
        <div className="flex items-center justify-between h-20 px-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center">
            <img src={brand.logoPath} alt={`${brand.name} Logo`} className="w-9 h-9 object-contain" />
            <div className="ml-2 flex flex-col leading-none">
              {/*
                Two-tone "OnBuzz" wordmark:
                  - "On"   — solid white with a thin black stroke
                  - "Buzz" — yellow→amber→orange vertical gradient
                             (lighter top, darker bottom) with the
                             same thin black stroke
                Both halves share `paintOrder: 'stroke'` so the stroke
                is painted first and the fill (white or gradient) sits
                crisply on top, instead of being eaten by the outline.
                Tailwind has no text-stroke utility, so the stroke is
                set inline via `WebkitTextStroke`.
              */}
              <h1 className="text-2xl font-extrabold tracking-tight leading-none">
                <span
                  className="text-white"
                  style={{ WebkitTextStroke: '0.6px rgba(0, 0, 0, 0.85)', paintOrder: 'stroke' }}
                >
                  On
                </span>
                <span
                  className="bg-clip-text text-transparent bg-gradient-to-b from-yellow-300 via-amber-400 to-orange-600 dark:from-yellow-200 dark:via-amber-300 dark:to-orange-500"
                  style={{ WebkitTextStroke: '0.6px rgba(0, 0, 0, 0.85)', paintOrder: 'stroke' }}
                >
                  Buzz
                </span>
              </h1>
              <span className="mt-0.5 text-[10px] uppercase tracking-[0.18em] font-semibold text-gray-700 dark:text-gray-300">
                Community Edition
              </span>
            </div>
          </div>

          <button
            onClick={toggleSidebar}
            className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <XMarkIcon className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        {/* Connection Status — local engine only */}
        <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5" title={connected ? 'Local engine connected' : 'Local engine disconnected'}>
              <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-gray-500 dark:text-gray-400">Engine</span>
            </div>
          </div>

          {/* Provider missing warning — only shown when NO provider is
              usable: no cloud key, Ollama not running or empty, and the
              user has not chosen to defer. A user who picks Ollama and
              has a model installed satisfies hasProvider, so this
              warning stays hidden. */}
          {!hasProvider && (
            <button
              onClick={openModal}
              className="flex items-center text-sm mt-2 w-full text-left group"
            >
              <KeyIcon className="w-4 h-4 mr-2 text-amber-500" />
              <span className="text-amber-600 dark:text-amber-400 group-hover:underline">
                Provider key missing
              </span>
            </button>
          )}
        </div>

        {/* Navigation — collapsible.
            `max-h-[45%]` caps the section at ~half of the sidebar's
            height when expanded, and the inner `<nav>` gets its own
            `overflow-y-auto` so long nav lists scroll internally rather
            than pushing the Pilots section off-screen. When the user
            collapses Navigation, the full remaining space goes to
            Pilots. `flex-shrink-0` on the header keeps the collapse
            button visible even when the nav is scrolled. */}
        <div className="border-b border-gray-200 dark:border-gray-700 flex flex-col max-h-[45%] flex-shrink-0">
          <button
            onClick={() => setNavCollapsed(!navCollapsed)}
            className="flex-shrink-0 w-full flex items-center gap-1 px-4 py-2 bg-white dark:bg-gray-800 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide hover:text-gray-700 dark:hover:text-gray-200"
          >
            <ChevronDownIcon className={`w-3 h-3 transition-transform ${navCollapsed ? '-rotate-90' : ''}`} />
            <span>Navigation</span>
          </button>
          {!navCollapsed && (
            <nav className="px-4 pb-3 space-y-1 overflow-y-auto min-h-0 flex-1">
              {navigation.map((item) => {
                const isActive = location.pathname === item.href;
                return (
                  <Link
                    key={item.name}
                    to={item.href}
                    className={`sidebar-item ${isActive ? 'sidebar-item-active' : 'sidebar-item-inactive'}`}
                  >
                    <item.icon className="w-5 h-5 mr-3" />
                    {item.name}
                  </Link>
                );
              })}

              {/* Help Button */}
              <button
                onClick={() => setShowHelpModal(true)}
                className="sidebar-item sidebar-item-inactive w-full"
              >
                <QuestionMarkCircleIcon className="w-5 h-5 mr-3" />
                Help
              </button>
            </nav>
          )}
        </div>

        {/* Pilots Section — collapsible */}
        {agents.length > 0 && (
          <div className="flex-1 min-h-0 flex flex-col">
            {/* Sticky section header with collapse + view toggle */}
            <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setPilotsCollapsed(!pilotsCollapsed)}
                className="flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide hover:text-gray-700 dark:hover:text-gray-200"
              >
                <ChevronDownIcon className={`w-3 h-3 transition-transform ${pilotsCollapsed ? '-rotate-90' : ''}`} />
                <span>Pilots ({agents.length})</span>
              </button>
              {!pilotsCollapsed && (
                <button
                  onClick={() => setPilotViewMode(pilotViewMode === 'flat' ? 'team' : 'flat')}
                  className={`p-1 rounded transition-colors ${
                    pilotViewMode === 'team'
                      ? 'bg-loxia-100 text-loxia-700 dark:bg-loxia-900/30 dark:text-loxia-400'
                      : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                  }`}
                  title={pilotViewMode === 'flat' ? 'Group by team' : 'Flat list'}
                >
                  {pilotViewMode === 'team' ? (
                    <UserGroupIcon className="w-3.5 h-3.5" />
                  ) : (
                    <ListBulletIcon className="w-3.5 h-3.5" />
                  )}
                </button>
              )}
            </div>
            {!pilotsCollapsed && (
            <div className="px-4 pb-3 flex-1 min-h-0 flex flex-col">

            {/* Filter input */}
            <div className="relative mb-2">
              <MagnifyingGlassIcon className="w-3 h-3 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={pilotFilter}
                onChange={(e) => setPilotFilter(e.target.value)}
                placeholder="Filter pilots..."
                className="w-full pl-6 pr-2 py-1 text-xs bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded text-gray-700 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-loxia-500"
              />
            </div>

            {/* Pilot list — flat or team view */}
            <div className="space-y-1 overflow-y-auto flex-1 min-h-0">
              {pilotViewMode === 'flat' ? (
                <>
                  {visiblePilots.map((agent) => (
                    <button
                      key={agent.id}
                      onClick={() => switchAgent(agent.id)}
                      className={`w-full text-left flex items-center text-sm p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                        currentAgent?.id === agent.id ? 'bg-loxia-50 dark:bg-loxia-900/20' : ''
                      }`}
                    >
                      <AgentStatusIndicator agent={agent} size="xs" />
                      <span className="ml-2 text-gray-600 dark:text-gray-300 truncate">
                        {agent.name}
                      </span>
                      {currentAgent?.id === agent.id && (
                        <div className="ml-auto w-1.5 h-1.5 rounded-full bg-loxia-500" />
                      )}
                    </button>
                  ))}
                  {filteredAgents.length > 5 && (
                    <button
                      onClick={() => setPilotsExpanded(!pilotsExpanded)}
                      className="w-full flex items-center justify-center gap-1 py-1 text-xs text-gray-500 hover:text-loxia-600 dark:text-gray-400 dark:hover:text-loxia-400 transition-colors"
                    >
                      {pilotsExpanded ? 'Show less' : `+${filteredAgents.length - 5} more`}
                      <ChevronDownIcon className={`w-3 h-3 transition-transform ${pilotsExpanded ? 'rotate-180' : ''}`} />
                    </button>
                  )}
                  {filteredAgents.length === 0 && pilotFilter && (
                    <div className="text-xs text-gray-400 text-center py-2 italic">No matches</div>
                  )}
                </>
              ) : (
                <>
                  {/* Team view */}
                  {agentsByTeamForSidebar.teams.map(({ team, members }) => {
                    const isCollapsed = collapsedTeams.has(team.id);
                    return (
                      <div key={team.id}>
                        <button
                          onClick={() => toggleTeamCollapse(team.id)}
                          className="w-full flex items-center text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 py-0.5"
                        >
                          {isCollapsed ? (
                            <ChevronRightIcon className="w-3 h-3 mr-1" />
                          ) : (
                            <ChevronDownIcon className="w-3 h-3 mr-1" />
                          )}
                          <span className="truncate">{team.name}</span>
                          <span className="ml-1 text-gray-400">({members.length})</span>
                        </button>
                        {!isCollapsed && (
                          <div className="ml-3 space-y-0.5">
                            {members.map(agent => (
                              <button
                                key={agent.id}
                                onClick={() => switchAgent(agent.id)}
                                className={`w-full text-left flex items-center text-sm p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                                  currentAgent?.id === agent.id ? 'bg-loxia-50 dark:bg-loxia-900/20' : ''
                                }`}
                              >
                                <AgentStatusIndicator agent={agent} size="xs" />
                                <span className="ml-2 text-gray-600 dark:text-gray-300 truncate text-xs">
                                  {agent.name}
                                </span>
                                {currentAgent?.id === agent.id && (
                                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-loxia-500" />
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {/* Unassigned pseudo-team */}
                  {agentsByTeamForSidebar.unassigned.length > 0 && (
                    <div>
                      <button
                        onClick={() => toggleTeamCollapse('__unassigned__')}
                        className="w-full flex items-center text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 py-0.5"
                      >
                        {collapsedTeams.has('__unassigned__') ? (
                          <ChevronRightIcon className="w-3 h-3 mr-1" />
                        ) : (
                          <ChevronDownIcon className="w-3 h-3 mr-1" />
                        )}
                        <span className="italic">Unassigned</span>
                        <span className="ml-1 text-gray-400">({agentsByTeamForSidebar.unassigned.length})</span>
                      </button>
                      {!collapsedTeams.has('__unassigned__') && (
                        <div className="ml-3 space-y-0.5">
                          {agentsByTeamForSidebar.unassigned.map(agent => (
                            <button
                              key={agent.id}
                              onClick={() => switchAgent(agent.id)}
                              className={`w-full text-left flex items-center text-sm p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                                currentAgent?.id === agent.id ? 'bg-loxia-50 dark:bg-loxia-900/20' : ''
                              }`}
                            >
                              <AgentStatusIndicator agent={agent} size="xs" />
                              <span className="ml-2 text-gray-600 dark:text-gray-300 truncate text-xs">
                                {agent.name}
                              </span>
                              {currentAgent?.id === agent.id && (
                                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-loxia-500" />
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {agentsByTeamForSidebar.teams.length === 0 && agentsByTeamForSidebar.unassigned.length === 0 && pilotFilter && (
                    <div className="text-xs text-gray-400 text-center py-2 italic">No matches</div>
                  )}
                </>
              )}
            </div>
          </div>
          )}
          </div>
        )}

        {/* Footer */}
        <div className="px-4 py-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={toggleDarkMode}
            className="flex items-center w-full px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            {/* Cycle icon + label advertise the NEXT theme in the rotation:
                 light → dark → dracula → redteam → light */}
            {theme === 'redteam' ? (
              <SunIcon className="w-5 h-5 mr-3" />
            ) : theme === 'dracula' ? (
              <ShieldExclamationIcon className="w-5 h-5 mr-3 text-red-400" />
            ) : theme === 'dark' ? (
              <SparklesIcon className="w-5 h-5 mr-3 text-purple-400" />
            ) : (
              <MoonIcon className="w-5 h-5 mr-3" />
            )}
            {theme === 'redteam' ? 'Light Mode'
              : theme === 'dracula' ? 'Red Team'
              : theme === 'dark' ? 'Dracula'
              : 'Dark Mode'}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className={`transition-all duration-300 ease-in-out ${sidebarOpen ? 'ml-64' : 'ml-0'}`}>
        {/* Sidebar toggle — only visible when sidebar is closed */}
        {!sidebarOpen && (
          <div className="sticky top-0 z-40 flex items-center px-2 py-1 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            <button
              onClick={toggleSidebar}
              className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <Bars3Icon className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            </button>
            <div className="flex items-center gap-2 ml-2 text-xs text-gray-400">
              <div className="flex items-center gap-1" title={connected ? 'Engine connected' : 'Engine disconnected'}>
                <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
                <span>Local</span>
              </div>
            </div>
          </div>
        )}

        {/* Error Banner */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800">
            <div className="px-4 py-3">
              <div className="flex items-center">
                <ExclamationTriangleIcon className="w-5 h-5 text-red-400 mr-3" />
                <div className="flex-1">
                  <p className="text-sm text-red-800 dark:text-red-200">
                    {error}
                  </p>
                </div>
                <button
                  onClick={clearError}
                  className="text-red-400 hover:text-red-600 dark:hover:text-red-300"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Page Content */}
        <main className="flex-1">
          {children}
        </main>
      </div>

      {/* Sidebar Overlay (Mobile) */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black bg-opacity-50 lg:hidden"
          onClick={toggleSidebar}
        />
      )}

      {/* Help Modal */}
      <HelpModal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
      />

      {/*
        Globally-mounted agent modals — the keyboard shortcut handler
        above sets store flags; this hosts the actual modal UIs so they
        open from any route, not just /agents.
      */}
      <GlobalAgentModals />
    </div>
  );
}

export default Layout;