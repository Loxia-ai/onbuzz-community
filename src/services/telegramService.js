/**
 * TelegramService — Remote agent interface via Telegram Bot
 *
 * Purpose:
 * - Full conversational interface with agents from phone
 * - @agent-name prefix routing (sticky session for no-prefix)
 * - Smart response formatting (markdown, code blocks, images, inline keyboards)
 * - On-demand notifications (/watch)
 * - Prompt/credential relay for interactive agent flows
 *
 * Architecture:
 * - Long polling (no webhook, works behind NAT)
 * - Intercepts WebSocket broadcasts to capture agent responses
 * - Routes user messages to agents via orchestrator.processRequest()
 * - Optional dependency — system works without it
 */

import { promises as fs } from 'fs';
import path from 'path';
import { getUserDataPaths, ensureUserDataDirs } from '../utilities/userDataDir.js';
import { filterContentForExternalRelay, resolveBlockTargets } from './channelFilter.js';
import { createTelegramSource } from './messageSource.js';

const TELEGRAM_STATUS = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  FAILED: 'failed'
};

const MAX_MESSAGE_LENGTH = 4000; // Telegram limit is 4096, leave room for formatting
const NOTIFICATION_BATCH_INTERVAL_MS = 10000;
const PROMPT_TIMEOUT_MS = 300000; // 5 minutes
const PROMPT_REMINDER_MS = 180000; // 3 minutes

class TelegramService {
  constructor(logger = null) {
    this.logger = logger;

    // Dependencies (set via setters)
    this.orchestrator = null;
    this.agentPool = null;
    this.webSocketManager = null;
    this.flowExecutor = null;

    // Bot state
    this.bot = null;
    this.status = TELEGRAM_STATUS.DISCONNECTED;
    this.chatId = null;
    this.lastAgentId = null;
    this.activeAgentIds = new Set(); // all agents user has addressed from Telegram

    // Relay state
    this.pendingRelays = new Map();
    this.replyContext = null; // current expected reply

    // Notifications
    this.watchEnabled = false;
    this.notificationQueue = [];
    this.notificationTimer = null;

    // Config
    this.dataDir = null;
    this.configPath = null;
    this.config = {};

    // Original broadcast (saved before wrapping)
    this._originalBroadcast = null;
  }

  // --- Dependency Injection ---

  setOrchestrator(orchestrator) { this.orchestrator = orchestrator; }
  setAgentPool(agentPool) { this.agentPool = agentPool; }
  setWebSocketManager(wsManager) {
    this.webSocketManager = wsManager;
    this._interceptBroadcasts(wsManager);
  }
  setFlowExecutor(flowExecutor) { this.flowExecutor = flowExecutor; }

  // --- Config Persistence ---

  async _ensureDataDir() {
    if (!this.dataDir) {
      await ensureUserDataDirs();
      const paths = getUserDataPaths();
      this.dataDir = path.join(paths.base, 'telegram');
      this.configPath = path.join(this.dataDir, 'telegram-config.json');
      await fs.mkdir(this.dataDir, { recursive: true });
    }
  }

  async _loadConfig() {
    await this._ensureDataDir();
    try {
      const data = await fs.readFile(this.configPath, 'utf8');
      this.config = JSON.parse(data);
      this.chatId = this.config.chatId || null;
      this.watchEnabled = this.config.watchEnabled || false;
    } catch {
      this.config = {};
    }
  }

  async _saveConfig() {
    await this._ensureDataDir();
    this.config.chatId = this.chatId;
    this.config.watchEnabled = this.watchEnabled;
    this.config.updatedAt = new Date().toISOString();
    await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
  }

  // --- Lifecycle ---

  async autoConnect() {
    await this._loadConfig();
    if (this.config.botToken) {
      try {
        await this.connect(this.config.botToken);
      } catch (error) {
        this.logger?.warn('[TelegramService] Auto-connect failed', { error: error.message });
      }
    }
  }

  async connect(botToken) {
    if (this.status === TELEGRAM_STATUS.CONNECTED) {
      await this.disconnect();
    }

    this.status = TELEGRAM_STATUS.CONNECTING;
    this.logger?.info('[TelegramService] Connecting...');

    try {
      const TelegramBot = (await import('node-telegram-bot-api')).default;
      this.bot = new TelegramBot(botToken, { polling: true });

      // Verify token by getting bot info
      const me = await this.bot.getMe();
      this.logger?.info('[TelegramService] Connected', { botName: me.username });

      this.config.botToken = botToken;
      this.config.botUsername = me.username;
      await this._saveConfig();

      this._setupHandlers();
      this.status = TELEGRAM_STATUS.CONNECTED;

      return { username: me.username, id: me.id };
    } catch (error) {
      this.status = TELEGRAM_STATUS.FAILED;
      this.logger?.error('[TelegramService] Connection failed', { error: error.message });
      throw error;
    }
  }

