import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDownIcon,
  CheckIcon,
  ArrowPathIcon,
  CloudArrowDownIcon,
  UserCircleIcon,
  MagnifyingGlassIcon
} from '@heroicons/react/24/outline';
import { api } from '../../../services/api.js';
import { useAppStore } from '../../../stores/appStore.js';

/**
 * AgentSelector - Enhanced agent selection with inline loading of archived agents
 */
function AgentSelector({ value, onChange, className = '' }) {
  const [isOpen, setIsOpen] = useState(false);
  const [allAgents, setAllAgents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingAgentId, setLoadingAgentId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState(null);
  const [dropdownPos, setDropdownPos] = useState(null);
  const dropdownRef = useRef(null);
  const triggerRef = useRef(null);
  const searchInputRef = useRef(null);

  const { agents: loadedAgents, refreshAgents } = useAppStore();

  // Helper to get agent ID (API returns agentId, loaded agents have id)
  const getAgentId = (agent) => agent.agentId || agent.id;

  // Fetch all available agents when dropdown opens or if we have a value but no data
  useEffect(() => {
    if (isOpen) {
      fetchAllAgents();
      // Focus search input when opened
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Also fetch on mount if we have a value but can't find the agent in loadedAgents
  useEffect(() => {
    if (value && !loadedAgents.find(a => a.id === value) && allAgents.length === 0) {
      fetchAllAgents();
    }
  }, [value, loadedAgents]);

  // Calculate dropdown position when opening
  const updateDropdownPos = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: Math.max(rect.width, 280)
      });
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      updateDropdownPos();
    }
  }, [isOpen, updateDropdownPos]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target) &&
          triggerRef.current && !triggerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const fetchAllAgents = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.getAvailableAgents();
      if (response.success) {
        setAllAgents(response.agents || []);
      } else {
        setError(response.error || 'Failed to fetch agents');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadAgent = async (agentId, e) => {
    e.stopPropagation();
    setLoadingAgentId(agentId);
    setError(null);
    try {
      const response = await api.importAgent(agentId);
      if (response.success) {
        // Refresh the app store's agent list
        await refreshAgents();
        // Refresh our local list
        await fetchAllAgents();
        // Auto-select the loaded agent
        onChange(agentId);
        setIsOpen(false);
      } else {
        setError(response.error || 'Failed to load agent');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingAgentId(null);
    }
  };

  const handleSelectAgent = (agentId) => {
    onChange(agentId);
    setIsOpen(false);
  };

  // Get selected agent info - check multiple sources and ID formats
  const findSelectedAgent = () => {
    if (!value) return null;

    // Check in allAgents (from available API - has agentId)
    const fromAll = allAgents.find(a => a.agentId === value || a.id === value);
    if (fromAll) return fromAll;

    // Check in loadedAgents (from appStore - has id)
    const fromLoaded = loadedAgents.find(a => a.id === value);
    if (fromLoaded) return { ...fromLoaded, isLoaded: true };

    return null;
  };

  const selectedAgent = findSelectedAgent();

  // Filter agents by search
  const filteredAgents = allAgents.filter(agent =>
    agent.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    getAgentId(agent)?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Separate loaded and archived
  const loaded = filteredAgents.filter(a => a.isLoaded);
  const archived = filteredAgents.filter(a => !a.isLoaded);

  return (
    <div className={`relative ${className}`} ref={triggerRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-left hover:border-gray-400 dark:hover:border-gray-500 focus:outline-none focus:ring-2 focus:ring-loxia-500 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {selectedAgent ? (
            <>
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                selectedAgent.isLoaded !== false ? 'bg-green-500' : 'bg-gray-400'
              }`} />
              <span className="truncate text-gray-900 dark:text-gray-100 flex-1">
                {selectedAgent.name}
              </span>
              {(selectedAgent.model || selectedAgent.currentModel) && (
                <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                  {selectedAgent.model || selectedAgent.currentModel}
                </span>
              )}
            </>
          ) : (
            <span className="text-gray-400">Select an agent...</span>
          )}
        </div>
        <ChevronDownIcon className={`w-4 h-4 text-gray-400 flex-shrink-0 ml-2 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown — rendered via portal to escape overflow:hidden containers */}
      {isOpen && dropdownPos && createPortal(
        <div
          ref={dropdownRef}
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden"
          style={{
            position: 'fixed',
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
            zIndex: 9999
          }}
        >
          {/* Search */}
          <div className="p-2 border-b border-gray-200 dark:border-gray-700">
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search agents..."
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-loxia-500"
              />
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className="px-3 py-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800">
              {error}
            </div>
          )}

          {/* Agent List */}
          <div className="max-h-64 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-6 text-sm text-gray-500">
                <ArrowPathIcon className="w-4 h-4 animate-spin mr-2" />
                Loading agents...
              </div>
            ) : filteredAgents.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
                <UserCircleIcon className="w-8 h-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
                No agents found
              </div>
            ) : (
              <>
                {/* Loaded Agents Section */}
                {loaded.length > 0 && (
                  <div>
                    <div className="px-3 py-1.5 text-xs font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 sticky top-0">
                      Loaded ({loaded.length})
                    </div>
                    {loaded.map(agent => (
                      <AgentOption
                        key={getAgentId(agent)}
                        agent={agent}
                        agentId={getAgentId(agent)}
                        isSelected={value === getAgentId(agent)}
                        onSelect={() => handleSelectAgent(getAgentId(agent))}
                      />
                    ))}
                  </div>
                )}

                {/* Archived Agents Section */}
                {archived.length > 0 && (
                  <div>
                    <div className="px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 sticky top-0">
                      On Disk ({archived.length})
                    </div>
                    {archived.map(agent => (
                      <AgentOption
                        key={getAgentId(agent)}
                        agent={agent}
                        agentId={getAgentId(agent)}
                        isSelected={value === getAgentId(agent)}
                        isLoading={loadingAgentId === getAgentId(agent)}
                        onSelect={() => {}} // Can't select unloaded agent directly
                        onLoad={(e) => handleLoadAgent(getAgentId(agent), e)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

/**
 * Individual agent option in the dropdown
 */
function AgentOption({ agent, agentId, isSelected, isLoading, onSelect, onLoad }) {
  const isLoaded = agent.isLoaded;

  return (
    <div
      onClick={isLoaded ? onSelect : undefined}
      className={`
        flex items-center justify-between px-3 py-2.5 text-sm gap-2
        ${isLoaded ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700' : 'cursor-default bg-gray-50/50 dark:bg-gray-800/50'}
        ${isSelected ? 'bg-loxia-50 dark:bg-loxia-900/30' : ''}
      `}
    >
      {/* Left side: status dot + name */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
          isLoaded ? 'bg-green-500' : 'bg-gray-400'
        }`} />
        <div className="min-w-0 flex-1">
          <div className={`font-medium truncate ${isLoaded ? 'text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-400'}`}>
            {agent.name}
          </div>
          {agent.model && (
            <div className="text-xs text-gray-400 dark:text-gray-500 truncate">
              {agent.model}
            </div>
          )}
        </div>
      </div>

      {/* Right side: action button */}
      <div className="flex-shrink-0">
        {isSelected && isLoaded && (
          <CheckIcon className="w-4 h-4 text-loxia-600" />
        )}
        {!isLoaded && onLoad && (
          <button
            onClick={onLoad}
            disabled={isLoading}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-loxia-100 dark:bg-loxia-900/50 text-loxia-700 dark:text-loxia-300 hover:bg-loxia-200 dark:hover:bg-loxia-800/50 rounded transition-colors disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
                Loading
              </>
            ) : (
              <>
                <CloudArrowDownIcon className="w-3.5 h-3.5" />
                Load
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

export default AgentSelector;
