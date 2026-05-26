const API_BASE = `${window.location.origin}/api`;

class ApiClient {
  async request(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    
    const config = {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    };
    
    if (config.body && typeof config.body === 'object') {
      config.body = JSON.stringify(config.body);
    }
    
    try {
      const response = await fetch(url, config);

      if (!response.ok) {
        // Surface the server's structured error body in the thrown
        // message so the UI shows the ACTUAL reason, not just the
        // HTTP status text. Validation errors (400) include
        // details: [{ path, message }, ...] from the schema gate.
        let detailsText = '';
        let parsedBody = null;
        try {
          parsedBody = await response.clone().json();
          if (parsedBody?.error) {
            detailsText = `: ${parsedBody.error}`;
            if (Array.isArray(parsedBody.details) && parsedBody.details.length > 0) {
              const lines = parsedBody.details
                .map(d => `  • ${d.path ? `[${d.path}] ` : ''}${d.message || JSON.stringify(d)}`)
                .join('\n');
              detailsText += `\n${lines}`;
            }
          } else if (parsedBody?.message) {
            detailsText = `: ${parsedBody.message}`;
          }
        } catch {
          // Body wasn't JSON or already consumed — try plain text
          try { detailsText = `: ${await response.text()}`; } catch { /* give up */ }
        }
        const err = new Error(`HTTP ${response.status} ${response.statusText}${detailsText}`);
        err.status = response.status;
        err.responseBody = parsedBody;
        throw err;
      }

      const data = await response.json();
      console.log(`API Success: ${config.method || 'GET'} ${url}`, data);
      return data;

    } catch (error) {
      console.error(`API request failed: ${config.method || 'GET'} ${url}`, error);
      if (error.name === 'SyntaxError') {
        console.error('Response was not valid JSON');
      }
      throw error;
    }
  }

  // Session management
  async createSession(projectDir = null) {
    return this.request('/sessions', {
      method: 'POST',
      body: { projectDir }
    });
  }

  // Orchestrator API
  async orchestratorRequest(sessionId, action, payload, projectDir = null) {
    return this.request('/orchestrator', {
      method: 'POST',
      body: {
        sessionId,
        action,
        payload,
        projectDir
      }
    });
  }

  async createAgent(sessionId, agentConfig, projectDir = null) {
    return this.orchestratorRequest(sessionId, 'create_agent', agentConfig, projectDir);
  }

  async updateAgent(sessionId, agentId, updates, projectDir = null) {
    return this.orchestratorRequest(sessionId, 'update_agent', { agentId, updates }, projectDir);
  }

  async sendMessage(sessionId, messageConfig, projectDir = null) {
    // API keys will now be retrieved from session storage by the backend
    const configWithSession = {
      ...messageConfig,
      sessionId // Pass session ID for API key retrieval
    };
    
    return this.orchestratorRequest(sessionId, 'send_message', configWithSession, projectDir);
  }

  async listAgents(sessionId, projectDir = null) {
    return this.orchestratorRequest(sessionId, 'list_agents', {}, projectDir);
  }

  async getStatus(sessionId, projectDir = null) {
    return this.orchestratorRequest(sessionId, 'get_session_state', {}, projectDir);
  }

  async pauseAgent(sessionId, pauseConfig, projectDir = null) {
    return this.orchestratorRequest(sessionId, 'pause_agent', pauseConfig, projectDir);
  }

  async resumeAgent(sessionId, resumeConfig, projectDir = null) {
    return this.orchestratorRequest(sessionId, 'resume_agent', resumeConfig, projectDir);
  }

  async switchModel(sessionId, modelConfig, projectDir = null) {
    return this.orchestratorRequest(sessionId, 'switch_model', modelConfig, projectDir);
  }

  async getAgentStatus(sessionId, agentConfig, projectDir = null) {
    return this.orchestratorRequest(sessionId, 'get_agent_status', agentConfig, projectDir);
  }

  async getAgentConversations(sessionId, agentId, projectDir = null) {
    return this.orchestratorRequest(sessionId, 'get_agent_conversations', { agentId }, projectDir);
  }

  async deleteAgent(sessionId, agentConfig, projectDir = null) {
    return this.orchestratorRequest(sessionId, 'delete_agent', agentConfig, projectDir);
  }

  async unloadAgent(sessionId, agentConfig, projectDir = null) {
    return this.orchestratorRequest(sessionId, 'unload_agent', agentConfig, projectDir);
  }