  async disconnect() {
    if (this.bot) {
      try { await this.bot.stopPolling(); } catch {}
      this.bot = null;
    }
    this.status = TELEGRAM_STATUS.DISCONNECTED;
    this._clearNotificationTimer();
    this.logger?.info('[TelegramService] Disconnected');
  }

  getStatus() {
    return {
      status: this.status,
      connected: this.status === TELEGRAM_STATUS.CONNECTED,
      chatId: this.chatId,
      botUsername: this.config.botUsername || null,
      watchEnabled: this.watchEnabled
    };
  }

  // --- Command & Message Handlers ---

  _setupHandlers() {
    if (!this.bot) return;

    this.bot.onText(/\/start/, (msg) => this._cmdStart(msg));
    this.bot.onText(/\/help/, (msg) => this._cmdHelp(msg));
    this.bot.onText(/\/status/, (msg) => this._cmdStatus(msg));
    this.bot.onText(/\/agents/, (msg) => this._cmdAgents(msg));
    this.bot.onText(/\/agent (.+)/, (msg, match) => this._cmdAgentDetail(msg, match[1].trim()));
    this.bot.onText(/\/flows/, (msg) => this._cmdFlows(msg));
    this.bot.onText(/\/run (.+)/, (msg, match) => this._cmdRunFlow(msg, match[1].trim()));
    this.bot.onText(/\/stop (.+)/, (msg, match) => this._cmdStopAgent(msg, match[1].trim()));
    this.bot.onText(/\/following/, (msg) => this._cmdFollowing(msg));
    this.bot.onText(/\/unfollow (.+)/, (msg, match) => this._cmdUnfollow(msg, match[1].trim()));
    this.bot.onText(/\/watch/, (msg) => this._cmdWatch(msg));
    this.bot.onText(/\/unwatch/, (msg) => this._cmdUnwatch(msg));
    this.bot.onText(/\/watching/, (msg) => this._cmdWatching(msg));

    // Handle non-command text (agent messages)
    this.bot.on('message', (msg) => {
      if (msg.text && !msg.text.startsWith('/')) {
        this._handleTextMessage(msg);
      }
    });

    // Handle inline keyboard callbacks
    this.bot.on('callback_query', (query) => this._handleCallbackQuery(query));
  }

  _isAuthorized(msg) {
    return this.chatId && String(msg.chat.id) === String(this.chatId);
  }

  async _cmdStart(msg) {
    const chatId = String(msg.chat.id);

    if (!this.chatId) {
      this.chatId = chatId;
      await this._saveConfig();
      await this._send(chatId, this._escapeMarkdown('*OnBuzz Community connected!* 🚀\n\nThis chat is now linked. Use /help to see available commands.\n\nAddress agents with @agent-name your message.'));
    } else if (chatId === this.chatId) {
      await this._send(chatId, this._escapeMarkdown('Already connected. Use /help for commands.'));
    } else {
      await this._send(chatId, this._escapeMarkdown('⛔ Another chat is already registered. Disconnect from the web UI first.'));
    }
  }

  async _cmdHelp(msg) {
    if (!this._isAuthorized(msg)) return;
    const help = [
      '*OnBuzz Community — Telegram Remote*\n',
      '*Chat with agents:*',
      '`@agent-name your message` — send to specific agent',
      'Type without prefix — sends to last used agent\n',
      '*Commands:*',
      '/agents — list all agents',
      '/agent <name> — agent detail',
      '/status — system overview',
      '/following — agents you\'re following',
      '/unfollow <name> — stop following an agent',
      '/flows — list flows',
      '/run <flow> — start a flow',
      '/stop <agent> — stop agent execution',
      '/watch — subscribe to notifications',
      '/unwatch — unsubscribe',
      '/watching — notification status',
      '/help — this message'
    ];
    await this._send(msg.chat.id, this._escapeMarkdown(help.join('\n')));
  }

