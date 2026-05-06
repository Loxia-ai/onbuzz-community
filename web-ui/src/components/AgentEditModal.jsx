import React, { useState, useEffect, useMemo } from 'react';
import {
  XMarkIcon,
  CpuChipIcon,
  DocumentTextIcon,
  Cog6ToothIcon,
  ExclamationTriangleIcon,
  ArchiveBoxIcon
} from '@heroicons/react/24/outline';
import { useAppStore } from '../stores/appStore.js';
import LoadingSpinner from './LoadingSpinner.jsx';
import FolderPicker from './FolderPicker.jsx';
import DirectoryArrayPicker from './DirectoryArrayPicker.jsx';
import { api } from '../services/api.js';
import toast from 'react-hot-toast';
import ToolIcon from './ToolIcon.jsx';
import ToolConfigModal from './toolConfig/ToolConfigModal.jsx';
import { hasConfigurator } from './toolConfig/registry.js';
import MemoryManagementTab from './MemoryManagementTab.jsx';
import { withoutOptInOnly } from '../constants/toolConstants.js';
import ModelPicker from './ModelPicker.jsx';

function AgentEditModal({ agent, onClose, onSuccess }) {
  const { updateAgent, loading } = useAppStore();

  const [formData, setFormData] = useState({
    name: agent?.name || '',
    systemPrompt: agent?.originalSystemPrompt || agent?.systemPrompt || '',
    model: agent?.preferredModel || agent?.currentModel || '',
    dynamicModelRouting: agent?.dynamicModelRouting || false,
    routingStrategy: agent?.routingStrategy || '',
    skills: agent?.skills || [],
    capabilities: agent?.capabilities || [],
    toolConfig: agent?.toolConfig || {},
    directoryAccess: {
      workingDirectory: '',
      readOnlyDirectories: [],
      writeEnabledDirectories: [],
      restrictToProject: true,
      allowSystemAccess: false,
      ...(agent?.directoryAccess || {})
    }
  });
  const [configuringTool, setConfiguringTool] = useState(null);

  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState('general');
  const [availableTools, setAvailableTools] = useState([]);
  const [loadingTools, setLoadingTools] = useState(true);
  const [toolSearch, setToolSearch] = useState('');
  const [availableSkills, setAvailableSkills] = useState([]);
  const [loadingSkills, setLoadingSkills] = useState(true);

  // Filter tools by name / description / category (case-insensitive substring).
  const filteredTools = useMemo(() => {
    const q = toolSearch.trim().toLowerCase();
    if (!q) return availableTools;
    return availableTools.filter(t => (
      (t.name || '').toLowerCase().includes(q) ||
      (t.description || '').toLowerCase().includes(q) ||
      (t.category || '').toLowerCase().includes(q) ||
      (t.id || '').toLowerCase().includes(q)
    ));
  }, [availableTools, toolSearch]);


  useEffect(() => {
    if (agent) {
      console.log('🔄 Setting form data from agent:', {
        agentId: agent.id,
        name: agent.name,
        systemPrompt: agent.systemPrompt,
        preferredModel: agent.preferredModel,
        currentModel: agent.currentModel,
        dynamicModelRouting: agent.dynamicModelRouting,
        capabilities: agent.capabilities,
        directoryAccess: agent.directoryAccess
      });
      
      setFormData({
        name: agent.name || '',
        // Use original system prompt if available, otherwise use current (which might be enhanced)
        systemPrompt: agent.originalSystemPrompt || agent.systemPrompt || '',
        model: agent.preferredModel || agent.currentModel || '',
        dynamicModelRouting: agent.dynamicModelRouting || false,
        routingStrategy: agent.routingStrategy || '',
        skills: agent.skills || [],
        capabilities: agent.capabilities || [],
        toolConfig: agent.toolConfig || {},
        directoryAccess: {
          workingDirectory: '',
          readOnlyDirectories: [],
          writeEnabledDirectories: [],
          restrictToProject: true,
          allowSystemAccess: false,
          ...(agent.directoryAccess || {})
        }
      });
    }
  }, [agent]);

  // Fetch available tools from backend on mount — single source of truth
  useEffect(() => {
    const fetchTools = async () => {
      try {
        setLoadingTools(true);
        const response = await api.getTools();
        if (response.success && response.tools) {
          setAvailableTools(response.tools);
          // If agent has no capabilities (legacy/loaded), default to all
          // available tools EXCEPT opt-in-only ones (platformcontrol et al.).
          // We don't want to silently grant cross-cutting platform power
          // to every legacy agent on first edit-modal open.
          if (!agent?.capabilities || agent.capabilities.length === 0) {
            const allToolIds = withoutOptInOnly(response.tools.map(t => t.id));
            setFormData(prev => ({ ...prev, capabilities: allToolIds }));
          }
        } else {
          toast.error('Failed to load tools from server');
        }
      } catch (error) {
        console.error('Failed to fetch tools:', error);
        toast.error('Failed to load tools from server');
      } finally {
        setLoadingTools(false);
      }
    };

    fetchTools();

    const fetchSkills = async () => {
      try {
        const response = await api.listSkills();
        if (response.success) setAvailableSkills(response.skills || []);
      } catch { /* skills are optional */ }
      finally { setLoadingSkills(false); }
    };
    fetchSkills();
  }, []);

  const validateForm = () => {
    const newErrors = {};
    
    console.log('🔍 Validating form data:', {
      name: formData.name,
      nameLength: formData.name?.length,
      systemPrompt: formData.systemPrompt,
      promptLength: formData.systemPrompt?.length,
      model: formData.model,
      hasModel: !!formData.model
    });
    
    if (!formData.name.trim()) {
      newErrors.name = 'Pilot name is required';
    } else if (formData.name.length > 50) {
      newErrors.name = 'Pilot name must be 50 characters or less';
    }
    
    // System prompt is not required for editing and has no length restrictions
    
    if (!formData.model) {
      newErrors.model = 'Please select a model';
    }
    
    console.log('🚨 Validation errors:', newErrors);
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      toast.error('Please fix the errors below');
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      // Only send fields that should be updated to avoid backend validation issues
      const updatesPayload = {
        name: formData.name.trim(),
        dynamicModelRouting: formData.dynamicModelRouting,
        routingStrategy: formData.routingStrategy,
        skills: formData.skills,
        capabilities: formData.capabilities,
        // Per-tool config — send only if it diverges from the agent's
        // current value so agents without overrides don't get an empty
        // object written to their state.
        ...(JSON.stringify(formData.toolConfig || {}) !== JSON.stringify(agent.toolConfig || {})
          ? { toolConfig: formData.toolConfig || {} }
          : {}),
      };

      // Only include directory access if user actually modified it
      const workingDirChanged = formData.directoryAccess.workingDirectory?.trim() !== agent.directoryAccess?.workingDirectory;
      const readOnlyChanged = JSON.stringify(formData.directoryAccess.readOnlyDirectories) !== JSON.stringify(agent.directoryAccess?.readOnlyDirectories || []);
      const writeEnabledChanged = JSON.stringify(formData.directoryAccess.writeEnabledDirectories) !== JSON.stringify(agent.directoryAccess?.writeEnabledDirectories || []);
      const restrictChanged = formData.directoryAccess.restrictToProject !== agent.directoryAccess?.restrictToProject;
      const systemAccessChanged = formData.directoryAccess.allowSystemAccess !== agent.directoryAccess?.allowSystemAccess;
      
      if (workingDirChanged || readOnlyChanged || writeEnabledChanged || restrictChanged || systemAccessChanged) {
        // Clean up directory access configuration only if there are actual changes
        const trimmedWorkingDir = formData.directoryAccess.workingDirectory?.trim() || agent.directoryAccess?.workingDirectory || '.';
        let writeEnabled = formData.directoryAccess.writeEnabledDirectories.filter(dir => dir.trim());
        // Auto-add working directory to write-enabled if not already present
        if (trimmedWorkingDir && trimmedWorkingDir !== '.' && !writeEnabled.includes(trimmedWorkingDir)) {
          writeEnabled = [...writeEnabled, trimmedWorkingDir];
        }
        const cleanDirectoryAccess = {
          workingDirectory: trimmedWorkingDir,
          readOnlyDirectories: formData.directoryAccess.readOnlyDirectories.filter(dir => dir.trim()),
          writeEnabledDirectories: writeEnabled,
          restrictToProject: formData.directoryAccess.restrictToProject,
          allowSystemAccess: formData.directoryAccess.allowSystemAccess
        };
        updatesPayload.directoryAccess = cleanDirectoryAccess;
      }

      // Only include model if it's different or if it's specified
      if (formData.model && formData.model.trim()) {
        updatesPayload.preferredModel = formData.model.trim();
      }

      // Always send system prompt — even if empty (user may want to clear it)
      // Send as originalSystemPrompt so the backend knows this is the raw user prompt
      // (the backend will enhance it with tool descriptions and store the enhanced version as systemPrompt)
      const promptChanged = formData.systemPrompt.trim() !== (agent.originalSystemPrompt || agent.systemPrompt || '').trim();
      if (promptChanged) {
        updatesPayload.originalSystemPrompt = formData.systemPrompt.trim();
      }

      console.log('📤 Sending agent updates:', updatesPayload);
      await updateAgent(agent.id, updatesPayload);
      toast.success(`${formData.name} updated successfully!`);
      onSuccess?.();
      
    } catch (error) {
      console.error('Failed to update agent:', error);
      toast.error('Failed to update agent: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: null }));
    }
  };

  const tabs = [
    { id: 'general', name: 'General', icon: CpuChipIcon },
    { id: 'prompt', name: 'System Prompt', icon: DocumentTextIcon },
    { id: 'memory', name: 'Memory', icon: ArchiveBoxIcon },
    { id: 'advanced', name: 'Advanced', icon: Cog6ToothIcon }
  ];

  if (!agent) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-loxia-600 rounded-full flex items-center justify-center mr-3">
              <CpuChipIcon className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                Edit Pilot
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Modify {agent.name}'s configuration and behavior
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
            disabled={isSubmitting}
          >
            <XMarkIcon className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 dark:border-gray-700">
          <div className="flex space-x-8 px-6">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === tab.id
                    ? 'border-loxia-500 text-loxia-600 dark:text-loxia-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                <tab.icon className="w-4 h-4 mr-2" />
                {tab.name}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[60vh]">
          <form onSubmit={handleSubmit} className="p-6">
            {activeTab === 'general' && (
              <div className="space-y-6">
                {/* Pilot Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Pilot Name
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => handleInputChange('name', e.target.value)}
                    className={`input-primary ${errors.name ? 'border-red-500' : ''}`}
                    placeholder="Enter pilot name"
                    maxLength={50}
                    disabled={isSubmitting}
                  />
                  {errors.name && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.name}</p>
                  )}
                </div>

                {/* Model Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Language Model
                  </label>
                  <ModelPicker
                    value={formData.model}
                    onChange={(id) => handleInputChange('model', id)}
                    disabled={isSubmitting}
                    idPrefix="agent-edit-model"
                  />
                  {errors.model && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.model}</p>
                  )}
                </div>

                {/* Current Model Display */}
                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Current Status
                  </h4>
                  <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                    <p><strong>Current Model:</strong> {agent.currentModel}</p>
                    <p><strong>Status:</strong> {agent.status}</p>
                    <p><strong>Messages:</strong> {agent.messageCount || 0}</p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'prompt' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    System Prompt
                    <span className="text-xs text-gray-500 ml-1">(Optional)</span>
                  </label>
                  <textarea
                    value={formData.systemPrompt}
                    onChange={(e) => handleInputChange('systemPrompt', e.target.value)}
                    className={`input-primary ${errors.systemPrompt ? 'border-red-500' : ''}`}
                    rows={12}
                    placeholder="Define the agent's role, personality, and behavior... (Leave empty to keep current prompt)"
                    disabled={isSubmitting}
                  />
                  <div className="mt-1 flex justify-between">
                    {errors.systemPrompt && (
                      <p className="text-sm text-red-600 dark:text-red-400">{errors.systemPrompt}</p>
                    )}
                    <p className="text-sm text-gray-500 dark:text-gray-400 ml-auto">
                      {(formData.systemPrompt || '').length.toLocaleString()} characters
                    </p>
                  </div>
                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                    💡 This shows your original prompt (without tool descriptions). Tool capabilities will be automatically added when you save.
                  </p>
                </div>
              </div>
            )}

            {activeTab === 'memory' && (
              <MemoryManagementTab agentId={agent?.id} />
            )}

            {activeTab === 'advanced' && (
              <div className="space-y-6">
                {/* Dynamic Model Routing */}
                <div>
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Dynamic Model Routing
                      </h4>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Allow the system to automatically select the best model for each message
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.dynamicModelRouting}
                        onChange={(e) => handleInputChange('dynamicModelRouting', e.target.checked)}
                        className="sr-only peer"
                        disabled={isSubmitting}
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-loxia-300 dark:peer-focus:ring-loxia-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-loxia-600"></div>
                    </label>
                  </div>
                  {/* Routing Strategy — visible when dynamic routing is ON */}
                  {formData.dynamicModelRouting && (
                    <div className="mt-4 transition-all duration-200">
                      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Routing Strategy
                      </h4>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                        Custom instructions that guide model selection for this agent
                      </p>
                      <textarea
                        value={formData.routingStrategy}
                        onChange={(e) => handleInputChange('routingStrategy', e.target.value)}
                        rows={4}
                        maxLength={2000}
                        disabled={isSubmitting}
                        placeholder={"e.g. Prefer fast models for short questions.\nUse Claude for complex code generation.\nUse DeepSeek for mathematical reasoning.\nMinimize model switches unless task type clearly changes."}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-loxia-500 focus:border-transparent text-sm font-mono resize-none"
                      />
                      <div className="text-right text-xs text-gray-400 mt-1">
                        {(formData.routingStrategy || '').length} / 2000
                      </div>
                    </div>
                  )}
                </div>

                {/* Capabilities */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Capabilities
                    </h4>
                    {!loadingTools && (
                      <span className="text-[10px] font-medium text-loxia-600 dark:text-loxia-400 bg-loxia-50 dark:bg-loxia-900/20 px-1.5 py-0.5 rounded-full">
                        {formData.capabilities.length}/{availableTools.length}
                      </span>
                    )}
                  </div>
                  {!loadingTools && availableTools.length > 0 && (
                    <input
                      type="text"
                      placeholder="Search tools by name, description, or category..."
                      value={toolSearch}
                      onChange={(e) => setToolSearch(e.target.value)}
                      className="w-full mb-3 px-2.5 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-loxia-500"
                      disabled={isSubmitting}
                    />
                  )}
                  <div className="space-y-1">
                    {loadingTools ? (
                      <div className="flex items-center space-x-2">
                        <LoadingSpinner />
                        <span className="text-sm text-gray-500 dark:text-gray-400">Loading available tools...</span>
                      </div>
                    ) : filteredTools.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-4">
                        {toolSearch ? `No tools match "${toolSearch}"` : 'No tools available'}
                      </p>
                    ) : (
                      filteredTools.map((tool) => {
                        const isChecked = formData.capabilities.includes(tool.id);
                        return (
                          <label
                            key={tool.id}
                            htmlFor={tool.id}
                            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-all text-sm ${
                              isChecked
                                ? 'bg-loxia-100/70 dark:bg-loxia-900/20 text-loxia-700 dark:text-loxia-300'
                                : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                            }`}
                            title={tool.description || tool.name}
                          >
                            <input
                              type="checkbox"
                              id={tool.id}
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  handleInputChange('capabilities', [...formData.capabilities, tool.id]);
                                } else {
                                  handleInputChange('capabilities', formData.capabilities.filter(c => c !== tool.id));
                                }
                              }}
                              className="h-4 w-4 text-loxia-600 focus:ring-loxia-500 border-gray-300 rounded flex-shrink-0"
                              disabled={isSubmitting}
                            />
                            <ToolIcon
                              iconName={tool.iconName}
                              toolId={tool.id}
                              className={`w-4 h-4 flex-shrink-0 ${
                                isChecked ? 'text-loxia-600 dark:text-loxia-400' : 'text-gray-400 dark:text-gray-500'
                              }`}
                            />
                            <span className="flex-1 truncate">{tool.name}</span>
                            {tool.category && (
                              <span className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded flex-shrink-0">
                                {tool.category}
                              </span>
                            )}
                            {isChecked && hasConfigurator(tool.id) && (
                              <span
                                role="button"
                                tabIndex={0}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setConfiguringTool(tool);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setConfiguringTool(tool);
                                  }
                                }}
                                className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex-shrink-0"
                                title={`Configure ${tool.name}`}
                                aria-label={`Configure ${tool.name}`}
                              >
                                <Cog6ToothIcon className="w-4 h-4" />
                              </span>
                            )}
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Assigned Skills */}
                {availableSkills.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Assigned Skills
                    </h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                      Skills this agent can reference during conversations
                    </p>
                    <div className="space-y-2">
                      {loadingSkills ? (
                        <div className="flex items-center gap-2 py-2"><LoadingSpinner size="sm" /><span className="text-sm text-gray-400">Loading skills...</span></div>
                      ) : (
                        availableSkills.map(skill => (
                          <label key={skill.name} className="flex items-start gap-2 cursor-pointer group">
                            <input
                              type="checkbox"
                              checked={(formData.skills || []).includes(skill.name)}
                              onChange={(e) => {
                                const updated = e.target.checked
                                  ? [...(formData.skills || []), skill.name]
                                  : (formData.skills || []).filter(s => s !== skill.name);
                                handleInputChange('skills', updated);
                              }}
                              className="h-4 w-4 mt-0.5 text-loxia-600 focus:ring-loxia-500 border-gray-300 rounded"
                              disabled={isSubmitting}
                            />
                            <div>
                              <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-loxia-600 dark:group-hover:text-loxia-400 font-medium">
                                {skill.name}
                              </span>
                              {skill.description && (
                                <p className="text-xs text-gray-400">{skill.description}</p>
                              )}
                            </div>
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* Directory Access Configuration */}
                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center">
                      Directory Access
                    </h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Configure which directories this pilot can access for file operations and terminal commands.
                    </p>
                  </div>

                  {/* Working Directory */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Working Directory
                    </label>
                    <FolderPicker
                      value={formData.directoryAccess.workingDirectory}
                      onChange={(value) => setFormData(prev => ({
                        ...prev,
                        directoryAccess: {
                          ...prev.directoryAccess,
                          workingDirectory: value
                        }
                      }))}
                      onBlur={() => {
                        const dir = formData.directoryAccess.workingDirectory.trim();
                        if (dir) {
                          setFormData(prev => {
                            if (prev.directoryAccess.writeEnabledDirectories.includes(dir)) return prev;
                            return { ...prev, directoryAccess: { ...prev.directoryAccess, writeEnabledDirectories: [...prev.directoryAccess.writeEnabledDirectories, dir] } };
                          });
                        }
                      }}
                      onComplete={(dir) => {
                        const trimmed = dir.trim();
                        if (trimmed) {
                          setFormData(prev => {
                            if (prev.directoryAccess.writeEnabledDirectories.includes(trimmed)) return prev;
                            return { ...prev, directoryAccess: { ...prev.directoryAccess, writeEnabledDirectories: [...prev.directoryAccess.writeEnabledDirectories, trimmed] } };
                          });
                        }
                      }}
                      placeholder="Enter working directory path (leave empty for current directory)"
                      disabled={isSubmitting}
                      allowBrowseHelper={true}
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      The default working directory for this pilot. Leave empty to use current directory. Project directory is automatically added to write-enabled directories.
                    </p>
                  </div>

                  {/* Read-Only Directories */}
                  <DirectoryArrayPicker
                    directories={formData.directoryAccess.readOnlyDirectories}
                    onChange={(directories) => setFormData(prev => ({
                      ...prev,
                      directoryAccess: {
                        ...prev.directoryAccess,
                        readOnlyDirectories: directories
                      }
                    }))}
                    label="Read-Only Directories"
                    description="Directories the pilot can read files from but cannot modify."
                    placeholder="Select read-only directory"
                    disabled={isSubmitting}
                    addButtonText="Add Read-Only Directory"
                  />

                  {/* Write-Enabled Directories */}
                  <DirectoryArrayPicker
                    directories={formData.directoryAccess.writeEnabledDirectories}
                    onChange={(directories) => setFormData(prev => ({
                      ...prev,
                      directoryAccess: {
                        ...prev.directoryAccess,
                        writeEnabledDirectories: directories
                      }
                    }))}
                    label="Write-Enabled Directories"
                    description="Directories the pilot can read from and write to (includes file creation, modification, deletion)."
                    placeholder="Select write-enabled directory"
                    disabled={isSubmitting}
                    addButtonText="Add Write-Enabled Directory"
                  />

                  {/* Security Options */}
                  <div className="space-y-3">
                    <div className="flex items-start space-x-3">
                      <input
                        type="checkbox"
                        id="restrictToProject"
                        checked={formData.directoryAccess.restrictToProject}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          directoryAccess: {
                            ...prev.directoryAccess,
                            restrictToProject: e.target.checked
                          }
                        }))}
                        className="mt-1 h-4 w-4 text-loxia-600 focus:ring-loxia-500 border-gray-300 rounded disabled:opacity-50"
                        disabled={isSubmitting}
                      />
                      <div className="flex-1">
                        <label htmlFor="restrictToProject" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                          Restrict to Project Scope
                        </label>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          Prevent the pilot from accessing files outside the configured directories.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start space-x-3">
                      <input
                        type="checkbox"
                        id="allowSystemAccess"
                        checked={formData.directoryAccess.allowSystemAccess}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          directoryAccess: {
                            ...prev.directoryAccess,
                            allowSystemAccess: e.target.checked
                          }
                        }))}
                        className="mt-1 h-4 w-4 text-loxia-600 focus:ring-loxia-500 border-gray-300 rounded disabled:opacity-50"
                        disabled={isSubmitting}
                      />
                      <div className="flex-1">
                        <label htmlFor="allowSystemAccess" className="block text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center">
                          Allow System Access
                          <ExclamationTriangleIcon className="h-4 w-4 text-amber-500 ml-1" />
                        </label>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          <span className="text-amber-600 dark:text-amber-400 font-medium">Warning:</span> Allow access to system directories like /etc, /usr. Use with extreme caution.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </form>
        </div>

        {/* Footer */}
        <div className="flex justify-end space-x-3 p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <button
            type="button"
            onClick={onClose}
            className="button-secondary"
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="button-primary"
            disabled={isSubmitting || loading}
          >
            {isSubmitting ? (
              <>
                <LoadingSpinner size="xs" className="mr-2" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </button>
        </div>
      </div>

      {/* Per-tool configuration modal. Opened by the ⚙ next to each
          enabled tool in the Capabilities list. Writes back to
          formData.toolConfig — which is pushed to the backend via
          handleInputChange on submit. */}
      {configuringTool && (
        <ToolConfigModal
          tool={configuringTool}
          value={(formData.toolConfig && formData.toolConfig[configuringTool.id]) || null}
          onClose={() => setConfiguringTool(null)}
          onSave={(newValue) => {
            const next = { ...(formData.toolConfig || {}) };
            if (newValue === null) {
              delete next[configuringTool.id];
            } else {
              next[configuringTool.id] = newValue;
            }
            handleInputChange('toolConfig', next);
          }}
        />
      )}
    </div>
  );
}

export default AgentEditModal;