  async duplicateAgent(agentId, options = {}) {
    const { newName, keepConversation = false, sessionId } = options;
    return this.request(`/agents/${agentId}/duplicate`, {
      method: 'POST',
      body: { newName, keepConversation, sessionId }
    });
  }

  // Team operations
  async getTeams() {
    return this.request('/teams');
  }

  async getTeam(teamId) {
    return this.request(`/teams/${teamId}`);
  }

  async createTeam(teamData) {
    return this.request('/teams', {
      method: 'POST',
      body: teamData
    });
  }

  async updateTeam(teamId, updates) {
    return this.request(`/teams/${teamId}`, {
      method: 'PUT',
      body: updates
    });
  }

  async deleteTeam(teamId) {
    return this.request(`/teams/${teamId}`, {
      method: 'DELETE'
    });
  }

  async loadTeam(teamId) {
    return this.request(`/teams/${teamId}/load`, {
      method: 'POST'
    });
  }

  async addAgentToTeam(teamId, agentId) {
    return this.request(`/teams/${teamId}/members`, {
      method: 'POST',
      body: { agentId }
    });
  }

  async removeAgentFromTeam(teamId, agentId) {
    return this.request(`/teams/${teamId}/members/${agentId}`, {
      method: 'DELETE'
    });
  }

  // Flow operations
  async getFlows() {
    return this.request('/flows');
  }

  async getFlow(flowId) {
    return this.request(`/flows/${flowId}`);
  }

  async createFlow(flowData) {
    return this.request('/flows', {
      method: 'POST',
      body: flowData
    });
  }

  async updateFlow(flowId, updates) {
    return this.request(`/flows/${flowId}`, {
      method: 'PUT',
      body: updates
    });
  }

  async deleteFlow(flowId) {
    return this.request(`/flows/${flowId}`, {
      method: 'DELETE'
    });
  }

  async getFlowAgentStatus(flowId) {
    return this.request(`/flows/${flowId}/agents`);
  }

  async executeFlow(flowId, options = {}) {
    const { input, sessionId } = options;
    return this.request(`/flows/${flowId}/execute`, {
      method: 'POST',
      body: { input, sessionId }
    });
  }

  async stopFlow(flowId, runId) {
    return this.request(`/flows/${flowId}/stop`, {
      method: 'POST',
      body: { runId }
    });
  }

  async getFlowRuns(flowId) {
    return this.request(`/flows/${flowId}/runs`);
  }

  async getFlowRun(flowId, runId) {
    return this.request(`/flows/${flowId}/runs/${runId}`);
  }

  // File operations
  async getFiles(path = '.', projectDir = null) {
    const params = new URLSearchParams({ path });
    if (projectDir) params.append('projectDir', projectDir);
    
    return this.request(`/files?${params}`);
  }

  async uploadFile(fileName, content, projectDir = null) {
    return this.request('/files/upload', {
      method: 'POST',
      body: { fileName, content, projectDir }
    });
  }

  // Open directory in system file explorer
  async openDirectory(path) {
    return this.request('/file-explorer/open', {
      method: 'POST',
      body: { path }
    });
  }

  // Cloud connectivity check
  async getCloudHealth() {
    return this.request(`/health/cloud?_t=${Date.now()}`);
  }

  // Get system info (cwd, platform, homedir)
  async getSystemInfo() {
    return this.request('/file-explorer/cwd');
  }

  // Model management — local backend serves the catalog from manifest +
  // live provider /models endpoints. The picker only wants chat-capable
  // models (no TTS, embeddings, image, realtime, etc.), so we ask the
  // server to filter via ?chat=true. No client-side auth needed.
  async getAvailableModels() {
    return this.request('/llm/models?chat=true');
  }

  // Get available tools from registry
  async getTools() {
    return this.request('/tools');
  }

  // Get all available agents (loaded + archived on disk)
  async getAvailableAgents() {
    return this.request('/agents/available');
  }

  // Import an archived agent from disk
  async importAgent(agentId) {
    return this.request('/agents/import', {
      method: 'POST',
      body: { agentId }
    });
  }

  // Export agent conversation (persistent state file)
  async exportAgentConversation(agentId) {
    return this.request(`/agents/${agentId}/export`);
  }

  // Agent mode management
  async setAgentMode(agentId, mode, lockMode = false, sessionId = null) {
    return this.request(`/agents/${agentId}/mode`, {
      method: 'POST',
      body: { mode, lockMode, sessionId }
    });
  }