  async _cmdStatus(msg) {
    if (!this._isAuthorized(msg)) return;

    try {
      const agents = this.agentPool ? await this.agentPool.getAllAgents() : [];
      const active = agents.filter(a => a.status === 'active' || a.mode === 'auto');
      const idle = agents.filter(a => a.mode === 'chat' || a.status === 'idle');

      let text = `*System Status*\n\n`;
      text += `Agents: ${agents.length} total, ${active.length} active, ${idle.length} idle\n`;
      text += `Notifications: ${this.watchEnabled ? '🔔 On' : '🔕 Off'}`;

      await this._send(msg.chat.id, this._escapeMarkdown(text));
    } catch (error) {
      await this._send(msg.chat.id, this._escapeMarkdown(`❌ Error: ${error.message}`));
    }
  }

  async _cmdAgents(msg) {
    if (!this._isAuthorized(msg)) return;

    try {
      const agents = this.agentPool ? await this.agentPool.getAllAgents() : [];
      if (agents.length === 0) {
        await this._send(msg.chat.id, this._escapeMarkdown('No agents loaded.'));
        return;
      }

      let text = `*Agents (${agents.length}):*\n\n`;
      const buttons = [];

      for (const agent of agents) {
        const status = agent.mode === 'auto' ? '🟢' : agent.status === 'active' ? '🟡' : '⚪';
        const mode = agent.mode === 'auto' ? 'autonomous' : 'chat';
        text += `${status} *${this._escapeMarkdown(agent.name)}* — ${mode}\n`;
        buttons.push([{ text: agent.name, callback_data: `agent_detail:${agent.id}` }]);
      }

      await this._send(msg.chat.id, text, {
        reply_markup: { inline_keyboard: buttons }
      });
    } catch (error) {
      await this._send(msg.chat.id, this._escapeMarkdown(`❌ Error: ${error.message}`));
    }
  }

  async _cmdAgentDetail(msg, agentName) {
    if (!this._isAuthorized(msg)) return;
    await this._showAgentDetail(msg.chat.id, agentName);
  }

  async _showAgentDetail(chatId, agentNameOrId) {
    try {
      const agents = this.agentPool ? await this.agentPool.getAllAgents() : [];
      const agent = agents.find(a =>
        a.name.toLowerCase() === agentNameOrId.toLowerCase() ||
        a.id === agentNameOrId
      );

      if (!agent) {
        await this._send(chatId, this._escapeMarkdown(`Agent "${agentNameOrId}" not found.`));
        return;
      }

      const status = agent.mode === 'auto' ? '🟢 Autonomous' : '🟡 Chat';
      let text = `*${this._escapeMarkdown(agent.name)}*\n\n`;
      text += `Status: ${status}\n`;
      text += `Model: \`${this._escapeMarkdown(agent.currentModel || 'unknown')}\`\n`;
      if (agent.lastActivity) {
        text += `Last active: ${new Date(agent.lastActivity).toLocaleTimeString()}\n`;
      }

      const buttons = [
        [
          { text: '💬 Send Message', callback_data: `msg_agent:${agent.id}` },
          { text: '⏹ Stop', callback_data: `stop_agent:${agent.id}` }
        ]
      ];

      await this._send(chatId, text, { reply_markup: { inline_keyboard: buttons } });
    } catch (error) {
      await this._send(chatId, this._escapeMarkdown(`❌ Error: ${error.message}`));
    }
  }

  async _cmdFlows(msg) {
    if (!this._isAuthorized(msg)) return;

    try {
      if (!this.orchestrator?.stateManager) {
        await this._send(msg.chat.id, this._escapeMarkdown('Flows not available.'));
        return;
      }

      const projectDir = this.orchestrator.config?.project?.directory || process.cwd();
      const flowIndex = await this.orchestrator.stateManager.loadFlowIndex?.(projectDir) || {};
      const flows = Object.entries(flowIndex);

      if (flows.length === 0) {
        await this._send(msg.chat.id, this._escapeMarkdown('No flows defined.'));
        return;
      }

      let text = `*Flows (${flows.length}):*\n\n`;
      const buttons = [];

      for (const [id, flow] of flows) {
        text += `📋 *${this._escapeMarkdown(flow.name || id)}*\n`;
        buttons.push([{ text: `▶️ Run ${flow.name || id}`, callback_data: `run_flow:${id}` }]);
      }

      await this._send(msg.chat.id, text, { reply_markup: { inline_keyboard: buttons } });
    } catch (error) {
      await this._send(msg.chat.id, this._escapeMarkdown(`❌ Error: ${error.message}`));
    }
  }

