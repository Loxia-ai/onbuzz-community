import React, { useState, useEffect, useRef } from 'react';
import {
  XMarkIcon,
  CpuChipIcon,
  SparklesIcon,
  ExclamationTriangleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  DocumentDuplicateIcon
} from '@heroicons/react/24/outline';
import { useAppStore } from '../stores/appStore.js';
import { useModelsStore } from '../stores/modelsStore.js';
import LoadingSpinner from './LoadingSpinner.jsx';
import FolderPicker from './FolderPicker.jsx';
import DirectoryArrayPicker from './DirectoryArrayPicker.jsx';
import toast from 'react-hot-toast';
import { api } from '../services/api.js';
import { useAvailableTools } from '../hooks/useAvailableTools.js';
import ToolIcon from './ToolIcon.jsx';
import ToolConfigModal from './toolConfig/ToolConfigModal.jsx';
import { hasConfigurator } from './toolConfig/registry.js';
import { Cog6ToothIcon } from '@heroicons/react/24/outline';
import {
  PLATFORM_MODELS,
  AGENT_TEMPLATES,
  AGENT_TEMPLATE_CONFIGS,
  resolvePreferredModel
} from '../constants/index.js';
import { withoutOptInOnly } from '../constants/toolConstants.js';

// Name bank for auto-generated agent names
const AGENT_NAME_BANK = [
  'Ada', 'Alex', 'Aria', 'Atlas', 'Aurora', 'Axel', 'Bailey', 'Blake', 'Blaze', 'Bolt',
  'Bryce', 'Caden', 'Cairo', 'Caleb', 'Casper', 'Cedar', 'Chase', 'Clara', 'Cleo', 'Clyde',
  'Cody', 'Cole', 'Cooper', 'Coral', 'Cyrus', 'Dane', 'Dante', 'Dara', 'Dash', 'Dave',
  'Delta', 'Devon', 'Dexter', 'Drake', 'Dylan', 'Echo', 'Eden', 'Eli', 'Ember', 'Emma',
  'Eric', 'Evan', 'Eve', 'Felix', 'Finn', 'Flora', 'Flynn', 'Fox', 'Gabe', 'Gage',
  'Gemma', 'Grace', 'Grant', 'Gray', 'Gus', 'Hank', 'Harper', 'Haven', 'Hawk', 'Hayes',
  'Heath', 'Henry', 'Hope', 'Hudson', 'Hugo', 'Hunter', 'Iris', 'Ivan', 'Ivy', 'Jace',
  'Jack', 'Jade', 'Jake', 'James', 'Jane', 'Jared', 'Jasper', 'Jax', 'Jay', 'Jenna',
  'Jesse', 'Joe', 'Joel', 'Jonas', 'Jordan', 'Jules', 'June', 'Kai', 'Kane', 'Kate',
  'Kira', 'Kit', 'Knox', 'Kyle', 'Lana', 'Lance', 'Lane', 'Lea', 'Leo', 'Levi',
  'Lily', 'Link', 'Lola', 'Logan', 'Luca', 'Lucy', 'Luke', 'Luna', 'Macy', 'Mae',
  'Marco', 'Max', 'Maya', 'Mia', 'Miles', 'Milo', 'Mira', 'Nash', 'Nate', 'Neil',
  'Nell', 'Neo', 'Nico', 'Nina', 'Noah', 'Noel', 'Nora', 'Nova', 'Olive', 'Omar',
  'Opal', 'Oscar', 'Otto', 'Owen', 'Paige', 'Parker', 'Paul', 'Pax', 'Pearl', 'Penn',
  'Piper', 'Quinn', 'Rae', 'Raven', 'Ray', 'Reed', 'Reid', 'Remy', 'Rex', 'Rhea',
  'Riley', 'River', 'Robbie', 'Robin', 'Roman', 'Rose', 'Ruby', 'Ryan', 'Sage', 'Sam',
  'Sara', 'Scout', 'Sean', 'Seth', 'Shane', 'Shaw', 'Shay', 'Sierra', 'Simon', 'Sky',
  'Sloane', 'Sofia', 'Spencer', 'Stella', 'Sterling', 'Storm', 'Tate', 'Tessa', 'Theo', 'Tia',
  'Toby', 'Todd', 'Tony', 'Tori', 'Travis', 'Troy', 'Tyler', 'Uma', 'Vale', 'Vera',
  'Vince', 'Violet', 'Wade', 'Warren', 'Willow', 'Wren', 'Wyatt', 'Xander', 'Zane', 'Zara'
];

// Template display names for auto-naming
const TEMPLATE_DISPLAY_NAMES = {
  'coding-assistant': 'Developer',
  'data-analyst': 'Analyst',
  'creative-writer': 'Writer',
  'system-admin': 'Admin',
  'security-architect': 'SecArch',
  'custom': 'Pilot'
};

import { brand } from '../config/brand.js';
const AGENT_SERIAL_KEY = `${brand.storagePrefix}-agent-serial`;