  async getAgentMode(agentId) {
    return this.request(`/agents/${agentId}/mode`);
  }

  async stopAgentExecution(agentId) {
    return this.request(`/agents/${agentId}/stop`, {
      method: 'POST'
    });
  }

  async clearConversation(agentId) {
    return this.request(`/agents/${agentId}/clear`, {
      method: 'POST'
    });
  }

  // API Key management
  async setApiKeys(sessionId, keys) {
    return this.request('/keys', {
      method: 'POST',
      body: {
        sessionId,
        ...keys
      }
    });
  }

  // Verify a provider key by listing models server-side. Used by the
  // onboarding wizard. Returns { ok, models?, message? } — never throws
  // for predictable failures (bad key, network timeout, unreachable).
  async testProviderConnection({ provider, apiKey, host }) {
    return this.request('/providers/test', {
      method: 'POST',
      body: { provider, apiKey, host }
    });
  }

  async getApiKeyStatus(sessionId) {
    return this.request(`/keys/${sessionId}`);
  }

  async removeApiKeys(sessionId) {
    return this.request(`/keys/${sessionId}`, {
      method: 'DELETE'
    });
  }

  // Health check
  async health() {
    return this.request('/health');
  }

  // Version check - fetches latest version from npm registry
  async checkForUpdates(currentVersion) {
    const NPM_REGISTRY_URL = 'https://registry.npmjs.org/onbuzz-community';

    try {
      const response = await fetch(NPM_REGISTRY_URL, {
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch version info: ${response.status}`);
      }

      const data = await response.json();
      const latestVersion = data['dist-tags']?.latest;

      if (!latestVersion) {
        throw new Error('Could not determine latest version');
      }

      // Compare versions
      const isUpToDate = currentVersion === latestVersion;
      const updateAvailable = !isUpToDate && this._isNewerVersion(latestVersion, currentVersion);

      return {
        success: true,
        currentVersion,
        latestVersion,
        isUpToDate,
        updateAvailable,
        updateCommand: 'npm i -g onbuzz-community@latest',
        checkedAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('Version check failed:', error);
      return {
        success: false,
        currentVersion,
        latestVersion: null,
        isUpToDate: null,
        updateAvailable: false,
        error: error.message,
        checkedAt: new Date().toISOString()
      };
    }
  }

  // Compare semver versions (returns true if v1 > v2)
  _isNewerVersion(v1, v2) {
    const parts1 = v1.replace(/^v/, '').split('.').map(Number);
    const parts2 = v2.replace(/^v/, '').split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 > p2) return true;
      if (p1 < p2) return false;
    }
    return false;
  }

  // ========== System Update API ==========

  /**
   * Trigger system update (installs latest version and restarts)
   * @param {Object} options - Update options
   * @param {string} options.restartCommand - Command to restart (default: 'onbuzz web')
   * @param {number} options.restartDelay - Delay before restart in ms (default: 5000)
   * @returns {Promise<Object>} Update result
   */
  async performUpdate(options = {}) {
    return this.request('/system/update', {
      method: 'POST',
      body: {
        restartCommand: options.restartCommand || 'onbuzz web',
        restartDelay: options.restartDelay || 5000
      }
    });
  }

  /**
   * Get current update status
   * @returns {Promise<Object>} Current version and update command
   */
  async getUpdateStatus() {
    return this.request('/system/update-status');
  }

  // ========== Visual Editor API ==========

  /**
   * Start visual editor for an agent
   * @param {string} sessionId - Session ID
   * @param {string} agentId - Agent ID
   * @param {string} appUrl - URL of the user's app to preview
   * @param {string} projectRoot - Project root directory
   */
  async startVisualEditor(sessionId, agentId, appUrl, projectRoot = null) {
    return this.request('/visual-editor/start', {
      method: 'POST',
      body: {
        sessionId,
        agentId,
        appUrl,
        projectRoot
      }
    });
  }

  /**
   * Stop visual editor for an agent
   * @param {string} sessionId - Session ID
   * @param {string} agentId - Agent ID
   */
  async stopVisualEditor(sessionId, agentId) {
    return this.request('/visual-editor/stop', {
      method: 'POST',
      body: {
        sessionId,
        agentId
      }
    });
  }

  /**
   * Get visual editor status for an agent
   * @param {string} sessionId - Session ID
   * @param {string} agentId - Agent ID
   */
  async getVisualEditorStatus(sessionId, agentId) {
    return this.request(`/visual-editor/status/${agentId}?sessionId=${sessionId}`, {
      method: 'GET'
    });
  }

  /**
   * List all visual editor instances
   * @param {string} sessionId - Session ID
   */
  async listVisualEditorInstances(sessionId) {
    return this.request(`/visual-editor/instances?sessionId=${sessionId}`, {
      method: 'GET'
    });
  }

  /**
   * Send command to visual editor
   * @param {string} sessionId - Session ID
   * @param {string} agentId - Agent ID
   * @param {string} command - Command type (highlight, scroll-to, reload, set-mode)
   * @param {Object} params - Command parameters
   */
  async sendVisualEditorCommand(sessionId, agentId, command, params = {}) {
    return this.request('/visual-editor/command', {
      method: 'POST',
      body: {
        sessionId,
        agentId,
        command,
        params
      }
    });
  }

  // =====================================================
  // Service Discovery API
  // =====================================================

  /**
   * Get all registered services
   * @returns {Promise<Object>} { success, services, stats }
   */
  async getServices() {
    return this.request('/services');
  }

  /**
   * Get a specific service by name
   * @param {string} name - Service name (e.g., 'visualEditor')
   * @returns {Promise<Object>} { success, service }
   */
  async getService(name) {
    return this.request(`/services/${name}`);
  }

  /**
   * Get the URL for a service
   * @param {string} name - Service name
   * @returns {Promise<string|null>} Service URL or null if not found
   */
  async getServiceUrl(name) {
    try {
      const result = await this.getService(name);
      return result.success && result.service ? result.service.url : null;
    } catch (err) {
      console.warn(`Service '${name}' not found:`, err.message);
      return null;
    }
  }

  /**
   * Get the WebSocket URL for a service
   * @param {string} name - Service name
   * @param {string} [path=''] - Optional path to append
   * @returns {Promise<string|null>} WebSocket URL or null if not found
   */
  async getServiceWsUrl(name, path = '') {
    try {
      const result = await this.getService(name);
      return result.success && result.service ? `${result.service.wsUrl}${path}` : null;
    } catch (err) {
      console.warn(`Service '${name}' not found:`, err.message);
      return null;
    }
  }

  // =====================================================
  // Terminal Tasks API
  // =====================================================

  /**
   * Get running terminal tasks for an agent
   * @param {string} agentId - Agent ID
   * @param {boolean} includeRecent - Include recent completed tasks
   * @returns {Promise<Object>} { success, tasks, summary, recentTasks? }
   */
  async getTerminalTasks(agentId, includeRecent = false) {
    const query = includeRecent ? '?includeRecent=true' : '';
    return this.request(`/agents/${agentId}/terminal-tasks${query}`, {
      method: 'GET'
    });
  }

  /**
   * Get output for a specific terminal task
   * @param {string} agentId - Agent ID
   * @param {string} commandId - Command ID
   * @param {Object} options - { tailLines, includeStderr }
   * @returns {Promise<Object>} Task output data
   */
  async getTerminalTaskOutput(agentId, commandId, options = {}) {
    const params = new URLSearchParams();
    if (options.tailLines) params.set('tailLines', options.tailLines);
    if (options.includeStderr !== undefined) params.set('includeStderr', options.includeStderr);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request(`/agents/${agentId}/terminal-tasks/${commandId}/output${query}`, {
      method: 'GET'
    });
  }

  /**
   * Get all running terminal tasks across all agents
   * @returns {Promise<Object>} { success, tasks, summary }
   */
  async getAllTerminalTasks() {
    return this.request('/terminal-tasks', {
      method: 'GET'
    });
  }

  // =====================================================
  // Streaming Chat API
  // =====================================================

  // =====================================================
  // Credential Management API
  // =====================================================

  /**
   * Submit credentials in response to a credential request
   * @param {Object} data - { requestId, siteId, username, password, saveToVault }
   * @returns {Promise<Object>} { success } or { success: false, error }
   */
  async submitCredentials(data) {
    return this.request('/credentials/submit', {
      method: 'POST',
      body: data
    });
  }

  /**
   * Cancel a pending credential request
   * @param {string} requestId - The request ID to cancel
   * @returns {Promise<Object>} { success }
   */
  async cancelCredentialRequest(requestId) {
    return this.request('/credentials/cancel', {
      method: 'POST',
      body: { requestId }
    });
  }

  /**
   * Get list of known sites for credential storage
   * @returns {Promise<Object>} { success, sites: [{ id, name, hasCredentials }] }
   */
  async getKnownSites() {
    return this.request('/credentials/known-sites', {
      method: 'GET'
    });
  }

  /**
   * Get list of stored credentials (metadata only, no passwords)
   * @returns {Promise<Object>} { success, credentials: [{ siteId, name, username }] }
   */
  async listStoredCredentials() {
    return this.request('/credentials', {
      method: 'GET'
    });
  }

  /**
   * Save credentials to vault (from settings panel)
   * @param {string} siteId - Site identifier
   * @param {Object} credentials - { username, password }
   * @returns {Promise<Object>} { success }
   */
  async saveCredentials(siteId, credentials) {
    return this.request('/credentials', {
      method: 'POST',
      body: { siteId, ...credentials }
    });
  }

  /**
   * Delete stored credentials
   * @param {string} siteId - Site identifier
   * @returns {Promise<Object>} { success }
   */
  async deleteCredentials(siteId) {
    return this.request(`/credentials/${siteId}`, {
      method: 'DELETE'
    });
  }

  // =====================================================
  // User Prompt API
  // =====================================================

  /**
   * Submit response to a user prompt request
   * @param {Object} data - { requestId, answers: [{questionId, selectedOptions, freeText}] }
   * @returns {Promise<Object>} { success } or { success: false, error }
   */
  async submitPromptResponse(data) {
    return this.request('/prompt/submit', {
      method: 'POST',
      body: data
    });
  }

  /**
   * Cancel a pending user prompt request
   * @param {string} requestId - The request ID to cancel
   * @param {string} reason - Optional cancellation reason
   * @returns {Promise<Object>} { success }
   */
  async cancelPromptRequest(requestId, reason = 'User cancelled') {
    return this.request('/prompt/cancel', {
      method: 'POST',
      body: { requestId, reason }
    });
  }

  async extendPromptTimeout(requestId, additionalMs) {
    return this.request(`/prompts/${requestId}/extend`, {
      method: 'POST',
      body: { additionalMs }
    });
  }

  async clearPromptTimeout(requestId) {
    return this.request(`/prompts/${requestId}/clear-timeout`, {
      method: 'POST'
    });
  }

  // =====================================================
  // Streaming Chat API
  // =====================================================

  /**
   * Send a streaming chat request
   * @param {string} sessionId - Session ID
   * @param {Object} chatConfig - Chat configuration (message, model, etc.)
   * @param {Object} callbacks - Event callbacks
   * @param {Function} callbacks.onChunk - Called for each text chunk
   * @param {Function} callbacks.onDone - Called when stream completes
   * @param {Function} callbacks.onError - Called on error
   * @returns {Promise<Object>} Final response data
   */
  async streamChat(sessionId, chatConfig, callbacks = {}) {
    const { onChunk, onDone, onError } = callbacks;
    const url = `${API_BASE}/llm/chat`;

    // The local AIService dispatches to the configured provider; vendor
    // keys are read from the backend's apiKeyManager — the client no
    // longer attaches an Authorization header.
    const requestBody = {
      ...chatConfig,
      sessionId,
      stream: true,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept':       'text/event-stream',
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(`HTTP ${response.status}: ${errorText}`);
        error.status = response.status;
        if (onError) onError(error);
        throw error;
      }

      // Check if we got a stream
      const contentType = response.headers.get('content-type');
      if (!contentType?.includes('text/event-stream')) {
        // Not a stream, parse as regular JSON (fallback)
        const data = await response.json();
        if (onChunk && data.content) {
          onChunk(data.content);
        }
        if (onDone) onDone(data);
        return data;
      }

      // Process SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let finalData = null;

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        const text = decoder.decode(value, { stream: true });
        const lines = text.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();

            if (data === '[DONE]') {
              continue;
            }

            try {
              const parsed = JSON.parse(data);

              if (parsed.type === 'chunk' && parsed.content) {
                fullContent += parsed.content;
                if (onChunk) {
                  onChunk(parsed.content);
                }
              } else if (parsed.type === 'done') {
                finalData = {
                  content: parsed.content || fullContent,
                  usage: parsed.usage,
                  model: parsed.model,
                  finishReason: parsed.finishReason
                };
              } else if (parsed.type === 'error') {
                const error = new Error(parsed.error);
                error.code = parsed.code;
                if (onError) onError(error);
                throw error;
              }
            } catch (parseError) {
              // Skip unparseable lines, but don't throw for JSON parse errors
              if (parseError.code) {
                throw parseError;
              }
              continue;
            }
          }
        }
      }

      // Final callback
      if (onDone) {
        onDone(finalData || { content: fullContent });
      }

      return finalData || { content: fullContent };

    } catch (error) {
      console.error('Streaming chat request failed:', error);
      if (onError) onError(error);
      throw error;
    }
  }
  // =====================================================
  // Scheduled Tasks API
  // =====================================================

  async getSchedules() {
    return this.request('/schedules');
  }

  async getSchedulePresets() {
    return this.request('/schedules/presets');
  }

  async createSchedule(config) {
    return this.request('/schedules', {
      method: 'POST',
      body: config
    });
  }

  async getSchedule(id) {
    return this.request(`/schedules/${id}`);
  }

  async updateSchedule(id, updates) {
    return this.request(`/schedules/${id}`, {
      method: 'PUT',
      body: updates
    });
  }

  async deleteSchedule(id) {
    return this.request(`/schedules/${id}`, {
      method: 'DELETE'
    });
  }

  async toggleSchedule(id) {
    return this.request(`/schedules/${id}/toggle`, {
      method: 'POST'
    });
  }

  // =====================================================
  // Ollama Local Models API
  // =====================================================

  async getOllamaStatus() {
    return this.request('/ollama/status');
  }

  async getOllamaModels() {
    return this.request('/ollama/models');
  }

  async pullOllamaModel(model, sessionId) {
    return this.request('/ollama/pull', {
      method: 'POST',
      body: JSON.stringify({ model, sessionId })
    });
  }

  async deleteOllamaModel(name) {
    return this.request(`/ollama/models/${encodeURIComponent(name)}`, {
      method: 'DELETE'
    });
  }

  async getOllamaModelInfo(name) {
    return this.request(`/ollama/models/${encodeURIComponent(name)}/info`);
  }

  async updateOllamaSettings(settings) {
    return this.request('/ollama/settings', {
      method: 'PUT',
      body: JSON.stringify(settings)
    });
  }

  // Skills Library
  async listSkills() {
    return this.request('/skills');
  }

  async getSkill(name) {
    return this.request(`/skills/${encodeURIComponent(name)}/content`);
  }

  async createSkill(name, content, files = [], description = '') {
    return this.request('/skills', { method: 'POST', body: { name, content, files, description } });
  }

  async updateSkill(name, content, files = [], description = '') {
    return this.request(`/skills/${encodeURIComponent(name)}`, { method: 'PUT', body: { content, files, description } });
  }

  async deleteSkill(name) {
    return this.request(`/skills/${encodeURIComponent(name)}`, { method: 'DELETE' });
  }

  async previewSkillSource(source) {
    return this.request('/skills/preview', { method: 'POST', body: { source } });
  }

  async importSkill(source, name = null, description = null) {
    return this.request('/skills/import', { method: 'POST', body: { source, name, description } });
  }
  // Telegram Bot
  async getTelegramStatus() {
    return this.request('/telegram/status');
  }

  async connectTelegram(botToken) {
    return this.request('/telegram/connect', { method: 'POST', body: { botToken } });
  }

  async disconnectTelegram() {
    return this.request('/telegram/disconnect', { method: 'POST' });
  }

  async testTelegram() {
    return this.request('/telegram/test', { method: 'POST' });
  }

  async getTelegramSettings() {
    return this.request('/telegram/settings');
  }

  async updateTelegramSettings(settings) {
    return this.request('/telegram/settings', { method: 'POST', body: settings });
  }

  // --- Discord Bot ---

  async getDiscordStatus() {
    return this.request('/discord/status');
  }

  async connectDiscord(botToken) {
    return this.request('/discord/connect', { method: 'POST', body: { botToken } });
  }

  async disconnectDiscord() {
    return this.request('/discord/disconnect', { method: 'POST' });
  }

  async getDiscordChannels() {
    return this.request('/discord/channels');
  }

  async getDiscordMappings() {
    return this.request('/discord/mappings');
  }

  async assignDiscordAgent(channelKey, agentId) {
    return this.request('/discord/assign', { method: 'POST', body: { channelKey, agentId } });
  }

  async unassignDiscordAgent(channelKey, agentId) {
    return this.request('/discord/unassign', { method: 'POST', body: { channelKey, agentId } });
  }

  // widget-module: remove this method if the module is deleted.
  async postWidgetEvent({ agentId, widgetId, payload }) {
    return this.request('/widget/event', {
      method: 'POST',
      body: { agentId, widgetId, payload },
    });
  }
}

export const api = new ApiClient();