  async _cmdRunFlow(msg, flowName) {
    if (!this._isAuthorized(msg)) return;
    await this._runFlow(msg.chat.id, flowName);
  }

  async _runFlow(chatId, flowNameOrId) {
    try {
      if (!this.flowExecutor) {
        await this._send(chatId, this._escapeMarkdown('Flow executor not available.'));
        return;
      }

      await this._send(chatId, this._escapeMarkdown(`▶️ Starting flow: ${flowNameOrId}...`));
      // Flow execution is async — completion will be captured by broadcast listener
      const projectDir = this.orchestrator?.config?.project?.directory || process.cwd();
      await this.flowExecutor.executeFlow(flowNameOrId, { projectDir });
    } catch (error) {
      await this._send(chatId, this._escapeMarkdown(`❌ Flow error: ${error.message}`));
    }
  }

  async _cmdStopAgent(msg, agentName) {
    if (!this._isAuthorized(msg)) return;

    try {
      const agents = this.agentPool ? await this.agentPool.getAllAgents() : [];
      const agent = agents.find(a => a.name.toLowerCase() === agentName.toLowerCase());
      if (!agent) {
        await this._send(msg.chat.id, this._escapeMarkdown(`Agent "${agentName}" not found.`));
        return;
      }

      if (this.orchestrator?.messageProcessor) {
        await this.orchestrator.messageProcessor.stopAutonomousExecution(agent.id);
      }

      await this._send(msg.chat.id, this._escapeMarkdown(`⏹ Stopped ${agent.name}`));
    } catch (error) {
      await this._send(msg.chat.id, this._escapeMarkdown(`❌ Error: ${error.message}`));
    }
  }

  async _cmdFollowing(msg) {
    if (!this._isAuthorized(msg)) return;

    if (this.activeAgentIds.size === 0) {
      await this._send(msg.chat.id, this._escapeMarkdown('Not following any agents. Send @agent-name to start chatting.'));
      return;
    }

    const agents = this.agentPool ? await this.agentPool.getAllAgents() : [];
    let text = `*Following ${this.activeAgentIds.size} agent(s):*\n\n`;
    const buttons = [];

    for (const id of this.activeAgentIds) {
      const agent = agents.find(a => a.id === id);
      const name = agent?.name || id;
      const isLast = id === this.lastAgentId;
      text += `${isLast ? '💬' : '👁'} *${this._escapeMarkdown(name)}*${isLast ? ' \\(active\\)' : ''}\n`;
      buttons.push([{ text: `❌ Unfollow ${name}`, callback_data: `unfollow:${id}` }]);
    }

    text += '\n_Active = default for messages without @prefix_';
    await this._send(msg.chat.id, text, { reply_markup: { inline_keyboard: buttons } });
  }

  async _cmdUnfollow(msg, agentName) {
    if (!this._isAuthorized(msg)) return;

    const agents = this.agentPool ? await this.agentPool.getAllAgents() : [];
    const agent = agents.find(a => a.name.toLowerCase() === agentName.toLowerCase());
    if (!agent || !this.activeAgentIds.has(agent.id)) {
      await this._send(msg.chat.id, this._escapeMarkdown(`Not following "${agentName}".`));
      return;
    }

    this.activeAgentIds.delete(agent.id);
    if (this.lastAgentId === agent.id) {
      // Switch lastAgentId to another active agent, or null
      this.lastAgentId = this.activeAgentIds.size > 0 ? [...this.activeAgentIds][this.activeAgentIds.size - 1] : null;
    }
    await this._send(msg.chat.id, this._escapeMarkdown(`Unfollowed ${agent.name}. Responses will no longer be relayed.`));
  }

  async _cmdWatch(msg) {
    if (!this._isAuthorized(msg)) return;
    this.watchEnabled = true;
    await this._saveConfig();
    await this._send(msg.chat.id, this._escapeMarkdown('🔔 Notifications enabled. You\'ll receive alerts for errors, completions and prompts.'));
  }

  async _cmdUnwatch(msg) {
    if (!this._isAuthorized(msg)) return;
    this.watchEnabled = false;
    this._clearNotificationTimer();
    await this._saveConfig();
    await this._send(msg.chat.id, this._escapeMarkdown('🔕 Notifications disabled.'));
  }

