import React, { useState, useEffect } from 'react';
import {
  Cog6ToothIcon,
  MoonIcon,
  SunIcon,
  TrashIcon,
  KeyIcon,
  EyeIcon,
  EyeSlashIcon,
  CheckCircleIcon,
  XCircleIcon,
  ChartBarIcon,
  ShieldCheckIcon,
  ChatBubbleLeftRightIcon,
  ArrowPathIcon,
  BoltIcon,
  GlobeAltIcon,
  PlusIcon,
  PencilIcon,
  ShieldExclamationIcon,
  CpuChipIcon,
  PaperAirplaneIcon,
  SparklesIcon
} from '@heroicons/react/24/outline';
import { useAppStore } from '../stores/appStore.js';
import { useModelsStore } from '../stores/modelsStore.js';
import { api } from '../services/api.js';
import { THEMES } from '../utilities/constants.js';
import { useConsent, CONSENT_LEVELS } from '../hooks/useConsent.js';
import { upgradeConsent } from '../utils/clarity.js';
import { QRCodeSVG } from 'qrcode.react';
import LoadingSpinner from './LoadingSpinner.jsx';
import toast from 'react-hot-toast';
import { isPlaceholderApiKey, sanitizeApiKeysObject } from '../utils/apiKeyPlaceholders.js';

// Version status component styles
const VERSION_STATUS = {
  UP_TO_DATE: {
    bgColor: 'bg-green-50 dark:bg-green-900/20',
    borderColor: 'border-green-200 dark:border-green-800',
    textColor: 'text-green-700 dark:text-green-300',
    dotColor: 'bg-green-500',
    label: 'Up to date'
  },
  UPDATE_AVAILABLE: {
    bgColor: 'bg-amber-50 dark:bg-amber-900/20',
    borderColor: 'border-amber-200 dark:border-amber-800',
    textColor: 'text-amber-700 dark:text-amber-300',
    dotColor: 'bg-amber-500',
    label: 'Update available'
  },
  CHECKING: {
    bgColor: 'bg-gray-50 dark:bg-gray-800',
    borderColor: 'border-gray-200 dark:border-gray-700',
    textColor: 'text-gray-600 dark:text-gray-400',
    dotColor: 'bg-gray-400',
    label: 'Checking for updates...'
  },
  ERROR: {
    bgColor: 'bg-gray-50 dark:bg-gray-800',
    borderColor: 'border-gray-200 dark:border-gray-700',
    textColor: 'text-gray-500 dark:text-gray-500',
    dotColor: 'bg-gray-400',
    label: 'Unable to check for updates'
  }
};