// Get next serial number
const getNextSerial = () => {
  try {
    const current = parseInt(localStorage.getItem(AGENT_SERIAL_KEY) || '0', 10);
    const next = current + 1;
    localStorage.setItem(AGENT_SERIAL_KEY, next.toString());
    return next.toString().padStart(3, '0');
  } catch {
    return '001';
  }
};

// Get random name from bank
const getRandomName = () => {
  return AGENT_NAME_BANK[Math.floor(Math.random() * AGENT_NAME_BANK.length)];
};

// Generate full agent name
const generateAgentName = (templateId) => {
  const templateName = TEMPLATE_DISPLAY_NAMES[templateId] || 'Agent';
  const randomName = getRandomName();
  const serial = getNextSerial();
  return `${templateName} ${randomName} ${serial}`;
};

function AgentCreationModal({ onClose, onSuccess, sourceAgent = null }) {
  const { createAgent, duplicateAgent, loading } = useAppStore();
  const {
    models,
    loading: modelsLoading,
    error: modelsError,
    getModelsByCategory,
    refreshIfStale,
    isModelAvailable
  } = useModelsStore();

  // Determine if we're in clone mode
  const isCloneMode = !!sourceAgent;

  // Initialize form data based on whether we're cloning or creating new
  const getInitialFormData = () => {
    if (sourceAgent) {
      // Pre-fill from source agent
      return {
        name: `${sourceAgent.name} (Copy)`,
        model: sourceAgent.preferredModel || sourceAgent.currentModel || PLATFORM_MODELS.LOXIA_ANTHROPIC_SONNET,
        systemPrompt: sourceAgent.originalSystemPrompt || sourceAgent.systemPrompt || '',
        useTemplate: AGENT_TEMPLATES.CUSTOM, // Use custom since we have a specific prompt
        dynamicModelRouting: sourceAgent.dynamicModelRouting || false,
        routingStrategy: sourceAgent.routingStrategy || '',
        skills: [...(sourceAgent.skills || [])],
        capabilities: [...(sourceAgent.capabilities || [])],
        // Clone any per-tool config from the source agent too (shallow copy
        // — inner per-tool objects are shared, which is fine for immutable
        // form use).
        toolConfig: sourceAgent.toolConfig ? { ...sourceAgent.toolConfig } : {},
        directoryAccess: sourceAgent.directoryAccess ? {
          workingDirectory: sourceAgent.directoryAccess.workingDirectory || '',
          readOnlyDirectories: [...(sourceAgent.directoryAccess.readOnlyDirectories || [])],
          writeEnabledDirectories: [...(sourceAgent.directoryAccess.writeEnabledDirectories || [])],
          restrictToProject: sourceAgent.directoryAccess.restrictToProject ?? true,
          allowSystemAccess: sourceAgent.directoryAccess.allowSystemAccess ?? false
        } : {
          workingDirectory: '',
          readOnlyDirectories: [],
          writeEnabledDirectories: [],
          restrictToProject: true,
          allowSystemAccess: false
        }
      };
    }
    // Default for new agent
    return {
      name: '',
      model: PLATFORM_MODELS.LOXIA_ANTHROPIC_SONNET,
      systemPrompt: '',
      useTemplate: AGENT_TEMPLATES.CODING_ASSISTANT,
      dynamicModelRouting: false,
      routingStrategy: '',
      skills: [],
      // Leave capabilities empty on init; the template effect below
      // seeds them from templateToolsMapping once a template is chosen,
      // and the backend-driven tool catalogue (useAvailableTools)
      // authoritatively populates the "Custom" fallback. Previously this
      // was a hardcoded 24-tool list that could drift from what the
      // backend actually supported (notably, video-gen was missing).
      capabilities: [],
      // Per-tool configuration — empty by default, users opt in via ⚙
      // buttons in the tools panel.
      toolConfig: {},
      directoryAccess: {
        workingDirectory: '',
        readOnlyDirectories: [],
        writeEnabledDirectories: [],
        restrictToProject: true,
        allowSystemAccess: false
      }
    };
  };

  const [formData, setFormData] = useState(getInitialFormData);
  const [keepConversation, setKeepConversation] = useState(false);

  // Available tools come from the backend via useAvailableTools — same
  // single-source-of-truth the Edit Modal and ToolsSelectorDropdown use.
  // This replaces the previous hardcoded toolGroups array (~55 LOC) that
  // had drifted from the backend registry (missing video-gen, diverging
  // categories, no icons).
  const {
    tools: availableCapabilities,
    byCategory: _toolsByCategory,
    categories: _toolCategories,
    loading: loadingTools,
    error: toolsError,
  } = useAvailableTools({
    sortBy: 'category-then-name',
  });

  const toolGroups = _toolCategories.map(cat => ({
    name: cat,
    tools: _toolsByCategory[cat] || [],
  }));

  // Template-to-tools mapping for auto-selection
  // Note: All templates include 'agentcommunication' (multiagent) and 'pdf' by default
  const templateToolsMapping = {
    // Coder: All available tools
    [AGENT_TEMPLATES.CODING_ASSISTANT]: [
      'terminal', 'filesystem', 'file-content-replace', 'seek', 'file-tree', 'code-map', 'pdf', 'doc', 'spreadsheet',
      'staticanalysis', 'clonedetection', 'import-analyzer', 'dependency-resolver',
      'web', 'visual-editor',
      'taskmanager', 'jobdone', 'agentcommunication', 'agentdelay', 'memory', 'skills', 'userprompt', 'help'
    ],
    // Data Analyst: File tools + web + multiagent + delay + document tools
    [AGENT_TEMPLATES.DATA_ANALYST]: [
      'filesystem', 'file-content-replace', 'seek', 'file-tree', 'pdf', 'doc', 'spreadsheet', 'web',
      'terminal', 'taskmanager', 'jobdone', 'agentcommunication', 'agentdelay', 'memory', 'skills', 'userprompt', 'help'
    ],
    // Creative Writer: File system tools + image/video creation + web + document tools
    [AGENT_TEMPLATES.CREATIVE_WRITER]: [
      'terminal', 'filesystem', 'file-content-replace', 'seek', 'file-tree', 'pdf', 'doc', 'spreadsheet',
      'web', 'taskmanager', 'jobdone', 'agentcommunication', 'agentdelay', 'memory', 'skills', 'userprompt', 'help'
    ],
    // Admin: All tools EXCEPT image-gen, static analysis, clone detection, import analyzer, dependency resolver
    [AGENT_TEMPLATES.SYSTEM_ADMIN]: [
      'terminal', 'filesystem', 'file-content-replace', 'seek', 'file-tree', 'pdf', 'doc', 'spreadsheet',
      'web', 'taskmanager', 'jobdone', 'agentcommunication', 'agentdelay', 'memory', 'skills', 'userprompt', 'help'
    ],
    // Security Architect: All tools EXCEPT image-gen (same as Coder)
    [AGENT_TEMPLATES.SECURITY_ARCHITECT]: [
      'terminal', 'filesystem', 'file-content-replace', 'seek', 'file-tree', 'pdf', 'doc', 'spreadsheet',
      'staticanalysis', 'clonedetection', 'import-analyzer', 'dependency-resolver',
      'web', 'taskmanager', 'jobdone', 'agentcommunication', 'agentdelay', 'memory', 'skills', 'userprompt', 'help'
    ],
    // System Analyst: Analysis tools + web for research + memory + document tools
    [AGENT_TEMPLATES.SYSTEM_ANALYST]: [
      'terminal', 'filesystem', 'file-content-replace', 'seek', 'file-tree', 'pdf', 'doc', 'spreadsheet',
      'web', 'taskmanager', 'jobdone', 'agentcommunication', 'agentdelay', 'memory', 'skills', 'userprompt', 'help'
    ],
    // Team Manager: Coordination tools ONLY — delegates technical work to team members
    [AGENT_TEMPLATES.TEAM_MANAGER]: [
      'agentcommunication', 'taskmanager', 'jobdone', 'memory', 'userprompt', 'help', 'agentdelay', 'skills'
    ],
    // CUSTOM template auto-selects all tools EXCEPT opt-in-only ones
    // (e.g. platformcontrol). The user can still tick those individually.
    [AGENT_TEMPLATES.CUSTOM]: withoutOptInOnly(availableCapabilities.map(c => c.id))
  };

  const [errors, setErrors] = useState({});
  const [availableSkills, setAvailableSkills] = useState([]);
  const [modelsExpanded, setModelsExpanded] = useState(false); // Collapsed by default
  const [isNameUserMade, setIsNameUserMade] = useState(false); // Track if name was typed by user
  // Per-tool configuration modal target — { id, name, description, iconName }
  // or null when no modal is open.
  const [configuringTool, setConfiguringTool] = useState(null);

  // Find the best opus model (highest version) from available platform models
  const findBestOpusModel = () => {
    const categories = getModelsByCategory();
    const platformModels = categories.platform?.models || [];
    // Filter for opus models (name contains "opus", case-insensitive)
    const opusModels = platformModels.filter(m =>
      (m.modelName || m.id || '').toLowerCase().includes('opus')
    );
    if (opusModels.length === 0) return null;
    // Sort by version numbers extracted from model name (e.g., "opus-4-6" → [4,6])
    opusModels.sort((a, b) => {
      const extractVersions = (m) => {
        const name = m.modelName || m.id || '';
        const nums = name.match(/(\d+)/g);
        return nums ? nums.map(Number) : [0];
      };
      const aVer = extractVersions(a);
      const bVer = extractVersions(b);
      for (let i = 0; i < Math.max(aVer.length, bVer.length); i++) {
        const diff = (bVer[i] || 0) - (aVer[i] || 0);
        if (diff !== 0) return diff;
      }
      return 0;
    });
    return opusModels[0];
  };

  // Ref for auto-focusing the agent name input
  const agentNameInputRef = useRef(null);

  // Refresh models when component mounts
  useEffect(() => {
    refreshIfStale();
  }, [refreshIfStale]);

  // Fetch available skills for assignment
  useEffect(() => {
    api.listSkills().then(res => {
      if (res.success) setAvailableSkills(res.skills || []);
    }).catch(() => {});
  }, []);

  // Auto-focus the agent name input when modal opens
  useEffect(() => {
    if (agentNameInputRef.current) {
      agentNameInputRef.current.focus();
    }
  }, []);

  // Set default model on initial load only (not on template change)
  // Uses the template model resolver with fallback to first platform model
  useEffect(() => {
    const categories = getModelsByCategory();
    if (categories.platform?.models?.length > 0) {
      // Only set default if current model is the initial default (avoid overriding user selection)
      if (formData.model === PLATFORM_MODELS.LOXIA_ANTHROPIC_SONNET) {
        const preferredId = resolvePreferredModel(formData.useTemplate, categories.platform.models);
        const targetModel = preferredId || categories.platform.models[0].id;
        setFormData(prev => ({ ...prev, model: targetModel }));
      }
    }
  }, [getModelsByCategory, formData.model]);

  // Get dynamic model categories
  const modelCategories = getModelsByCategory();

  const templates = Object.keys(AGENT_TEMPLATE_CONFIGS).map(templateKey => ({
    id: templateKey,
    name: AGENT_TEMPLATE_CONFIGS[templateKey].name,
    description: AGENT_TEMPLATE_CONFIGS[templateKey].description,
    prompt: AGENT_TEMPLATE_CONFIGS[templateKey].prompt
  }));

  const validateForm = (data = formData) => {
    const newErrors = {};

    if (!data.name.trim()) {
      newErrors.name = 'Pilot name is required';
    } else if (data.name.trim().length < 2) {
      newErrors.name = 'Pilot name must be at least 2 characters';
    }

    if (data.useTemplate === AGENT_TEMPLATES.CUSTOM && !data.systemPrompt.trim()) {
      newErrors.systemPrompt = 'System prompt is required for custom pilots';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Auto-generate name if empty
    let submitData = formData;
    if (!formData.name.trim()) {
      const autoName = generateAgentName(formData.useTemplate);
      submitData = { ...formData, name: autoName };
      setFormData(submitData);
    }

    if (!validateForm(submitData)) return;

    try {
      let agent;

      if (isCloneMode) {
        // Clone mode: use duplicateAgent API
        agent = await duplicateAgent(sourceAgent.id, {
          newName: submitData.name.trim(),
          keepConversation
        });
        toast.success(`Pilot "${agent.name}" cloned successfully!`);
      } else {
        // Create mode: use createAgent API
        const selectedTemplate = templates.find(t => t.id === submitData.useTemplate);
        const systemPrompt = submitData.useTemplate === AGENT_TEMPLATES.CUSTOM
          ? submitData.systemPrompt
          : selectedTemplate.prompt;

        // Clean up directory access configuration (remove empty entries)
        const trimmedWorkingDir = submitData.directoryAccess.workingDirectory.trim();
        let writeEnabled = submitData.directoryAccess.writeEnabledDirectories.filter(dir => dir.trim());
        // Auto-add working directory to write-enabled if not already present
        if (trimmedWorkingDir && !writeEnabled.includes(trimmedWorkingDir)) {
          writeEnabled = [...writeEnabled, trimmedWorkingDir];
        }
        const cleanDirectoryAccess = {
          workingDirectory: trimmedWorkingDir || undefined,
          readOnlyDirectories: submitData.directoryAccess.readOnlyDirectories.filter(dir => dir.trim()),
          writeEnabledDirectories: writeEnabled,
          restrictToProject: submitData.directoryAccess.restrictToProject,
          allowSystemAccess: submitData.directoryAccess.allowSystemAccess
        };

        agent = await createAgent(
          submitData.name.trim(),
          submitData.model,
          systemPrompt,
          {
            dynamicModelRouting: submitData.dynamicModelRouting,
            routingStrategy: submitData.routingStrategy,
            capabilities: submitData.capabilities,
            skills: submitData.skills || [],
            directoryAccess: cleanDirectoryAccess,
            // Per-tool configuration — only send if non-empty so we don't
            // overwrite backend-side defaults with an empty object for
            // agents that don't use any overrides.
            ...(submitData.toolConfig && Object.keys(submitData.toolConfig).length > 0
              ? { toolConfig: submitData.toolConfig }
              : {}),
          }
        );
        toast.success(`Pilot "${agent.name}" deployed successfully!`);
      }

      onSuccess?.(agent);

    } catch (error) {
      toast.error(`Failed to ${isCloneMode ? 'clone' : 'deploy'} pilot: ` + error.message);
    }
  };

  const handleTemplateChange = (templateId) => {
    const template = templates.find(t => t.id === templateId);
    const recommendedTools = templateToolsMapping[templateId] || [];

    // Resolve the best model for this template from available platform models
    const categories = getModelsByCategory();
    const platformModels = categories.platform?.models || [];
    const preferredModelId = resolvePreferredModel(templateId, platformModels);

    setFormData(prev => {
      // Auto-generate name if empty OR if current name is auto-generated (not user-made)
      const shouldAutoName = !prev.name.trim() || !isNameUserMade;
      const newName = shouldAutoName ? generateAgentName(templateId) : prev.name;
      // Auto-select the preferred model for this template
      const model = preferredModelId || prev.model;
      return {
        ...prev,
        name: newName,
        model,
        useTemplate: templateId,
        systemPrompt: template?.prompt || prev.systemPrompt,
        capabilities: recommendedTools // Auto-select tools based on template
      };
    });
  };

  // Handle name input change - mark as user-made when user types
  const handleNameChange = (e) => {
    const value = e.target.value;
    setFormData(prev => ({ ...prev, name: value }));
    // Mark as user-made if user types something, reset if cleared
    setIsNameUserMade(value.trim().length > 0);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center">
            <div className={`w-10 h-10 ${isCloneMode ? 'bg-blue-600' : 'bg-loxia-600'} rounded-lg flex items-center justify-center`}>
              {isCloneMode ? (
                <DocumentDuplicateIcon className="w-6 h-6 text-white" />
              ) : (
                <SparklesIcon className="w-6 h-6 text-white" />
              )}
            </div>
            <div className="ml-3">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                {isCloneMode ? 'Clone Pilot' : 'Create New Pilot'}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {isCloneMode
                  ? `Configure clone of "${sourceAgent.name}"`
                  : 'Set up your AI pilot with custom capabilities'
                }
              </p>
            </div>
          </div>
          
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg"
            disabled={loading}
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Pilot Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Pilot Name
            </label>
            <input
              ref={agentNameInputRef}
              type="text"
              value={formData.name}
              onChange={handleNameChange}
              className={`input-primary ${errors.name ? 'border-red-300 focus:ring-red-500 focus:border-red-500' : ''}`}
              placeholder="e.g., My Coding Pilot"
              disabled={loading}
            />
            {errors.name && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.name}</p>
            )}
          </div>

          {/* Keep Conversation - Only shown in clone mode */}
          {isCloneMode && (
            <div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="keepConversation"
                  checked={keepConversation}
                  onChange={(e) => setKeepConversation(e.target.checked)}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
                  disabled={loading}
                />
                <div>
                  <label htmlFor="keepConversation" className="text-sm font-medium text-gray-900 dark:text-gray-100 cursor-pointer">
                    Keep Conversation History
                  </label>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Copy all messages from the original pilot
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Dynamic Model Routing - Above Model Selection */}
          <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="dynamicRouting"
                checked={formData.dynamicModelRouting}
                onChange={(e) => setFormData(prev => ({ ...prev, dynamicModelRouting: e.target.checked }))}
                className="h-4 w-4 text-loxia-600 focus:ring-loxia-500 border-gray-300 rounded disabled:opacity-50"
                disabled={loading}
              />
              <div>
                <label htmlFor="dynamicRouting" className="text-sm font-medium text-gray-900 dark:text-gray-100 cursor-pointer">
                  Dynamic Model Routing
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Auto-select best model per message
                </p>
              </div>
            </div>
            {formData.dynamicModelRouting && (
              <span className="px-2 py-0.5 text-xs font-medium rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                AUTO
              </span>
            )}
          </div>

          {/* Routing Strategy — visible when dynamic routing is ON */}
          {formData.dynamicModelRouting && (
            <div className="mt-3 transition-all duration-200">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Routing Strategy
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                Custom instructions that guide model selection for this agent
              </p>
              <textarea
                value={formData.routingStrategy}
                onChange={(e) => setFormData(prev => ({ ...prev, routingStrategy: e.target.value }))}
                rows={4}
                maxLength={2000}
                disabled={loading}
                placeholder={"e.g. Prefer fast models for short questions.\nUse Claude for complex code generation.\nUse DeepSeek for mathematical reasoning.\nMinimize model switches unless task type clearly changes."}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-loxia-500 focus:border-transparent text-sm font-mono resize-none"
              />
              <div className="text-right text-xs text-gray-400 mt-1">
                {formData.routingStrategy.length} / 2000
              </div>
            </div>
          )}

          {/* Model Selection - Compact & Collapsible */}
          <div>
            <button
              type="button"
              onClick={() => setModelsExpanded(!modelsExpanded)}
              className="w-full flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
            >
              <div className="flex items-center">
                <CpuChipIcon className="w-5 h-5 text-gray-500 dark:text-gray-400 mr-2" />
                <div className="text-left">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    AI Model
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {(() => {
                      const allModels = Object.values(modelCategories).flatMap(c => c.models);
                      const selected = allModels.find(m => m.id === formData.model);
                      if (!selected) return 'Select a model';
                      return (selected.displayName || selected.name)
                        .replace('Loxia ', '')
                        .replace('Direct ', '')
                        .replace(' (Platform)', '')
                        .replace(' (Direct)', '');
                    })()}
                  </div>
                </div>
              </div>
              {modelsExpanded ? (
                <ChevronUpIcon className="w-5 h-5 text-gray-400" />
              ) : (
                <ChevronDownIcon className="w-5 h-5 text-gray-400" />
              )}
            </button>

            {modelsExpanded && (
              <div className="mt-3 space-y-4">
                {modelsLoading && (
                  <div className="flex items-center justify-center py-4">
                    <LoadingSpinner size="sm" />
                    <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">
                      Loading models...
                    </span>
                  </div>
                )}

                {modelsError && (
                  <div className="p-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                    <div className="flex items-center text-xs">
                      <ExclamationTriangleIcon className="w-4 h-4 text-yellow-600 dark:text-yellow-400 mr-2 flex-shrink-0" />
                      <span className="text-yellow-800 dark:text-yellow-200">
                        Using fallback models. Some may not be available.
                      </span>
                    </div>
                  </div>
                )}

                {Object.entries(modelCategories).map(([categoryKey, category]) => (
                  <div key={categoryKey}>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                        {category.title.replace(' (Platform)', '').replace(' (Direct)', '')}
                      </h3>
                      <span className={`px-1.5 py-0.5 text-xs font-medium rounded ${
                        categoryKey === 'platform'
                          ? 'bg-loxia-100 text-loxia-700 dark:bg-loxia-900/30 dark:text-loxia-300'
                          : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                      }`}>
                        {category.badge}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 items-stretch">
                      {category.models.map((model) => {
                        const isDisabled = model.requiresKey && !model.available;
                        const isSelected = formData.model === model.id;
                        // Clean up display name - remove redundant prefixes and suffixes
                        const displayName = (model.displayName || model.name)
                          .replace('Loxia ', '')
                          .replace('Direct ', '')
                          .replace(' (Platform)', '')
                          .replace(' (Direct)', '');

                        return (
                          <label
                            key={model.id}
                            className={`relative cursor-pointer ${isDisabled ? 'cursor-not-allowed' : ''}`}
                            tabIndex={loading || isDisabled ? -1 : 0}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                if (!loading && !isDisabled) {
                                  setFormData(prev => ({ ...prev, model: model.id }));
                                }
                              }
                            }}
                          >
                            <input
                              type="radio"
                              value={model.id}
                              checked={isSelected}
                              onChange={(e) => setFormData(prev => ({ ...prev, model: e.target.value }))}
                              className="sr-only"
                              disabled={loading || isDisabled}
                            />
                            <div className={`h-full p-2 rounded-lg border text-center transition-all flex flex-col justify-center ${
                              isSelected
                                ? 'border-loxia-500 bg-loxia-50 dark:bg-loxia-900/20 ring-1 ring-loxia-500'
                                : isDisabled
                                ? 'border-gray-200 dark:border-gray-700 opacity-40'
                                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800'
                            }`}>
                              <div className="flex items-center justify-center gap-1">
                                <span className={`text-sm font-medium ${isSelected ? 'text-loxia-700 dark:text-loxia-300' : 'text-gray-900 dark:text-gray-100'}`}>
                                  {displayName}
                                </span>
                                {model.features?.supportsVision && (
                                  <span className="px-1 py-0.5 text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 rounded">
                                    👁
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 min-h-[14px]">
                                {isDisabled ? (
                                  <span className="text-red-500 dark:text-red-400">Key required</span>
                                ) : model.pricing ? (
                                  <span>${model.pricing.input}/${model.pricing.output}</span>
                                ) : (
                                  <span>&nbsp;</span>
                                )}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Template Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Pilot Template
            </label>
            <div className="space-y-2">
              {templates.map((template) => (
                <label key={template.id} className="relative">
                  <input
                    type="radio"
                    value={template.id}
                    checked={formData.useTemplate === template.id}
                    onChange={(e) => handleTemplateChange(e.target.value)}
                    className="sr-only"
                    disabled={loading}
                  />
                  <div className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                    formData.useTemplate === template.id
                      ? 'border-loxia-500 bg-loxia-50 dark:bg-loxia-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}>
                    <div className="flex items-center">
                      <CpuChipIcon className="w-5 h-5 text-gray-400 mr-3" />
                      <div className="flex-1">
                        <div className="font-medium text-gray-900 dark:text-gray-100">
                          {template.name}
                        </div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          {template.description}
                        </div>
                      </div>
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Custom System Prompt - Only shown for Custom template */}
          {formData.useTemplate === AGENT_TEMPLATES.CUSTOM && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                System Prompt
              </label>
              <textarea
                value={formData.systemPrompt}
                onChange={(e) => setFormData(prev => ({ ...prev, systemPrompt: e.target.value }))}
                rows={4}
                className={`input-primary ${errors.systemPrompt ? 'border-red-300 focus:ring-red-500 focus:border-red-500' : ''}`}
                placeholder="Define your pilot's personality, capabilities, and behavior..."
                disabled={loading}
              />
              {errors.systemPrompt && (
                <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.systemPrompt}</p>
              )}
            </div>
          )}

          {/* Tools & Skills — Compact Searchable Panels */}
          {(() => {
            const [toolSearch, setToolSearch] = React.useState('');
            const [skillSearch, setSkillSearch] = React.useState('');
            const [expandedGroup, setExpandedGroup] = React.useState(null);

            const filteredToolGroups = toolGroups.map(g => ({
              ...g,
              tools: g.tools.filter(t =>
                !toolSearch.trim() ||
                t.name.toLowerCase().includes(toolSearch.toLowerCase()) ||
                t.id.toLowerCase().includes(toolSearch.toLowerCase()) ||
                t.description?.toLowerCase().includes(toolSearch.toLowerCase())
              )
            })).filter(g => g.tools.length > 0);

            const filteredSkills = availableSkills.filter(s =>
              !skillSearch.trim() ||
              s.name.toLowerCase().includes(skillSearch.toLowerCase()) ||
              s.description?.toLowerCase().includes(skillSearch.toLowerCase())
            );

            return (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Tools Panel */}
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 overflow-hidden flex flex-col" style={{ maxHeight: '320px' }}>
                  {/* Header */}
                  <div className="px-3 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex-shrink-0">
                    <div className="flex items-center justify-between mb-1.5">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Tools</h3>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-medium text-loxia-600 dark:text-loxia-400 bg-loxia-50 dark:bg-loxia-900/20 px-1.5 py-0.5 rounded-full">
                          {formData.capabilities.length}/{availableCapabilities.length}
                        </span>
                        <button
                          type="button"
                          // "All" excludes opt-in-only tools (platformcontrol etc.) —
                          // those grant cross-cutting platform power and must be added
                          // deliberately, not bulk-checked.
                          onClick={() => setFormData(prev => ({
                            ...prev,
                            capabilities: withoutOptInOnly(availableCapabilities.map(c => c.id)),
                          }))}
                          className="text-[10px] text-loxia-600 dark:text-loxia-400 hover:underline" disabled={loading}>All</button>
                        <button type="button" onClick={() => setFormData(prev => ({ ...prev, capabilities: [] }))}
                          className="text-[10px] text-gray-400 hover:underline" disabled={loading}>None</button>
                      </div>
                    </div>
                    <input
                      type="text"
                      placeholder="Search tools..."
                      value={toolSearch}
                      onChange={e => setToolSearch(e.target.value)}
                      className="w-full px-2.5 py-1 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-loxia-500"
                    />
                  </div>
                  {/* Scrollable list */}
                  <div className="flex-1 overflow-y-auto px-2 py-1.5">
                    {loadingTools && (
                      <p className="text-xs text-gray-400 text-center py-4">Loading tools…</p>
                    )}
                    {toolsError && !loadingTools && (
                      <p className="text-xs text-red-500 text-center py-4">Failed to load tools: {toolsError}</p>
                    )}
                    {!loadingTools && !toolsError && filteredToolGroups.map((group) => (
                      <div key={group.name} className="mb-1">
                        <button
                          type="button"
                          onClick={() => setExpandedGroup(expandedGroup === group.name ? null : group.name)}
                          className="w-full flex items-center justify-between px-1.5 py-1 text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider hover:text-gray-700 dark:hover:text-gray-200"
                        >
                          <span>{group.name}</span>
                          <span className="text-[9px] font-normal normal-case">
                            {group.tools.filter(t => formData.capabilities.includes(t.id)).length}/{group.tools.length}
                          </span>
                        </button>
                        {(expandedGroup === group.name || expandedGroup === null || toolSearch.trim()) && (
                          <div className="space-y-0.5">
                            {group.tools.map((tool) => {
                              const isSelected = formData.capabilities.includes(tool.id);
                              return (
                                <label
                                  key={tool.id}
                                  className={`flex items-center gap-2 px-2 py-1 rounded-lg cursor-pointer transition-all text-xs ${
                                    isSelected
                                      ? 'bg-loxia-100/70 dark:bg-loxia-900/20 text-loxia-700 dark:text-loxia-300'
                                      : 'hover:bg-white dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400'
                                  }`}
                                  title={tool.description}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={(e) => setFormData(prev => ({
                                      ...prev,
                                      capabilities: e.target.checked
                                        ? [...prev.capabilities, tool.id]
                                        : prev.capabilities.filter(id => id !== tool.id)
                                    }))}
                                    className="h-3 w-3 text-loxia-600 focus:ring-loxia-500 border-gray-300 rounded"
                                    disabled={loading}
                                  />
                                  <ToolIcon
                                    iconName={tool.iconName}
                                    toolId={tool.id}
                                    className={`w-3.5 h-3.5 flex-shrink-0 ${
                                      isSelected ? 'text-loxia-600 dark:text-loxia-400' : 'text-gray-400 dark:text-gray-500'
                                    }`}
                                  />
                                  <span className="flex-1 truncate">{tool.name}</span>
                                  {isSelected && hasConfigurator(tool.id) && (
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
                                      className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                                      title={`Configure ${tool.name}`}
                                      aria-label={`Configure ${tool.name}`}
                                    >
                                      <Cog6ToothIcon className="w-3.5 h-3.5" />
                                    </span>
                                  )}
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                    {!loadingTools && !toolsError && filteredToolGroups.length === 0 && (
                      <p className="text-xs text-gray-400 text-center py-4">No tools match "{toolSearch}"</p>
                    )}
                  </div>
                </div>

                {/* Skills Panel */}
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 overflow-hidden flex flex-col" style={{ maxHeight: '320px' }}>
                  {/* Header */}
                  <div className="px-3 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex-shrink-0">
                    <div className="flex items-center justify-between mb-1.5">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Skills</h3>
                      <span className="text-[10px] font-medium text-loxia-600 dark:text-loxia-400 bg-loxia-50 dark:bg-loxia-900/20 px-1.5 py-0.5 rounded-full">
                        {formData.skills.length} assigned
                      </span>
                    </div>
                    {availableSkills.length > 3 && (
                      <input
                        type="text"
                        placeholder="Search skills..."
                        value={skillSearch}
                        onChange={e => setSkillSearch(e.target.value)}
                        className="w-full px-2.5 py-1 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-loxia-500"
                      />
                    )}
                  </div>
                  {/* Scrollable list */}
                  <div className="flex-1 overflow-y-auto px-2 py-1.5">
                    {availableSkills.length === 0 ? (
                      <div className="text-center py-6">
                        <p className="text-xs text-gray-400">No skills in library</p>
                        <p className="text-[10px] text-gray-400 mt-1">Create skills in the Skills page</p>
                      </div>
                    ) : filteredSkills.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-4">No skills match "{skillSearch}"</p>
                    ) : (
                      <div className="space-y-0.5">
                        {filteredSkills.map(skill => {
                          const isSelected = formData.skills.includes(skill.name);
                          return (
                            <label
                              key={skill.name}
                              className={`flex items-start gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-all ${
                                isSelected
                                  ? 'bg-loxia-100/70 dark:bg-loxia-900/20'
                                  : 'hover:bg-white dark:hover:bg-gray-800'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => setFormData(prev => ({
                                  ...prev,
                                  skills: e.target.checked
                                    ? [...prev.skills, skill.name]
                                    : prev.skills.filter(s => s !== skill.name)
                                }))}
                                className="h-3 w-3 mt-0.5 text-loxia-600 focus:ring-loxia-500 border-gray-300 rounded"
                                disabled={loading}
                              />
                              <div className="flex-1 min-w-0">
                                <span className={`text-xs ${isSelected ? 'text-loxia-700 dark:text-loxia-300 font-medium' : 'text-gray-600 dark:text-gray-400'}`}>
                                  {skill.name}
                                </span>
                                {skill.description && (
                                  <p className="text-[10px] text-gray-400 truncate mt-0.5">{skill.description}</p>
                                )}
                              </div>
                              {skill.lineCount > 0 && (
                                <span className="text-[9px] text-gray-400 flex-shrink-0 mt-0.5">{skill.lineCount}L</span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Directory Access Configuration */}
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center">
                <span>Directory Access</span>
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
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
                placeholder="e.g., ~/projects/my-app or /home/user/workspace"
                disabled={loading}
                allowBrowseHelper={true}
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Supports relative paths (e.g., ./my-project, ../parent-folder) or absolute paths. Leave empty to use system directory. Project directory is automatically added to write-enabled directories.
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
              description="Directories the agent can read files from but cannot modify. Supports relative or absolute paths."
              placeholder="e.g., ~/shared-docs or /usr/local/lib"
              disabled={loading}
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
              description="Directories the agent can read from and write to. Supports relative or absolute paths."
              placeholder="e.g., ~/projects or /var/www/html"
              disabled={loading}
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
                  disabled={loading}
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
                  disabled={loading}
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

          {/* Actions */}
          <div className="flex items-center justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="button-secondary"
              disabled={loading}
            >
              Cancel
            </button>
            
            <button
              type="submit"
              className="button-primary"
              disabled={loading}
            >
              {loading ? (
                <>
                  <LoadingSpinner size="sm" className="mr-2" />
                  {isCloneMode ? 'Cloning...' : 'Creating...'}
                </>
              ) : (
                <>
                  {isCloneMode ? (
                    <DocumentDuplicateIcon className="w-5 h-5 mr-2" />
                  ) : (
                    <SparklesIcon className="w-5 h-5 mr-2" />
                  )}
                  {isCloneMode ? 'Clone Pilot' : 'Create Pilot'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Per-tool configuration modal. Opened by the ⚙ next to each
          enabled tool in the tools panel. Writes back to formData.toolConfig. */}
      {configuringTool && (
        <ToolConfigModal
          tool={configuringTool}
          value={(formData.toolConfig && formData.toolConfig[configuringTool.id]) || null}
          onClose={() => setConfiguringTool(null)}
          onSave={(newValue) => {
            setFormData(prev => {
              const next = { ...(prev.toolConfig || {}) };
              if (newValue === null) {
                delete next[configuringTool.id];
              } else {
                next[configuringTool.id] = newValue;
              }
              return { ...prev, toolConfig: next };
            });
          }}
        />
      )}
    </div>
  );
}

export default AgentCreationModal;