  async _cmdWatching(msg) {
    if (!this._isAuthorized(msg)) return;
    await this._send(msg.chat.id, this._escapeMarkdown(this.watchEnabled
      ? '🔔 Notifications are ON. Use /unwatch to disable.'
      : '🔕 Notifications are OFF. Use /watch to enable.'
    ));
  }

  // --- Agent Conversation ---

  async _handleTextMessage(msg) {
    if (!this._isAuthorized(msg)) return;
    const text = msg.text?.trim();
    if (!text) return;

    // Check if this is a reply to a pending prompt relay
    if (this.replyContext) {
      await this._handlePromptReply(msg);
      return;
    }

    // Parse @agent-name prefix
    let agentName = null;
    let messageText = text;

    const atMatch = text.match(/^@(\S+)\s+([\s\S]+)/);
    if (atMatch) {
      agentName = atMatch[1];
      messageText = atMatch[2].trim();
    }

    // Resolve agent
    let targetAgent = null;
    if (agentName) {
      const agents = this.agentPool ? await this.agentPool.getAllAgents() : [];
      targetAgent = agents.find(a => a.name.toLowerCase() === agentName.toLowerCase());
      if (!targetAgent) {
        await this._send(msg.chat.id, this._escapeMarkdown(`❌ Agent "${agentName}" not found. Use /agents to see available agents.`));
        return;
      }
      this.lastAgentId = targetAgent.id;
      this.activeAgentIds.add(targetAgent.id);
    } else if (this.lastAgentId) {
      // Sticky session
      targetAgent = this.agentPool ? await this.agentPool.getAgent(this.lastAgentId) : null;
      if (!targetAgent) {
        await this._send(msg.chat.id, this._escapeMarkdown('No agent selected. Use @agent-name message to address one.'));
        return;
      }
    } else {
      await this._send(msg.chat.id, this._escapeMarkdown('No agent selected. Use @agent-name message to address one.'));
      return;
    }

    // Send to agent
    try {
      await this._send(msg.chat.id, `📨 → *${this._escapeMarkdown(targetAgent.name)}*`);

      if (this.orchestrator) {
        const sessionId = `telegram-${this.chatId}`;
        // Capture source at ingress — see services/messageSource.js. The
        // source rides the payload into the orchestrator and becomes the
        // `(Message by alice from Telegram > …)` line the agent sees.
        const source = createTelegramSource(msg);
        await this.orchestrator.processRequest({
          interface: 'telegram',
          sessionId,
          action: 'send_message',
          payload: {
            agentId: targetAgent.id,
            message: messageText,
            streamingEnabled: false,
            source,
          },
          projectDir: this.orchestrator.config?.project?.directory || process.cwd()
        });
      }
    } catch (error) {
      await this._send(msg.chat.id, this._escapeMarkdown(`❌ Failed to send: ${error.message}`));
    }
  }

  // --- Callback Query Handler (Inline Keyboards) ---

  async _handleCallbackQuery(query) {
    if (!this.chatId || String(query.message.chat.id) !== String(this.chatId)) return;

    const data = query.data;
    try {
      await this.bot.answerCallbackQuery(query.id);
    } catch {}

    if (data.startsWith('agent_detail:')) {
      const agentId = data.replace('agent_detail:', '');
      await this._showAgentDetail(query.message.chat.id, agentId);
    } else if (data.startsWith('msg_agent:')) {
      const agentId = data.replace('msg_agent:', '');
      this.lastAgentId = agentId;
      this.activeAgentIds.add(agentId);
      const agent = this.agentPool ? await this.agentPool.getAgent(agentId) : null;
      const name = agent?.name || agentId;
      await this._send(query.message.chat.id, this._escapeMarkdown(`💬 Now chatting with ${name}. Type your message.`));
    } else if (data.startsWith('stop_agent:')) {
      const agentId = data.replace('stop_agent:', '');
      if (this.orchestrator?.messageProcessor) {
        await this.orchestrator.messageProcessor.stopAutonomousExecution(agentId);
      }
      await this._send(query.message.chat.id, this._escapeMarkdown('⏹ Agent stopped.'));
    } else if (data.startsWith('run_flow:')) {
      const flowId = data.replace('run_flow:', '');
      await this._runFlow(query.message.chat.id, flowId);
    } else if (data.startsWith('unfollow:')) {
      const agentId = data.replace('unfollow:', '');
      this.activeAgentIds.delete(agentId);
      if (this.lastAgentId === agentId) {
        this.lastAgentId = this.activeAgentIds.size > 0 ? [...this.activeAgentIds][this.activeAgentIds.size - 1] : null;
      }
      const agent = this.agentPool ? await this.agentPool.getAgent(agentId) : null;
      await this._send(query.message.chat.id, this._escapeMarkdown(`Unfollowed ${agent?.name || agentId}.`));
    } else if (data.startsWith('prompt_reply:')) {
      // Handle prompt option selection
      const [, requestId, answerIndex] = data.match(/prompt_reply:(.+):(\d+)/) || [];
      if (requestId && this.pendingRelays.has(requestId)) {
        await this._submitPromptReply(requestId, answerIndex);
      }
    }
  }