function Settings() {
  const {
    darkMode,
    theme: storeTheme,
    setDarkMode,
    setTheme,
    streamingEnabled,
    setStreamingEnabled,
    notifications,
    updateSettings,
    sessionId,
    versionInfo,
    checkForUpdates,
    agents
  } = useAppStore();

  // Consent management
  const {
    consentLevel,
    hasConsented,
    consentTimestamp,
    updateConsent
  } = useConsent();

  const [settings, setSettings] = useState({
    theme: storeTheme || (darkMode ? THEMES.DARK : THEMES.LIGHT),
    apiKeys: {
      openai:    '',
      anthropic: '',
      gemini:    '',
      xai:       '',
    },
  });

  const [showApiKeys, setShowApiKeys] = useState({});
  const [apiKeyStatuses, setApiKeyStatuses] = useState({});
  const [apiKeySaveStatus, setApiKeySaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const [apiKeysChanged, setApiKeysChanged] = useState(false);
  const [lastEditedApiKey, setLastEditedApiKey] = useState(null); // Track which field was edited
  const saveTimeoutRef = React.useRef(null);
  const savedIndicatorTimeoutRef = React.useRef(null);

  // Website credentials state
  const [savedCredentials, setSavedCredentials] = useState([]);
  const [knownSites, setKnownSites] = useState([]);
  const [credentialsLoading, setCredentialsLoading] = useState(false);
  const [showCredentialForm, setShowCredentialForm] = useState(false);
  const [editingCredential, setEditingCredential] = useState(null);
  const [credentialForm, setCredentialForm] = useState({
    siteId: '',
    username: '',
    password: '',
    loginUrl: ''
  });
  const [showCredentialPassword, setShowCredentialPassword] = useState(false);
  const [credentialSaving, setCredentialSaving] = useState(false);

  // Telegram bot state
  const [tgStatus, setTgStatus] = useState({ status: 'disconnected', connected: false });
  const [tgLoading, setTgLoading] = useState(false);
  const [tgToken, setTgToken] = useState('');
  const [tgShowToken, setTgShowToken] = useState(false);

  // Discord bot state
  const [dcStatus, setDcStatus] = useState({ status: 'disconnected', connected: false });
  const [dcLoading, setDcLoading] = useState(false);
  const [dcToken, setDcToken] = useState('');
  const [dcShowToken, setDcShowToken] = useState(false);
  const [dcChannels, setDcChannels] = useState([]);
  const [dcMappings, setDcMappings] = useState({});
  const [dcKnownChannels, setDcKnownChannels] = useState({});
  const [dcKnownGuilds, setDcKnownGuilds] = useState({});
  const [dcChannelsLoading, setDcChannelsLoading] = useState(false);
  const [dcAddAgentDropdown, setDcAddAgentDropdown] = useState(null); // channelKey or null

  // Ollama state
  const { ollamaModels, ollamaAvailable, fetchOllamaModels } = useModelsStore();
  const [ollamaHost, setOllamaHost] = useState('http://localhost:11434');
  const [ollamaEnabled, setOllamaEnabled] = useState(true);
  const [ollamaLoading, setOllamaLoading] = useState(false);
  const [ollamaPullName, setOllamaPullName] = useState('');
  const [ollamaPulling, setOllamaPulling] = useState(false);
  const [ollamaPullProgress, setOllamaPullProgress] = useState('');
  const [ollamaPullPercent, setOllamaPullPercent] = useState(null);

  // Load Ollama settings from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('loxia-ollama-settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.host) setOllamaHost(parsed.host);
        if (parsed.enabled !== undefined) setOllamaEnabled(parsed.enabled);
      } catch (e) { /* ignore */ }
    }
  }, []);

  const handleOllamaRefresh = async () => {
    setOllamaLoading(true);
    try {
      await fetchOllamaModels();
      toast.success('Ollama models refreshed');
    } catch {
      toast.error('Failed to connect to Ollama');
    } finally {
      setOllamaLoading(false);
    }
  };

  const handleOllamaSaveSettings = async () => {
    try {
      await api.updateOllamaSettings({ host: ollamaHost, enabled: ollamaEnabled });
      localStorage.setItem('loxia-ollama-settings', JSON.stringify({ host: ollamaHost, enabled: ollamaEnabled }));
      toast.success('Ollama settings saved');
      if (ollamaEnabled) {
        await fetchOllamaModels();
      }
      // Tell the rest of the app the provider picture may have changed
      // — useAttentionRequired listens on this channel and will re-
      // evaluate whether Ollama still satisfies the provider check.
      window.dispatchEvent(new CustomEvent('apikey-updated'));
      window.dispatchEvent(new CustomEvent('settings-updated'));
    } catch {
      toast.error('Failed to save Ollama settings');
    }
  };

  // Listen for Ollama pull progress via WebSocket → DOM events
  useEffect(() => {
    const handlePullEvent = (e) => {
      const { type, model, status, percent, error, success } = e.detail;
      if (type === 'ollama_pull_progress') {
        setOllamaPullProgress(status || 'Pulling...');
        setOllamaPullPercent(percent != null ? percent : null);
      } else if (type === 'ollama_pull_complete') {
        setOllamaPulling(false);
        setOllamaPullProgress('');
        setOllamaPullPercent(null);
        setOllamaPullName('');
        fetchOllamaModels();
        toast.success(`Model ${model} pulled successfully`);
      } else if (type === 'ollama_pull_error') {
        setOllamaPulling(false);
        setOllamaPullProgress('');
        setOllamaPullPercent(null);
        toast.error(`Pull failed: ${error || 'Unknown error'}`);
      }
    };
    window.addEventListener('ollama-pull', handlePullEvent);
    return () => window.removeEventListener('ollama-pull', handlePullEvent);
  }, [fetchOllamaModels]);

  const handleOllamaPull = async () => {
    if (!ollamaPullName.trim()) return;
    setOllamaPulling(true);
    setOllamaPullProgress('Starting pull...');
    try {
      await api.pullOllamaModel(ollamaPullName.trim(), sessionId);
      // Response is immediate — actual progress comes via WebSocket events above
    } catch (err) {
      setOllamaPulling(false);
      setOllamaPullProgress('');
      toast.error(`Failed to pull model: ${err.message}`);
    }
  };

  const handleOllamaDelete = async (modelName) => {
    if (!confirm(`Delete model "${modelName}"? This cannot be undone.`)) return;
    try {
      await api.deleteOllamaModel(modelName);
      await fetchOllamaModels();
      toast.success(`Model ${modelName} deleted`);
    } catch (err) {
      toast.error(`Failed to delete model: ${err.message}`);
    }
  };

  // Load settings from localStorage. Sanitize API keys on the way in so
  // any placeholder strings persisted by older builds get replaced with
  // empty strings — they were never real keys.
  const loadSettingsFromStorage = () => {
    const savedSettings = localStorage.getItem('loxia-settings');
    if (savedSettings) {
      try {
        const parsedSettings = JSON.parse(savedSettings);
        if (parsedSettings.apiKeys) {
          parsedSettings.apiKeys = sanitizeApiKeysObject(parsedSettings.apiKeys);
        }
        setSettings(prev => ({
          ...prev,
          ...parsedSettings,
          theme: storeTheme || (darkMode ? THEMES.DARK : THEMES.LIGHT)
        }));
      } catch (error) {
        console.error('Failed to parse saved settings:', error);
      }
    }
  };

  // Load on mount and when darkMode/sessionId changes
  useEffect(() => {
    loadSettingsFromStorage();
    loadApiKeyStatus();
  }, [storeTheme, darkMode, sessionId]);

  // Auto-save API keys with debounce
  useEffect(() => {
    if (!apiKeysChanged) return;

    // Clear any existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Debounce save by 1 second
    saveTimeoutRef.current = setTimeout(async () => {
      setApiKeySaveStatus('saving');
      try {
        await updateSettings(settings);
        setApiKeySaveStatus('saved');
        setApiKeysChanged(false);

        // Clear "saved" indicator after 2 seconds
        if (savedIndicatorTimeoutRef.current) {
          clearTimeout(savedIndicatorTimeoutRef.current);
        }
        savedIndicatorTimeoutRef.current = setTimeout(() => {
          setApiKeySaveStatus('idle');
        }, 2000);
      } catch (error) {
        console.error('Failed to auto-save API keys:', error);
        setApiKeySaveStatus('error');
      }
    }, 1000);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [settings.apiKeys, apiKeysChanged, updateSettings]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (savedIndicatorTimeoutRef.current) clearTimeout(savedIndicatorTimeoutRef.current);
    };
  }, []);

  // Listen for settings updates from other components (e.g., AttentionRequiredModal)
  useEffect(() => {
    const handleSettingsUpdate = () => {
      loadSettingsFromStorage();
      loadApiKeyStatus();
    };

    window.addEventListener('settings-updated', handleSettingsUpdate);
    window.addEventListener('apikey-updated', handleSettingsUpdate);

    return () => {
      window.removeEventListener('settings-updated', handleSettingsUpdate);
      window.removeEventListener('apikey-updated', handleSettingsUpdate);
    };
  }, [darkMode]);

  const loadApiKeyStatus = async () => {
    if (!sessionId) return;

    try {
      const response = await api.getApiKeyStatus(sessionId);
      if (response.success) {
        const statuses = {};
        for (const vendor of (response.vendorKeys || [])) {
          statuses[vendor] = 'valid';
        }
        setApiKeyStatuses(statuses);
      }
    } catch (error) {
      console.error('Failed to load API key status:', error);
    }
  };

  // Load website credentials
  const loadCredentials = async () => {
    setCredentialsLoading(true);
    try {
      const response = await api.listStoredCredentials();
      if (response.success) {
        setSavedCredentials(response.credentials || []);
        setKnownSites(response.knownSites || []);
      }
    } catch (error) {
      console.error('Failed to load credentials:', error);
    } finally {
      setCredentialsLoading(false);
    }
  };

  // Load credentials on mount
  useEffect(() => {
    loadCredentials();
  }, []);

  // Load Telegram status on mount
  useEffect(() => {
    api.getTelegramStatus().then(res => {
      if (res.success) setTgStatus(res);
    }).catch(() => {});
  }, []);

  const handleTelegramConnect = async () => {
    if (!tgToken.trim()) { toast.error('Enter a bot token'); return; }
    setTgLoading(true);
    try {
      const res = await api.connectTelegram(tgToken.trim());
      if (res.success) {
        toast.success(`Connected as @${res.username}`);
        setTgToken('');
        const status = await api.getTelegramStatus();
        if (status.success) setTgStatus(status);
      } else {
        toast.error(res.error || 'Connection failed');
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setTgLoading(false);
    }
  };

  const handleTelegramDisconnect = async () => {
    setTgLoading(true);
    try {
      await api.disconnectTelegram();
      setTgStatus({ status: 'disconnected', connected: false });
      toast.success('Telegram disconnected');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setTgLoading(false);
    }
  };

  const handleTelegramTest = async () => {
    try {
      await api.testTelegram();
      toast.success('Test message sent');
    } catch (err) {
      toast.error(err.message);
    }
  };

  // --- Discord Handlers ---

  useEffect(() => {
    api.getDiscordStatus().then(res => {
      if (res.success) setDcStatus(res);
    }).catch(() => {});
  }, []);

  const loadDiscordChannels = async () => {
    setDcChannelsLoading(true);
    try {
      const [chRes, mapRes] = await Promise.all([api.getDiscordChannels(), api.getDiscordMappings()]);
      if (chRes.success) setDcChannels(chRes.channels || []);
      if (mapRes.success) {
        setDcMappings(mapRes.mappings || {});
        setDcKnownChannels(mapRes.knownChannels || {});
        setDcKnownGuilds(mapRes.knownGuilds || {});
      }
    } catch {} finally { setDcChannelsLoading(false); }
  };

  useEffect(() => {
    if (dcStatus.connected) loadDiscordChannels();
  }, [dcStatus.connected]);

  const handleDiscordConnect = async () => {
    if (!dcToken.trim()) { toast.error('Enter a bot token'); return; }
    setDcLoading(true);
    try {
      const res = await api.connectDiscord(dcToken.trim());
      if (res.success) {
        toast.success(`Connected as ${res.username}`);
        setDcToken('');
        const status = await api.getDiscordStatus();
        if (status.success) setDcStatus(status);
      } else {
        toast.error(res.error || 'Connection failed');
      }
    } catch (err) { toast.error(err.message); }
    finally { setDcLoading(false); }
  };

  const handleDiscordDisconnect = async () => {
    setDcLoading(true);
    try {
      await api.disconnectDiscord();
      setDcStatus({ status: 'disconnected', connected: false });
      setDcChannels([]);
      setDcMappings({});
      toast.success('Discord disconnected');
    } catch (err) { toast.error(err.message); }
    finally { setDcLoading(false); }
  };

  const handleDiscordAssign = async (channelKey, agentId) => {
    try {
      const res = await api.assignDiscordAgent(channelKey, agentId);
      if (res.success) {
        setDcMappings(res.mappings || {});
        toast.success('Agent assigned');
      }
    } catch (err) { toast.error(err.message); }
    setDcAddAgentDropdown(null);
  };

  const handleDiscordUnassign = async (channelKey, agentId) => {
    try {
      const res = await api.unassignDiscordAgent(channelKey, agentId);
      if (res.success) {
        setDcMappings(res.mappings || {});
        toast.success('Agent removed');
      }
    } catch (err) { toast.error(err.message); }
  };

  // Handle save credential
  const handleSaveCredential = async () => {
    if (!credentialForm.siteId || !credentialForm.username || !credentialForm.password) {
      toast.error('Please fill in all required fields');
      return;
    }

    setCredentialSaving(true);
    try {
      const response = await api.saveCredentials(credentialForm.siteId, {
        username: credentialForm.username,
        password: credentialForm.password,
        loginUrl: credentialForm.loginUrl || undefined
      });

      if (response.success) {
        toast.success(editingCredential ? 'Credentials updated' : 'Credentials saved');
        setShowCredentialForm(false);
        setEditingCredential(null);
        setCredentialForm({ siteId: '', username: '', password: '', loginUrl: '' });
        setShowCredentialPassword(false);
        loadCredentials();
      } else {
        toast.error(response.error || 'Failed to save credentials');
      }
    } catch (error) {
      toast.error('Failed to save credentials: ' + error.message);
    } finally {
      setCredentialSaving(false);
    }
  };

  // Handle delete credential
  const handleDeleteCredential = async (siteId) => {
    if (!window.confirm(`Are you sure you want to delete credentials for ${siteId}?`)) {
      return;
    }

    try {
      const response = await api.deleteCredentials(siteId);
      if (response.success) {
        toast.success('Credentials deleted');
        loadCredentials();
      } else {
        toast.error(response.error || 'Failed to delete credentials');
      }
    } catch (error) {
      toast.error('Failed to delete credentials: ' + error.message);
    }
  };

  // Handle edit credential
  const handleEditCredential = (credential) => {
    setEditingCredential(credential);
    setCredentialForm({
      siteId: credential.siteId,
      username: credential.username || '',
      password: '', // Don't pre-fill password for security
      loginUrl: credential.loginUrl || ''
    });
    setShowCredentialForm(true);
  };

  // Handle add new credential
  const handleAddCredential = () => {
    setEditingCredential(null);
    setCredentialForm({ siteId: '', username: '', password: '', loginUrl: '' });
    setShowCredentialForm(true);
  };

  // Cancel credential form
  const handleCancelCredentialForm = () => {
    setShowCredentialForm(false);
    setEditingCredential(null);
    setCredentialForm({ siteId: '', username: '', password: '', loginUrl: '' });
    setShowCredentialPassword(false);
  };

  const handleThemeChange = (theme) => {
    setSettings(prev => ({ ...prev, theme }));
    setTheme(theme);
  };

  const handleApiKeyChange = (provider, value) => {
    setSettings(prev => ({
      ...prev,
      apiKeys: {
        ...prev.apiKeys,
        [provider]: value
      }
    }));
    // Clear status when key changes
    setApiKeyStatuses(prev => ({
      ...prev,
      [provider]: null
    }));
    // Mark as changed to trigger auto-save
    setApiKeysChanged(true);
    setApiKeySaveStatus('idle');
    setLastEditedApiKey(provider);
  };

  // Render save status indicator inline with label
  const renderSaveIndicator = (fieldKey) => {
    if (lastEditedApiKey !== fieldKey || apiKeySaveStatus === 'idle') return null;

    return (
      <span className="inline-flex items-center space-x-1 ml-2 text-xs font-medium">
        {apiKeySaveStatus === 'saving' && (
          <>
            <span className="w-2.5 h-2.5 border-[1.5px] border-gray-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-gray-400">saving</span>
          </>
        )}
        {apiKeySaveStatus === 'saved' && (
          <>
            <CheckCircleIcon className="w-3.5 h-3.5 text-green-500" />
            <span className="text-green-500">saved</span>
          </>
        )}
        {apiKeySaveStatus === 'error' && (
          <>
            <XCircleIcon className="w-3.5 h-3.5 text-red-500" />
            <span className="text-red-500">failed</span>
          </>
        )}
      </span>
    );
  };

  const toggleApiKeyVisibility = (provider) => {
    setShowApiKeys(prev => ({
      ...prev,
      [provider]: !prev[provider]
    }));
  };

  const themeOptions = [
    { value: THEMES.LIGHT,   label: 'Light',    icon: SunIcon },
    { value: THEMES.DARK,    label: 'Dark',     icon: MoonIcon },
    { value: THEMES.DRACULA, label: 'Dracula',  icon: SparklesIcon },
    { value: THEMES.REDTEAM, label: 'Red Team', icon: ShieldExclamationIcon }
  ];

  // Handle consent level change from settings
  const handleConsentChange = (level) => {
    updateConsent(level);
    upgradeConsent(level);
    toast.success(`Analytics preferences updated to: ${level === CONSENT_LEVELS.NONE ? 'Disabled' : level === CONSENT_LEVELS.BASIC ? 'Basic' : 'Full'}`);
  };

  // Get current version status styling
  const getVersionStatus = () => {
    if (versionInfo.checking) return VERSION_STATUS.CHECKING;
    if (versionInfo.error) return VERSION_STATUS.ERROR;
    if (versionInfo.updateAvailable) return VERSION_STATUS.UPDATE_AVAILABLE;
    if (versionInfo.isUpToDate) return VERSION_STATUS.UP_TO_DATE;
    return VERSION_STATUS.CHECKING; // Default while initial check happens
  };

  const versionStatus = getVersionStatus();

  // Copy update command to clipboard
  const handleCopyUpdateCommand = async () => {
    try {
      await navigator.clipboard.writeText(versionInfo.updateCommand);
      toast.success('Update command copied to clipboard');
    } catch (error) {
      toast.error('Failed to copy command');
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center">
          <div className="w-10 h-10 bg-loxia-600 rounded-lg flex items-center justify-center">
            <Cog6ToothIcon className="w-6 h-6 text-white" />
          </div>
          <div className="ml-3">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              Settings
            </h1>
            <p className="mt-1 text-gray-600 dark:text-gray-400">
              Customize your OnBuzz Community experience
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-8">
        {/* Version Status */}
        <div className={`rounded-lg border p-4 ${versionStatus.bgColor} ${versionStatus.borderColor}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              {/* Status dot */}
              <span className={`w-2.5 h-2.5 rounded-full ${versionStatus.dotColor} ${versionInfo.checking ? 'animate-pulse' : ''}`} />

              {/* Version info */}
              <div>
                <div className="flex items-center space-x-2">
                  <span className={`text-sm font-medium ${versionStatus.textColor}`}>
                    {versionStatus.label}
                  </span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {versionInfo.currentVersion ? `v${versionInfo.currentVersion}` : 'loading...'}
                  </span>
                </div>

                {/* Show latest version if update available */}
                {versionInfo.updateAvailable && versionInfo.latestVersion && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Latest: v{versionInfo.latestVersion}
                  </p>
                )}

                {/* Last checked timestamp */}
                {versionInfo.lastChecked && !versionInfo.checking && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    Checked {new Date(versionInfo.lastChecked).toLocaleTimeString()}
                  </p>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center space-x-2">
              {/* Copy update command button (only when update available) */}
              {versionInfo.updateAvailable && (
                <button
                  onClick={handleCopyUpdateCommand}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-amber-100 hover:bg-amber-200 text-amber-700 dark:bg-amber-900/30 dark:hover:bg-amber-900/50 dark:text-amber-300 transition-colors"
                >
                  Copy update command
                </button>
              )}

              {/* Refresh button */}
              <button
                onClick={checkForUpdates}
                disabled={versionInfo.checking}
                className="p-1.5 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors disabled:opacity-50"
                title="Check for updates"
              >
                <ArrowPathIcon className={`w-4 h-4 ${versionInfo.checking ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Update command display (only when update available) */}
          {versionInfo.updateAvailable && (
            <div className="mt-3 pt-3 border-t border-amber-200 dark:border-amber-800">
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">
                Run this command to update:
              </p>
              <code className="block text-xs bg-gray-900 dark:bg-gray-950 text-green-400 px-3 py-2 rounded font-mono">
                {versionInfo.updateCommand}
              </code>
            </div>
          )}
        </div>

        {/* Provider API Keys */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center">
              <KeyIcon className="w-5 h-5 text-gray-500 mr-2" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Provider API Keys
              </h2>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Bring your own keys. OnBuzz Community talks to providers directly — your keys never leave your machine.
            </p>
          </div>

          <div className="p-6">
            <div className="space-y-4">
              {[
                { key: 'openai',    label: 'OpenAI',           placeholder: 'sk-...',      hint: 'GPT-4o, o3-mini, gpt-4o-mini' },
                { key: 'anthropic', label: 'Anthropic',        placeholder: 'sk-ant-...',  hint: 'Claude Opus / Sonnet / Haiku' },
                { key: 'gemini',    label: 'Google Gemini',    placeholder: 'AIza...',     hint: 'Gemini 2.0 Flash, 1.5 Pro' },
                { key: 'xai',       label: 'xAI',              placeholder: 'xai-...',     hint: 'Grok 4, Grok 2 Vision' },
              ].map(({ key, label, placeholder, hint }) => (
                <div key={key} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center text-sm font-medium text-gray-700 dark:text-gray-300">
                      <span>{label}</span>
                      {renderSaveIndicator(key)}
                    </label>
                    {(apiKeyStatuses[key] === 'invalid' || apiKeyStatuses[key] === 'error') && (
                      <XCircleIcon className="w-4 h-4 text-red-500" />
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type={showApiKeys[key] ? 'text' : 'password'}
                      value={settings.apiKeys[key] || ''}
                      onChange={(e) => handleApiKeyChange(key, e.target.value)}
                      placeholder={placeholder}
                      className="input-primary pr-10"
                      data-clarity-mask="always"
                    />
                    <button
                      type="button"
                      onClick={() => toggleApiKeyVisibility(key)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center"
                    >
                      {showApiKeys[key] ? (
                        <EyeSlashIcon className="w-4 h-4 text-gray-400" />
                      ) : (
                        <EyeIcon className="w-4 h-4 text-gray-400" />
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{hint}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Local Models (Ollama) */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <CpuChipIcon className="w-5 h-5 text-green-600 dark:text-green-400 mr-3" />
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Local Models (Ollama)
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Run models locally for free, offline inference
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  ollamaAvailable
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                    ollamaAvailable ? 'bg-green-500' : 'bg-gray-400'
                  }`} />
                  {ollamaAvailable ? 'Connected' : 'Not Available'}
                </span>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {/* Enable/Disable Toggle */}
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <CpuChipIcon className="w-5 h-5 text-green-500 mr-3" />
                <div>
                  <label className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    Enable Ollama Integration
                  </label>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Use locally running models for agent tasks
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOllamaEnabled(!ollamaEnabled);
                }}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
                  ollamaEnabled ? 'bg-green-600' : 'bg-gray-200 dark:bg-gray-700'
                }`}
                role="switch"
                aria-checked={ollamaEnabled}
              >
                <span
                  aria-hidden="true"
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    ollamaEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {ollamaEnabled && (
              <>
                {/* Host Configuration */}
                <div className="p-4 bg-green-50 dark:bg-green-900/10 rounded-lg border border-green-200 dark:border-green-800/30">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Ollama Host URL
                  </label>
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      value={ollamaHost}
                      onChange={(e) => setOllamaHost(e.target.value)}
                      placeholder="http://localhost:11434"
                      className="input-primary flex-1"
                    />
                    <button
                      onClick={handleOllamaSaveSettings}
                      className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors"
                    >
                      Save
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Default: http://localhost:11434. Change if Ollama runs on a different host/port.
                  </p>
                </div>

                {/* Available Models */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      Available Models ({ollamaModels.length})
                    </h3>
                    <button
                      onClick={handleOllamaRefresh}
                      disabled={ollamaLoading}
                      className="flex items-center px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    >
                      <ArrowPathIcon className={`w-4 h-4 mr-1 ${ollamaLoading ? 'animate-spin' : ''}`} />
                      Refresh
                    </button>
                  </div>

                  {ollamaModels.length === 0 ? (
                    <div className="text-center py-8 bg-gray-50 dark:bg-gray-900/30 rounded-lg border border-dashed border-gray-300 dark:border-gray-600">
                      <CpuChipIcon className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {ollamaAvailable
                          ? 'No models installed. Pull a model below to get started.'
                          : 'Ollama is not running. Start Ollama and click Refresh.'}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {ollamaModels.map((model) => (
                        <div
                          key={model.name}
                          className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900/30 rounded-lg border border-gray-200 dark:border-gray-700"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center space-x-2">
                              <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                                {model.displayName || model.ollamaName || model.name}
                              </span>
                              <span className="px-1.5 py-0.5 text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 rounded">
                                Free
                              </span>
                            </div>
                            <div className="flex items-center space-x-2 mt-0.5">
                              {model.details?.parameterSize && (
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  {model.details.parameterSize}
                                </span>
                              )}
                              {model.contextWindow && (
                                <>
                                  <span className="text-xs text-gray-400">·</span>
                                  <span className="text-xs text-gray-500 dark:text-gray-400">
                                    {Math.round(model.contextWindow / 1000)}K context
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={() => handleOllamaDelete(model.ollamaName || model.name)}
                            className="ml-2 p-1.5 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                            title="Delete model"
                          >
                            <TrashIcon className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Pull New Model */}
                <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                  <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                    Pull New Model
                  </h3>
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      value={ollamaPullName}
                      onChange={(e) => setOllamaPullName(e.target.value)}
                      placeholder="e.g. llama3.1:8b, codellama, mistral"
                      className="input-primary flex-1"
                      disabled={ollamaPulling}
                      onKeyDown={(e) => e.key === 'Enter' && handleOllamaPull()}
                    />
                    <button
                      onClick={handleOllamaPull}
                      disabled={ollamaPulling || !ollamaPullName.trim()}
                      className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center"
                    >
                      {ollamaPulling ? (
                        <>
                          <ArrowPathIcon className="w-4 h-4 mr-1 animate-spin" />
                          Pulling...
                        </>
                      ) : (
                        'Pull'
                      )}
                    </button>
                  </div>
                  {ollamaPullProgress && (
                    <div className="mt-2">
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                        {ollamaPullProgress}{ollamaPullPercent != null ? ` (${ollamaPullPercent}%)` : ''}
                      </p>
                      {ollamaPullPercent != null && (
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                          <div
                            className="bg-green-600 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${ollamaPullPercent}%` }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                    Browse available models at <a href="https://ollama.com/library" target="_blank" rel="noopener noreferrer" className="text-green-600 dark:text-green-400 hover:underline">ollama.com/library</a>
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Website Credentials */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <GlobeAltIcon className="w-5 h-5 text-gray-500 mr-2" />
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Website Credentials
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Manage login credentials for browser automation
                  </p>
                </div>
              </div>
              <button
                onClick={handleAddCredential}
                className="flex items-center px-3 py-1.5 text-sm font-medium text-loxia-600 hover:text-loxia-700 dark:text-loxia-400 dark:hover:text-loxia-300 bg-loxia-50 hover:bg-loxia-100 dark:bg-loxia-900/20 dark:hover:bg-loxia-900/30 rounded-lg transition-colors"
              >
                <PlusIcon className="w-4 h-4 mr-1" />
                Add
              </button>
            </div>
          </div>

          <div className="p-6">
            {/* Security notice */}
            <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <div className="flex items-start space-x-2">
                <ShieldCheckIcon className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-blue-800 dark:text-blue-200">
                  Credentials are encrypted and stored locally. The AI agent never sees your actual passwords -
                  they are used directly by the browser automation system.
                </p>
              </div>
            </div>

            {/* Credential Form */}
            {showCredentialForm && (
              <div className="mb-4 p-4 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg">
                <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">
                  {editingCredential ? 'Edit Credentials' : 'Add New Credentials'}
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Site ID *
                    </label>
                    {editingCredential ? (
                      <input
                        type="text"
                        value={credentialForm.siteId}
                        disabled
                        className="input-primary w-full bg-gray-100 dark:bg-gray-800"
                      />
                    ) : (
                      <select
                        value={credentialForm.siteId}
                        onChange={(e) => setCredentialForm(prev => ({ ...prev, siteId: e.target.value }))}
                        className="input-primary w-full"
                      >
                        <option value="">Select a site or enter custom...</option>
                        {knownSites.map(site => (
                          <option key={site.id} value={site.id}>
                            {site.name} {site.hasCredentials ? '(has credentials)' : ''}
                          </option>
                        ))}
                        <option value="custom">Custom site...</option>
                      </select>
                    )}
                    {credentialForm.siteId === 'custom' && (
                      <input
                        type="text"
                        value=""
                        onChange={(e) => setCredentialForm(prev => ({ ...prev, siteId: e.target.value }))}
                        placeholder="Enter site ID (e.g., mysite)"
                        className="input-primary w-full mt-2"
                      />
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Username / Email *
                    </label>
                    <input
                      type="text"
                      value={credentialForm.username}
                      onChange={(e) => setCredentialForm(prev => ({ ...prev, username: e.target.value }))}
                      placeholder="username@example.com"
                      className="input-primary w-full"
                      data-clarity-mask="always"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Password *
                    </label>
                    <div className="relative">
                      <input
                        type={showCredentialPassword ? 'text' : 'password'}
                        value={credentialForm.password}
                        onChange={(e) => setCredentialForm(prev => ({ ...prev, password: e.target.value }))}
                        placeholder={editingCredential ? 'Enter new password' : 'Enter password'}
                        className="input-primary w-full pr-10"
                        data-clarity-mask="always"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCredentialPassword(!showCredentialPassword)}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center"
                      >
                        {showCredentialPassword ? (
                          <EyeSlashIcon className="w-4 h-4 text-gray-400" />
                        ) : (
                          <EyeIcon className="w-4 h-4 text-gray-400" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Login URL (optional)
                    </label>
                    <input
                      type="url"
                      value={credentialForm.loginUrl}
                      onChange={(e) => setCredentialForm(prev => ({ ...prev, loginUrl: e.target.value }))}
                      placeholder="https://example.com/login"
                      className="input-primary w-full"
                    />
                  </div>
                  <div className="flex justify-end space-x-2 pt-2">
                    <button
                      onClick={handleCancelCredentialForm}
                      className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveCredential}
                      disabled={credentialSaving || !credentialForm.siteId || !credentialForm.username || !credentialForm.password}
                      className="px-3 py-1.5 text-sm font-medium text-white bg-loxia-600 hover:bg-loxia-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                    >
                      {credentialSaving ? (
                        <>
                          <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                          Saving...
                        </>
                      ) : (
                        'Save'
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Credentials List */}
            {credentialsLoading ? (
              <div className="flex justify-center py-8">
                <div className="w-6 h-6 border-2 border-loxia-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : savedCredentials.length === 0 ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                <GlobeAltIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">No saved credentials</p>
                <p className="text-xs mt-1">
                  Add credentials here or they will be saved when an agent requests authentication
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {savedCredentials.map((cred) => (
                  <div
                    key={cred.siteId}
                    className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded-lg flex items-center justify-center">
                        <GlobeAltIcon className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {cred.name || cred.siteId}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {cred.username}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-1">
                      <button
                        onClick={() => handleEditCredential(cred)}
                        className="p-1.5 text-gray-500 hover:text-loxia-600 dark:hover:text-loxia-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                        title="Edit"
                      >
                        <PencilIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteCredential(cred.siteId)}
                        className="p-1.5 text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                        title="Delete"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>


        {/* Telegram Bot */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <PaperAirplaneIcon className="w-5 h-5 text-blue-500 mr-2" />
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  Telegram Bot
                </h2>
              </div>
              <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                tgStatus.connected
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
              }`}>
                {tgStatus.connected ? `@${tgStatus.botUsername || 'connected'}` : tgStatus.status || 'Disconnected'}
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Chat with your agents from your phone via Telegram
            </p>
          </div>
          <div className="p-6 space-y-4">
            {tgStatus.connected ? (
              <>
                <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-900/10 rounded-lg border border-green-200 dark:border-green-800">
                  <div>
                    <p className="text-sm font-medium text-green-800 dark:text-green-300">Connected</p>
                    {tgStatus.chatId && (
                      <p className="text-xs text-green-600 dark:text-green-400">Chat ID: {tgStatus.chatId}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleTelegramTest} className="button-secondary text-xs">
                      Send Test
                    </button>
                    <button onClick={handleTelegramDisconnect} disabled={tgLoading} className="px-3 py-1.5 text-xs font-medium text-red-600 hover:text-red-700 border border-red-300 dark:border-red-700 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                      Disconnect
                    </button>
                  </div>
                </div>
                {!tgStatus.chatId && (
                  <p className="text-sm text-amber-600 dark:text-amber-400">
                    Send <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">/start</code> to the bot from your Telegram app to register your chat.
                  </p>
                )}
              </>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Bot Token</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type={tgShowToken ? 'text' : 'password'}
                        value={tgToken}
                        onChange={e => setTgToken(e.target.value)}
                        placeholder="123456:ABC-DEF..."
                        className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-loxia-500 text-sm font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setTgShowToken(!tgShowToken)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {tgShowToken ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                      </button>
                    </div>
                    <button onClick={handleTelegramConnect} disabled={tgLoading || !tgToken.trim()} className="button-primary text-sm">
                      {tgLoading ? 'Connecting...' : 'Connect'}
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    Create a bot via <span className="font-medium">@BotFather</span> on Telegram to get a token
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Discord Bot Integration */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <svg className="w-5 h-5 mr-2 text-[#5865F2]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                </svg>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Discord Bot</h2>
              </div>
              <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                dcStatus.connected
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
              }`}>
                {dcStatus.connected ? dcStatus.botUsername || 'Connected' : 'Disconnected'}
              </span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Assign agents to Discord channels</p>
          </div>
          <div className="p-6 space-y-4">
            {dcStatus.connected ? (
              <>
                {/* Connected state — info + disconnect */}
                <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-900/10 rounded-lg border border-green-200 dark:border-green-800/30">
                  <div className="text-sm text-green-700 dark:text-green-400">
                    <span className="font-medium">{dcStatus.botUsername}</span>
                    <span className="ml-2 text-green-600 dark:text-green-500">{dcStatus.guildCount} server{dcStatus.guildCount !== 1 ? 's' : ''}</span>
                  </div>
                  <button onClick={handleDiscordDisconnect} disabled={dcLoading} className="text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-medium">
                    {dcLoading ? 'Disconnecting...' : 'Disconnect'}
                  </button>
                </div>

                {/* Channel-Agent Assignment Panel */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Channel Assignments</h3>
                    <button onClick={loadDiscordChannels} disabled={dcChannelsLoading} className="text-xs text-loxia-600 hover:text-loxia-700 dark:text-loxia-400">
                      {dcChannelsLoading ? 'Loading...' : 'Refresh'}
                    </button>
                  </div>

                  {dcChannels.length === 0 ? (
                    <div className="text-center py-6 text-sm text-gray-400">
                      <p>No channels found. Add the bot to a Discord server first.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {/* Group channels + threads by guild, threads nested under parent */}
                      {(() => {
                        // Build guild → channels structure with threads nested
                        const guilds = {};
                        const textChannels = dcChannels.filter(ch => !ch.isThread);
                        const threads = dcChannels.filter(ch => ch.isThread);
                        for (const ch of textChannels) {
                          const guild = ch.guildName || ch.guildId;
                          if (!guilds[guild]) guilds[guild] = [];
                          guilds[guild].push({ ...ch, threads: threads.filter(t => t.parentKey === ch.key) });
                        }
                        // Orphan threads (parent not in list)
                        const parentKeys = new Set(textChannels.map(c => c.key));
                        const orphanThreads = threads.filter(t => !t.parentKey || !parentKeys.has(t.parentKey));
                        for (const t of orphanThreads) {
                          const guild = t.guildName || t.guildId;
                          if (!guilds[guild]) guilds[guild] = [];
                          guilds[guild].push({ ...t, threads: [] });
                        }

                        // Render helper for a single row (channel or thread)
                        const renderRow = (ch, indent = false) => {
                          const assignedAgents = dcMappings[ch.key] || [];
                          return (
                            <div key={ch.key} className={`px-3 py-2 flex items-center gap-2 flex-wrap ${indent ? 'pl-8' : ''}`}>
                              <span className={`text-sm font-medium mr-1 flex-shrink-0 ${ch.isThread ? 'text-gray-400 dark:text-gray-500 italic' : 'text-gray-600 dark:text-gray-300'}`}>
                                {ch.isThread ? '↳ ' : '#'}{ch.name}
                              </span>
                              {assignedAgents.map(agentId => {
                                const agent = agents?.find(a => a.id === agentId);
                                return (
                                  <span key={agentId} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-loxia-100 dark:bg-loxia-900/30 text-loxia-700 dark:text-loxia-400">
                                    {agent?.name || agentId.slice(0, 8)}
                                    <button onClick={() => handleDiscordUnassign(ch.key, agentId)} className="hover:text-red-500 transition-colors" title="Remove">&times;</button>
                                  </span>
                                );
                              })}
                              <div className="relative" ref={el => { if (el) el._dcRef = ch.key; }}>
                                <button
                                  onClick={(e) => {
                                    if (dcAddAgentDropdown === ch.key) {
                                      setDcAddAgentDropdown(null);
                                    } else {
                                      const rect = e.currentTarget.getBoundingClientRect();
                                      setDcAddAgentDropdown({ key: ch.key, top: rect.bottom + 4, left: rect.left });
                                    }
                                  }}
                                  className="inline-flex items-center px-1.5 py-0.5 text-xs rounded-full border border-dashed border-gray-300 dark:border-gray-600 text-gray-400 hover:text-loxia-600 hover:border-loxia-400 dark:hover:text-loxia-400 transition-colors"
                                  title="Add agent"
                                >+</button>
                                {dcAddAgentDropdown?.key === ch.key && (
                                  <>
                                    <div className="fixed inset-0 z-40" onClick={() => setDcAddAgentDropdown(null)} />
                                    <div
                                      className="fixed z-50 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 max-h-48 overflow-y-auto"
                                      style={{ top: dcAddAgentDropdown.top, left: dcAddAgentDropdown.left }}
                                    >
                                      {(agents || []).filter(a => a && !assignedAgents.includes(a.id)).map(a => (
                                        <button key={a.id} onClick={() => handleDiscordAssign(ch.key, a.id)} className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 truncate">{a.name}</button>
                                      ))}
                                      {(agents || []).filter(a => a && !assignedAgents.includes(a.id)).length === 0 && (
                                        <div className="px-3 py-2 text-xs text-gray-400 italic">All agents assigned</div>
                                      )}
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        };

                        return Object.entries(guilds).map(([guildName, channels]) => (
                          <div key={guildName} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-visible">
                            <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                              {guildName}
                            </div>
                            <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
                              {channels.map(ch => (
                                <React.Fragment key={ch.key}>
                                  {renderRow(ch, false)}
                                  {ch.threads?.map(t => renderRow(t, true))}
                                </React.Fragment>
                              ))}
                            </div>
                          </div>
                        ));
                      })()}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                {/* Disconnected state — token input */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Bot Token</label>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <input
                        type={dcShowToken ? 'text' : 'password'}
                        value={dcToken}
                        onChange={e => setDcToken(e.target.value)}
                        placeholder="MTIzNDU2Nzg5MDEy..."
                        className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-loxia-500 text-sm font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setDcShowToken(!dcShowToken)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {dcShowToken ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                      </button>
                    </div>
                    <button onClick={handleDiscordConnect} disabled={dcLoading || !dcToken.trim()} className="button-primary text-sm">
                      {dcLoading ? 'Connecting...' : 'Connect'}
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    Create a bot at <span className="font-medium">discord.com/developers</span> and enable the <span className="font-medium">Message Content</span> intent
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Analytics & Data Collection */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center">
              <ChartBarIcon className="w-5 h-5 text-gray-500 mr-2" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Analytics & Data Collection
              </h2>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Control how your usage data helps improve OnBuzz Community
            </p>
          </div>

          <div className="p-6 space-y-4">
            {/* Consent Options - styled like modal */}
            <div className="space-y-3">
              {/* Decline All */}
              <button
                type="button"
                onClick={() => handleConsentChange(CONSENT_LEVELS.NONE)}
                className={`relative w-full p-4 rounded-lg border-2 text-left transition-colors hover:border-gray-400 dark:hover:border-gray-500 ${
                  consentLevel === CONSENT_LEVELS.NONE
                    ? 'border-loxia-500 bg-loxia-50 dark:bg-loxia-900/20'
                    : 'border-gray-200 dark:border-gray-700'
                }`}
              >
                <div className="flex items-center">
                  <div className="w-10 h-10 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center flex-shrink-0">
                    <ShieldCheckIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                  </div>
                  <div className="ml-4 flex-1">
                    <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                      Decline All
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      No analytics data collected
                    </p>
                  </div>
                  {consentLevel === CONSENT_LEVELS.NONE && (
                    <CheckCircleIcon className="w-5 h-5 text-loxia-600 dark:text-loxia-400 flex-shrink-0" />
                  )}
                </div>
              </button>

              {/* Basic Analytics */}
              <button
                type="button"
                onClick={() => handleConsentChange(CONSENT_LEVELS.BASIC)}
                className={`relative w-full p-4 rounded-lg border-2 text-left transition-colors hover:border-blue-400 dark:hover:border-blue-500 ${
                  consentLevel === CONSENT_LEVELS.BASIC
                    ? 'border-loxia-500 bg-loxia-50 dark:bg-loxia-900/20'
                    : 'border-gray-200 dark:border-gray-700'
                }`}
              >
                <div className="flex items-center">
                  <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                    <ChartBarIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="ml-4 flex-1">
                    <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                      Basic Analytics
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Clicks, scrolls, navigation (all text masked)
                    </p>
                  </div>
                  {consentLevel === CONSENT_LEVELS.BASIC && (
                    <CheckCircleIcon className="w-5 h-5 text-loxia-600 dark:text-loxia-400 flex-shrink-0" />
                  )}
                </div>
              </button>

              {/* Full Analytics */}
              <button
                type="button"
                onClick={() => handleConsentChange(CONSENT_LEVELS.FULL)}
                className={`relative w-full p-4 rounded-lg border-2 text-left transition-colors hover:border-loxia-400 dark:hover:border-loxia-500 ${
                  consentLevel === CONSENT_LEVELS.FULL
                    ? 'border-loxia-500 bg-loxia-50 dark:bg-loxia-900/20'
                    : 'border-loxia-300 dark:border-loxia-700 bg-loxia-50/50 dark:bg-loxia-900/10'
                }`}
              >
                <span className="absolute -top-2 right-4 px-2 py-0.5 text-xs font-medium bg-loxia-600 text-white rounded-full">
                  Recommended
                </span>
                <div className="flex items-center">
                  <div className="w-10 h-10 bg-loxia-100 dark:bg-loxia-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                    <ChatBubbleLeftRightIcon className="w-5 h-5 text-loxia-600 dark:text-loxia-400" />
                  </div>
                  <div className="ml-4 flex-1">
                    <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                      Full Analytics
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Complete usage data for better UX insights
                    </p>
                  </div>
                  {consentLevel === CONSENT_LEVELS.FULL && (
                    <CheckCircleIcon className="w-5 h-5 text-loxia-600 dark:text-loxia-400 flex-shrink-0" />
                  )}
                </div>
              </button>
            </div>

            {/* Current Status */}
            {consentTimestamp && (
              <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                Last updated: {new Date(consentTimestamp).toLocaleDateString()}
              </p>
            )}

            {/* Info Box */}
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-xs text-blue-800 dark:text-blue-200">
                <strong>Privacy Note:</strong> API keys and sensitive credentials are never collected regardless of your analytics settings.
                Data is processed by Microsoft Clarity.
              </p>
            </div>
          </div>
        </div>

        {/* Appearance */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Appearance
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Customize the look and feel of the interface
            </p>
          </div>

          <div className="p-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Theme
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {themeOptions.map((option) => {
                  const IconComponent = option.icon;
                  return (
                    <label key={option.value} className="relative">
                      <input
                        type="radio"
                        value={option.value}
                        checked={settings.theme === option.value}
                        onChange={(e) => handleThemeChange(e.target.value)}
                        className="sr-only"
                      />
                      <div className={`p-4 rounded-lg border-2 cursor-pointer transition-colors ${
                        settings.theme === option.value
                          ? 'border-loxia-500 bg-loxia-50 dark:bg-loxia-900/20'
                          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                      }`}>
                        <div className="flex flex-col items-center">
                          <IconComponent className="w-6 h-6 text-gray-600 dark:text-gray-400 mb-2" />
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {option.label}
                          </span>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Streaming Toggle */}
            <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <BoltIcon className="w-5 h-5 text-blue-500 mr-3" />
                  <div>
                    <label className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      Real-time Streaming
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Show AI responses progressively as they are generated
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setStreamingEnabled(!streamingEnabled)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                    streamingEnabled ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
                  }`}
                  role="switch"
                  aria-checked={streamingEnabled}
                >
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      streamingEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Settings;