  // --- Broadcast Interceptor ---

  _interceptBroadcasts(wsManager) {
    if (!wsManager || this._originalBroadcast) return;

    const originalBroadcast = wsManager.broadcastToSession.bind(wsManager);
    this._originalBroadcast = originalBroadcast;

    wsManager.broadcastToSession = (sessionId, message) => {
      // Call original
      originalBroadcast(sessionId, message);
      // Forward to Telegram
      this._handleBroadcastEvent(message);
    };
  }

  async _handleBroadcastEvent(message) {
    if (!this.bot || !this.chatId || this.status !== TELEGRAM_STATUS.CONNECTED) return;

    const type = message?.type;
    if (!type) return;

    // Always relay prompt/credential requests (they block agent progress)
    if (type === 'user_prompt_request') {
      await this._relayPromptRequest(message);
      return;
    }
    if (type === 'credential_request') {
      await this._relayCredentialRequest(message);
      return;
    }

    // Agent responses — only relay stream_complete (message_added is a duplicate of the same content)
    if (type === 'stream_complete') {
      await this._relayAgentResponse(message);
      return;
    }

    // Notifications — only if watching
    if (!this.watchEnabled) return;

    const notificationTypes = {
      'agent_error': '⚠️ *Agent Error*',
      'flow_run_failed': '❌ *Flow Failed*',
      'agent_timeout': '⏰ *Agent Timeout*',
      'execution_stopped': '✅ *Agent Finished*',
      'flow_run_completed': '✅ *Flow Completed*',
      'criticalError': '🔴 *Critical Error*'
    };

    if (notificationTypes[type]) {
      const header = notificationTypes[type];
      let text = `${header}\n`;

      if (message.agentName || message.data?.agentName) {
        text += `Agent: \`${message.agentName || message.data?.agentName}\`\n`;
      }
      if (message.message || message.data?.message || message.error) {
        text += `${message.message || message.data?.message || message.error}\n`;
      }

      this._queueNotification(text);
    }
  }

  async _relayAgentResponse(message) {
    const agentId = message.agentId || message.data?.agentId;
    if (!agentId) return;

    // Only relay responses for agents the user has addressed from Telegram
    if (!this.activeAgentIds.has(agentId)) return;

    const content = message.content || message.data?.content ||
      message.message?.content || message.data?.message?.content;
    if (!content) return;

    // Skip tool-result messages and internal messages
    const role = message.role || message.data?.role || message.message?.role;
    if (role === 'user' || role === 'tool') return;

    // Parse every <external>…</external> block; content inside is relayed
    // verbatim (see ./channelFilter.js). The local operator's web UI
    // continues to see the full raw broadcast — this filter only decides
    // what leaves the process.
    const { blocks } = filterContentForExternalRelay(content);
    if (blocks.length === 0) {
      this.logger?.debug?.('[TelegramService] no <external> blocks in agent response — nothing relayed', { agentId });
      return;
    }

    const bridged = this.getBridgedChannels(agentId);
    if (bridged.length === 0) return;
    const ownedAliases = bridged.map(c => c.alias);

    const agent = this.agentPool ? await this.agentPool.getAgent(agentId) : null;
    const agentName = agent?.name || agentId;

    for (const block of blocks) {
      const targets = resolveBlockTargets(block, ownedAliases);
      if (targets.length === 0) continue;
      // Today there is a single Telegram chat per agent, so any match
      // ultimately sends to `this.chatId`. Loop defensively in case the
      // service ever grows multi-chat support.
      for (const alias of targets) {
        try {
          await this._sendFormattedResponse(this.chatId, agentName, block.text);
        } catch (error) {
          this.logger?.warn?.('[TelegramService] Failed to relay block', {
            alias, error: error.message
          });
        }
      }
    }
  }

  /**
   * Single-element alias list for this agent's Telegram bridge. The
   * service currently tracks one chat, so the alias is a stable
   * `telegram` handle; expanding to multi-chat later is additive (return
   * one entry per chat).
   *
   * @param {string} agentId
   * @returns {Array<{alias: string, label: string}>}
   */
  getBridgedChannels(agentId) {
    if (!this.isAgentBridged(agentId)) return [];
    return [{ alias: 'telegram', label: 'Telegram chat' }];
  }

  /**
   * True when the agent is currently addressable from Telegram — the
   * scheduler uses this to decide whether to inject the `<external>`
   * prompt guidance for this turn.
   *
   * @param {string} agentId
   * @returns {boolean}
   */
  isAgentBridged(agentId) {
    if (!agentId || this.status !== TELEGRAM_STATUS.CONNECTED) return false;
    return this.activeAgentIds.has(agentId);
  }

  // --- Smart Response Formatting ---

  async _sendFormattedResponse(chatId, agentName, content) {
    const header = `*${this._escapeMarkdown(agentName)}:*\n\n`;

    // Check for code blocks
    const hasCode = content.includes('```');

    if (content.length + header.length <= MAX_MESSAGE_LENGTH) {
      if (hasCode) {
        // Send as-is with code blocks — Telegram handles ``` natively
        await this._send(chatId, header + this._escapeMarkdownPreserveCode(content));
      } else {
        await this._send(chatId, header + this._escapeMarkdown(content));
      }
    } else {
      // Split long messages
      await this._send(chatId, header + this._escapeMarkdown(content.slice(0, MAX_MESSAGE_LENGTH - 100) + '\n\n… (truncated)'));
    }
  }

  // --- Prompt Relay ---

  async _relayPromptRequest(message) {
    if (!this.chatId) return;

    const data = message.data || message;
    const requestId = data.requestId;
    const agentId = data.agentId;
    const questions = data.questions || [];

    if (!requestId || questions.length === 0) return;

    const agent = this.agentPool ? await this.agentPool.getAgent(agentId) : null;
    const agentName = agent?.name || agentId;

    this.pendingRelays.set(requestId, { type: 'user_prompt', agentId, questions, timestamp: Date.now() });

    for (const q of questions) {
      let text = `🔔 *${this._escapeMarkdown(agentName)}* needs your input:\n\n`;
      text += this._escapeMarkdown(q.question) + '\n';

      const options = q.options || [];
      if (options.length > 0) {
        const buttons = options.map((opt, i) => ([{
          text: opt.label,
          callback_data: `prompt_reply:${requestId}:${i}`
        }]));
        await this._send(this.chatId, text, { reply_markup: { inline_keyboard: buttons } });
      } else {
        text += '\n_Type your reply:_';
        this.replyContext = { type: 'user_prompt', requestId, agentId };
        await this._send(this.chatId, text);
      }
    }

    // Set timeout reminder
    setTimeout(() => {
      if (this.pendingRelays.has(requestId)) {
        this._send(this.chatId, this._escapeMarkdown(`⏰ Reminder: ${agentName} is still waiting for your input.`)).catch(() => {});
      }
    }, PROMPT_REMINDER_MS);
  }

  async _relayCredentialRequest(message) {
    if (!this.chatId) return;

    const data = message.data || message;
    const requestId = data.requestId;
    const agentId = data.agentId;

    const agent = this.agentPool ? await this.agentPool.getAgent(agentId) : null;
    const agentName = agent?.name || agentId;

    this.pendingRelays.set(requestId, { type: 'credential', agentId, timestamp: Date.now() });
    this.replyContext = { type: 'credential', requestId, agentId };

    let text = `🔐 *${this._escapeMarkdown(agentName)}* needs credentials:\n\n`;
    text += this._escapeMarkdown(data.message || 'Please provide the requested credentials.');
    text += '\n\n_Type your reply:_';

    await this._send(this.chatId, text);
  }

  async _handlePromptReply(msg) {
    if (!this.replyContext) return;

    const { type, requestId, agentId } = this.replyContext;
    const text = msg.text?.trim();
    if (!text) return;

    this.replyContext = null;
    this.pendingRelays.delete(requestId);

    try {
      if (type === 'user_prompt' && this.webSocketManager) {
        // Submit prompt response via the same path the web UI uses
        this.webSocketManager._handleUserPromptResult?.({
          requestId,
          answers: { default: text }
        });
      } else if (type === 'credential' && this.webSocketManager) {
        this.webSocketManager._handleCredentialResponse?.({
          requestId,
          credentials: { value: text },
          saveForFuture: false
        });
      }

      await this._send(msg.chat.id, this._escapeMarkdown('✅ Response submitted.'));
    } catch (error) {
      await this._send(msg.chat.id, this._escapeMarkdown(`❌ Failed to submit: ${error.message}`));
    }
  }

  async _submitPromptReply(requestId, answerIndex) {
    const relay = this.pendingRelays.get(requestId);
    if (!relay) return;

    this.pendingRelays.delete(requestId);
    this.replyContext = null;

    try {
      const question = relay.questions[0];
      const option = question?.options?.[parseInt(answerIndex)];
      const answer = option?.label || String(answerIndex);

      if (this.webSocketManager?._handleUserPromptResult) {
        this.webSocketManager._handleUserPromptResult({
          requestId,
          answers: { [question.question]: answer }
        });
      }

      await this._send(this.chatId, this._escapeMarkdown(`✅ Selected: ${answer}`));
    } catch (error) {
      await this._send(this.chatId, this._escapeMarkdown(`❌ Failed: ${error.message}`));
    }
  }

  // --- Notification Batching ---

  _queueNotification(text) {
    this.notificationQueue.push(text);
    if (!this.notificationTimer) {
      this.notificationTimer = setTimeout(() => this._flushNotifications(), NOTIFICATION_BATCH_INTERVAL_MS);
    }
  }

  async _flushNotifications() {
    this.notificationTimer = null;
    if (this.notificationQueue.length === 0 || !this.chatId) return;

    const messages = this.notificationQueue.splice(0);
    const combined = messages.join('\n\n');

    if (combined.length <= MAX_MESSAGE_LENGTH) {
      await this._send(this.chatId, combined);
    } else {
      await this._send(this.chatId, messages[0] + (messages.length > 1
        ? `\n\n_…and ${messages.length - 1} more events_`
        : ''));
    }
  }

  _clearNotificationTimer() {
    if (this.notificationTimer) {
      clearTimeout(this.notificationTimer);
      this.notificationTimer = null;
    }
    this.notificationQueue = [];
  }

  // --- Telegram API Helpers ---

  async _send(chatId, text, options = {}) {
    if (!this.bot || !chatId) return;
    try {
      return await this.bot.sendMessage(chatId, text, {
        parse_mode: 'MarkdownV2',
        ...options
      });
    } catch (error) {
      // Fallback: send without formatting if markdown fails
      this.logger?.warn('[TelegramService] Markdown send failed, retrying plain', { error: error.message });
      try {
        return await this.bot.sendMessage(chatId, text.replace(/[\\*_`\[\]()~>#+\-=|{}.!]/g, ''), options);
      } catch (e2) {
        this.logger?.error('[TelegramService] Send failed', { error: e2.message });
      }
    }
  }

  async sendPhoto(chatId, photoPath, caption = '') {
    if (!this.bot || !chatId) return;
    try {
      return await this.bot.sendPhoto(chatId, photoPath, { caption });
    } catch (error) {
      this.logger?.error('[TelegramService] Send photo failed', { error: error.message });
    }
  }

  async sendDocument(chatId, docPath, caption = '') {
    if (!this.bot || !chatId) return;
    try {
      return await this.bot.sendDocument(chatId, docPath, { caption });
    } catch (error) {
      this.logger?.error('[TelegramService] Send document failed', { error: error.message });
    }
  }

  async sendTestMessage() {
    if (!this.chatId) throw new Error('No chat registered. Send /start from Telegram first.');
    await this._send(this.chatId, this._escapeMarkdown('✅ OnBuzz Community — test message received!'));
  }

  // --- Markdown Escaping ---

  _escapeMarkdown(text) {
    if (!text) return '';
    // Escape MarkdownV2 special chars
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
  }

  _escapeMarkdownPreserveCode(text) {
    if (!text) return '';
    // Split by code blocks, escape non-code parts
    const parts = text.split(/(```[\s\S]*?```)/g);
    return parts.map(part => {
      if (part.startsWith('```')) {
        return part; // Don't escape code blocks
      }
      return this._escapeMarkdown(part);
    }).join('');
  }
}

// Singleton
let instance = null;

export function getTelegramService(logger = null) {
  if (!instance) {
    instance = new TelegramService(logger);
  }
  return instance;
}

export { TelegramService, TELEGRAM_STATUS };
export default TelegramService;
