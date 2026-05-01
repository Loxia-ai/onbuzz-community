/**
 * DiscordService — Remote agent interface via Discord Bot
 *
 * Purpose:
 * - Conversational interface with agents from Discord channels
 * - Many-to-many mapping: each agent can be on 0..N channels, each channel can have 0..N agents
 * - @agent-name mention routing (single-agent channels route directly)
 * - Smart response formatting (markdown, code blocks, message splitting)
 * - Broadcast interception for real-time agent response relay
 *
 * Architecture:
 * - Uses discord.js v14+ (lazy-imported, optional dependency)
 * - Gateway intents: Guilds, GuildMessages, MessageContent (privileged)
 * - Intercepts WebSocket broadcasts to capture agent responses
 * - Routes user messages to agents via orchestrator.processRequest()
 * - Persists config to {userData}/discord/discord-config.json
 */

import { promises as fs } from 'fs';
import path from 'path';
import { getUserDataPaths, ensureUserDataDirs } from '../utilities/userDataDir.js';
import { INTERFACE_TYPES } from '../utilities/constants.js';
import { filterContentForExternalRelay, resolveBlockTargets } from './channelFilter.js';
import { createDiscordSource } from './messageSource.js';

const DISCORD_STATUS = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  FAILED: 'failed'
};

const MAX_MESSAGE_LENGTH = 1950; // Discord limit is 2000, leave room for formatting
const INTERACTION_TTL_MS = 30 * 60 * 1000; // 30 minutes — only relay to channels with recent interaction

class DiscordService {
  constructor(logger = null) {
    this.logger = logger;

    // Dependencies (set via setters)
    this.orchestrator = null;
    this.agentPool = null;
    this.webSocketManager = null;
    this.flowExecutor = null;

    // Bot state
    this.client = null;
    this.status = DISCORD_STATUS.DISCONNECTED;

    // Channel-agent mappings: channelKey -> [agentId]
    // channelKey format: "guildId:channelId" or "guildId:threadId"
    // Both channels and threads use the same mapping structure.
    // When a message arrives in a thread, we check the thread key first,
    // then fall back to the parent channel key.
    this.channelMappings = {};

    // Track recent interactions: "agentId:routingKey" -> { channelKey, timestamp }
    // Used to determine where to relay agent responses
    this.recentInteractions = new Map();

    // Sticky agent per routing key: routingKey -> lastAgentId
    this.stickyAgent = new Map();

    // Cached Discord metadata for UI display
    this.knownGuilds = {};
    this.knownChannels = {};

    // Config persistence
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
      this.dataDir = path.join(paths.base, 'discord');
      this.configPath = path.join(this.dataDir, 'discord-config.json');
      await fs.mkdir(this.dataDir, { recursive: true });
    }
  }

  async _loadConfig() {
    await this._ensureDataDir();
    try {
      const data = await fs.readFile(this.configPath, 'utf8');
      this.config = JSON.parse(data);
      this.channelMappings = this.config.channelMappings || {};
      this.knownGuilds = this.config.knownGuilds || {};
      this.knownChannels = this.config.knownChannels || {};
    } catch {
      this.config = {};
    }
  }

  async _saveConfig() {
    await this._ensureDataDir();
    this.config.channelMappings = this.channelMappings;
    this.config.knownGuilds = this.knownGuilds;
    this.config.knownChannels = this.knownChannels;
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
        this.logger?.warn('[DiscordService] Auto-connect failed', { error: error.message });
      }
    }
  }

  async connect(botToken) {
    if (this.status === DISCORD_STATUS.CONNECTED) {
      await this.disconnect();
    }

    this.status = DISCORD_STATUS.CONNECTING;
    this.logger?.info('[DiscordService] Connecting...');

    try {
      // Lazy import discord.js (optional dependency)
      const { Client, GatewayIntentBits, ChannelType } = await import('discord.js');
      this._ChannelType = ChannelType;

      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent
        ]
      });

      // Wait for ready event
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Discord login timed out after 30s')), 30000);

        this.client.once('ready', () => {
          clearTimeout(timeout);
          resolve();
        });

        this.client.once('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });

        this.client.login(botToken).catch(reject);
      });

      const botUser = this.client.user;
      this.logger?.info('[DiscordService] Connected', {
        botName: botUser.username,
        guildCount: this.client.guilds.cache.size
      });

      // Save config
      this.config.botToken = botToken;
      this.config.botUsername = botUser.username;
      this.config.botId = botUser.id;
      await this._saveConfig();

      // Cache guild/channel metadata
      this._cacheGuildMetadata();

      // Setup event handlers
      this._setupHandlers();

      this.status = DISCORD_STATUS.CONNECTED;

      return { username: botUser.username, id: botUser.id };
    } catch (error) {
      this.status = DISCORD_STATUS.FAILED;
      this.logger?.error('[DiscordService] Connection failed', { error: error.message });
      if (this.client) {
        try { this.client.destroy(); } catch {}
        this.client = null;
      }
      throw error;
    }
  }

  async disconnect() {
    if (this.client) {
      try { this.client.destroy(); } catch {}
      this.client = null;
    }
    this.status = DISCORD_STATUS.DISCONNECTED;
    this.recentInteractions.clear();
    this.stickyAgent.clear();
    this.logger?.info('[DiscordService] Disconnected');
  }

  getStatus() {
    return {
      status: this.status,
      connected: this.status === DISCORD_STATUS.CONNECTED,
      botUsername: this.config.botUsername || null,
      botId: this.config.botId || null,
      guildCount: this.client?.guilds?.cache?.size || 0,
      channelMappingCount: Object.keys(this.channelMappings).length
    };
  }

  // --- Discord Event Handlers ---

  _setupHandlers() {
    if (!this.client) return;

    this.client.on('messageCreate', async (message) => {
      try {
        await this._handleMessage(message);
      } catch (error) {
        this.logger?.error('[DiscordService] Message handling error', { error: error.message });
      }
    });

    this.client.on('guildCreate', (guild) => {
      this.logger?.info('[DiscordService] Added to guild', { guildName: guild.name, guildId: guild.id });
      this._cacheGuildMetadata();
    });

    this.client.on('guildDelete', (guild) => {
      this.logger?.info('[DiscordService] Removed from guild', { guildId: guild.id });
      delete this.knownGuilds[guild.id];
      // Clean up channel mappings for this guild
      for (const key of Object.keys(this.channelMappings)) {
        if (key.startsWith(`${guild.id}:`)) {
          delete this.channelMappings[key];
          delete this.knownChannels[key];
        }
      }
      this._saveConfig().catch(() => {});
    });

    this.client.on('error', (error) => {
      this.logger?.error('[DiscordService] Client error', { error: error.message });
    });
  }

  _cacheGuildMetadata() {
    if (!this.client) return;
    const CT = this._ChannelType;

    for (const [guildId, guild] of this.client.guilds.cache) {
      this.knownGuilds[guildId] = {
        name: guild.name,
        icon: guild.iconURL({ size: 64 }) || null
      };

      for (const [channelId, channel] of guild.channels.cache) {
        // Text channels
        if (channel.type === CT?.GuildText || channel.type === 0) {
          const key = `${guildId}:${channelId}`;
          this.knownChannels[key] = {
            name: channel.name,
            guildId,
            guildName: guild.name,
            isThread: false
          };
        }
        // Public threads (type 11) and private threads (type 12)
        if (channel.type === CT?.PublicThread || channel.type === 11 ||
            channel.type === CT?.PrivateThread || channel.type === 12) {
          const key = `${guildId}:${channelId}`;
          this.knownChannels[key] = {
            name: channel.name,
            guildId,
            guildName: guild.name,
            isThread: true,
            parentId: channel.parentId || null,
            parentKey: channel.parentId ? `${guildId}:${channel.parentId}` : null
          };
        }
      }
    }

    this._saveConfig().catch(() => {});
  }

  // --- Message Routing ---

  /**
   * Build the routing key for a message.
   * For threads: check thread-specific mapping first, fall back to parent channel.
   * For channels: use the channel key directly.
   * Returns { routingKey, mappedAgents } or null if no mapping found.
   */
  _resolveRouting(message) {
    const guildId = message.guild.id;
    const channelId = message.channel.id;
    const directKey = `${guildId}:${channelId}`;

    // Check direct key first (works for both channels and thread-specific mappings)
    const directAgents = this.channelMappings[directKey];
    if (directAgents && directAgents.length > 0) {
      return { routingKey: directKey, mappedAgents: directAgents, respondToId: channelId };
    }

    // If this is a thread, fall back to parent channel mapping
    const parentId = message.channel.parentId;
    if (parentId) {
      const parentKey = `${guildId}:${parentId}`;
      const parentAgents = this.channelMappings[parentKey];
      if (parentAgents && parentAgents.length > 0) {
        // Use the thread's own ID for responses (reply in-thread), but routing comes from parent
        return { routingKey: directKey, mappedAgents: parentAgents, respondToId: channelId };
      }
    }

    return null;
  }

  async _handleMessage(message) {
    // Ignore bot messages (including self)
    if (message.author.bot) return;
    // Ignore DMs (only handle guild channels)
    if (!message.guild) return;

    // Resolve routing: thread-specific → parent channel fallback
    const routing = this._resolveRouting(message);
    if (!routing) return; // No agents mapped — ignore silently

    const { routingKey, mappedAgents } = routing;

    const messageText = message.content.trim();
    if (!messageText) return;

    let targetAgentId = null;

    if (mappedAgents.length === 1) {
      // Single agent — route directly
      targetAgentId = mappedAgents[0];
    } else {
      // Multiple agents — parse @agent-name mention
      targetAgentId = await this._resolveAgentFromMention(messageText, mappedAgents);

      if (!targetAgentId) {
        // Try sticky agent for this channel/thread
        const sticky = this.stickyAgent.get(routingKey);
        if (sticky && mappedAgents.includes(sticky)) {
          targetAgentId = sticky;
        }
      }

      if (!targetAgentId) {
        // Prompt user — list available agents
        const agentNames = [];
        for (const aid of mappedAgents) {
          const agent = this.agentPool ? await this.agentPool.getAgent(aid) : null;
          agentNames.push(agent?.name || aid);
        }
        await message.reply(
          `Multiple agents on this channel. Mention one by name:\n${agentNames.map(n => `\`@${n}\``).join(', ')}`
        );
        return;
      }
    }

    // Remove @agent-name prefix from the message if present
    const cleanedMessage = this._stripAgentMention(messageText, targetAgentId);

    // Update sticky agent for this routing key (channel or thread)
    this.stickyAgent.set(routingKey, targetAgentId);

    // Route to agent
    await this._routeToAgent(routingKey, targetAgentId, cleanedMessage, message);
  }

  async _resolveAgentFromMention(text, candidateAgentIds) {
    if (!this.agentPool) return null;

    // Check for @agent-name pattern at start of message
    const mentionMatch = text.match(/^@(\S+)/);
    if (!mentionMatch) return null;

    const mentionName = mentionMatch[1].toLowerCase();

    for (const agentId of candidateAgentIds) {
      const agent = await this.agentPool.getAgent(agentId);
      if (agent?.name?.toLowerCase() === mentionName) {
        return agentId;
      }
    }

    return null;
  }

  _stripAgentMention(text, agentId) {
    // Remove @agent-name from the start of the message
    return text.replace(/^@\S+\s*/, '').trim() || text;
  }

  async _routeToAgent(channelKey, agentId, text, discordMessage) {
    const sessionId = `discord-${channelKey.replace(':', '-')}`;

    // Record recent interaction for response targeting. `channelName` and
    // `guildName` are captured so we can surface a human-readable alias
    // to the agent (see `getBridgedChannels`).
    this.recentInteractions.set(`${agentId}:${channelKey}`, {
      channelKey,
      channelId: discordMessage.channel.id,
      channelName: discordMessage.channel.name || null,
      guildId: discordMessage.guild?.id ?? null,
      guildName: discordMessage.guild?.name ?? null,
      timestamp: Date.now()
    });

    // Show typing indicator
    try {
      await discordMessage.channel.sendTyping();
    } catch {}

    const agent = this.agentPool ? await this.agentPool.getAgent(agentId) : null;
    this.logger?.info('[DiscordService] Routing message to agent', {
      agentId,
      agentName: agent?.name,
      channelKey,
      messageLength: text.length
    });

    // Capture the source at ingress. `source` travels with the message
    // through the orchestrator -> messageProcessor -> agentPool pipeline and
    // becomes the human-readable `(Message by alice from Discord > …)` line
    // that the agent sees — see services/messageSource.js for the contract.
    const source = createDiscordSource(discordMessage);

    try {
      if (this.orchestrator) {
        await this.orchestrator.processRequest({
          interface: INTERFACE_TYPES.DISCORD,
          sessionId,
          action: 'send_message',
          payload: {
            agentId,
            message: text,
            streamingEnabled: false,
            source,
          }
        });
      } else if (this.agentPool) {
        // Fallback: direct message injection
        await this.agentPool.addUserMessage(agentId, {
          content: text,
          sessionId,
          source,
        });
      }
    } catch (error) {
      this.logger?.error('[DiscordService] Failed to route message', { error: error.message, agentId });
      try {
        await discordMessage.reply(`Failed to send message to agent: ${error.message}`);
      } catch {}
    }
  }

  // --- Broadcast Interception ---

  _interceptBroadcasts(wsManager) {
    if (!wsManager || this._originalBroadcast) return;

    // Chain onto existing wrapper (Telegram may already be wrapping)
    const currentBroadcast = wsManager.broadcastToSession.bind(wsManager);
    this._originalBroadcast = currentBroadcast;

    wsManager.broadcastToSession = (sessionId, message) => {
      // Call previous wrapper (Telegram's or original)
      currentBroadcast(sessionId, message);
      // Discord handling
      this._handleBroadcastEvent(sessionId, message);
    };
  }

  async _handleBroadcastEvent(sessionId, message) {
    if (!this.client || this.status !== DISCORD_STATUS.CONNECTED) return;

    const type = message?.type;
    if (!type) return;

    // Relay completed agent responses
    if (type === 'stream_complete') {
      await this._relayAgentResponse(message);
      return;
    }

    // Relay user prompt requests
    if (type === 'user_prompt_request') {
      await this._relayPromptRequest(message);
      return;
    }
  }

  async _relayAgentResponse(message) {
    const agentId = message.agentId || message.data?.agentId;
    if (!agentId) return;

    const content = message.content || message.data?.content ||
      message.message?.content || message.data?.message?.content;
    if (!content) return;

    // Skip tool-result messages and user messages
    const role = message.role || message.data?.role || message.message?.role;
    if (role === 'user' || role === 'tool') return;

    // Parse every <external>…</external> block out of the raw content.
    // Content inside the tags is relayed verbatim — no stripping, no
    // content-type discrimination. The web UI still sees the full raw
    // message via the WS broadcast and is unaffected by this filter.
    const { blocks } = filterContentForExternalRelay(content);
    if (blocks.length === 0) {
      this.logger?.debug?.('[DiscordService] no <external> blocks in agent response — nothing relayed', { agentId });
      return;
    }

    // Collect every live Discord channel bridged to this agent. Drops
    // stale entries past the interaction TTL as a side-effect.
    const bridged = this._getBridgedChannelEntries(agentId);
    if (bridged.length === 0) return;

    // Map owned aliases → entry so we can look up channelId quickly after
    // `resolveBlockTargets` tells us which aliases to send to.
    const aliasToEntry = new Map(bridged.map(e => [e.alias, e]));
    const ownedAliases = [...aliasToEntry.keys()];

    const agent = this.agentPool ? await this.agentPool.getAgent(agentId) : null;
    const agentName = agent?.name || agentId;

    for (const block of blocks) {
      const targets = resolveBlockTargets(block, ownedAliases);
      for (const alias of targets) {
        const entry = aliasToEntry.get(alias);
        if (!entry) continue;
        try {
          await this._sendFormattedResponse(entry.channelId, agentName, block.text);
        } catch (error) {
          this.logger?.warn('[DiscordService] Failed to relay block', {
            alias, channelId: entry.channelId, error: error.message
          });
        }
      }
    }
  }

  /**
   * Active Discord bridges for an agent, as entries tied to the relay
   * pipeline. Each entry carries an `alias` the agent can use in
   * `<external to="…">`. Expired entries (past INTERACTION_TTL_MS) are
   * garbage-collected during the scan so alias lists stay honest.
   *
   * @param {string} agentId
   * @returns {Array<{alias: string, label: string, channelKey: string, channelId: string, guildId: string|null, guildName: string|null, channelName: string|null}>}
   * @private
   */
  _getBridgedChannelEntries(agentId) {
    const now = Date.now();
    const entries = [];
    for (const [key, interaction] of this.recentInteractions) {
      if (!key.startsWith(`${agentId}:`)) continue;
      if (now - interaction.timestamp > INTERACTION_TTL_MS) {
        this.recentInteractions.delete(key);
        continue;
      }
      const channel = interaction.channelName || interaction.channelId;
      // Alias format: `discord:#<channel>` when we have a channel name;
      // otherwise fall back to the bare channel id. Substring matching in
      // `resolveBlockTargets` means the agent can write short forms like
      // `discord:#ops` even if the canonical alias is longer.
      const alias = interaction.channelName
        ? `discord:#${interaction.channelName}`
        : `discord:${interaction.channelId}`;
      const label = interaction.guildName
        ? `Discord channel #${interaction.channelName ?? interaction.channelId} in ${interaction.guildName}`
        : `Discord channel ${interaction.channelName ?? interaction.channelId}`;
      entries.push({
        alias, label,
        channelKey: interaction.channelKey,
        channelId: interaction.channelId,
        guildId: interaction.guildId,
        guildName: interaction.guildName,
        channelName: interaction.channelName,
      });
    }
    return entries;
  }

  /**
   * Compact alias list the scheduler surfaces in the system prompt so the
   * agent can address specific Discord channels via `<external to="…">`.
   *
   * @param {string} agentId
   * @returns {Array<{alias: string, label: string}>}
   */
  getBridgedChannels(agentId) {
    if (!agentId || this.status !== DISCORD_STATUS.CONNECTED) return [];
    return this._getBridgedChannelEntries(agentId).map(e => ({ alias: e.alias, label: e.label }));
  }

  /**
   * True when the agent has at least one live Discord bridge. Scheduler
   * uses this to decide whether to inject the `<external>` prompt
   * guidance for this turn (cheaper than calling getBridgedChannels when
   * we only need a boolean).
   */
  isAgentBridged(agentId) {
    if (!agentId || this.status !== DISCORD_STATUS.CONNECTED) return false;
    const now = Date.now();
    for (const [key, interaction] of this.recentInteractions) {
      if (!key.startsWith(`${agentId}:`)) continue;
      if (now - interaction.timestamp <= INTERACTION_TTL_MS) return true;
    }
    return false;
  }

  async _relayPromptRequest(message) {
    const agentId = message.data?.agentId || message.agentId;
    if (!agentId) return;

    const promptText = message.data?.prompt || message.data?.message || 'Agent is requesting input';

    for (const [key, interaction] of this.recentInteractions) {
      if (!key.startsWith(`${agentId}:`)) continue;
      if (Date.now() - interaction.timestamp > INTERACTION_TTL_MS) continue;

      try {
        const channel = await this.client.channels.fetch(interaction.channelId);
        if (channel) {
          await channel.send(`**Input needed:**\n${promptText}`);
        }
      } catch {}
    }
  }

  // --- Response Formatting ---

  async _sendFormattedResponse(channelId, agentName, content) {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel) return;

    const header = `**${agentName}:**\n`;
    const fullMessage = header + content;

    // Split if needed
    const parts = this._splitMessage(fullMessage);

    for (const part of parts) {
      await channel.send(part);
    }
  }

  _splitMessage(text) {
    if (text.length <= MAX_MESSAGE_LENGTH) return [text];

    const parts = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= MAX_MESSAGE_LENGTH) {
        parts.push(remaining);
        break;
      }

      // Try to split at code block boundary
      let splitIndex = remaining.lastIndexOf('\n```', MAX_MESSAGE_LENGTH);
      if (splitIndex > MAX_MESSAGE_LENGTH * 0.3) {
        splitIndex += 1; // Include the newline
      } else {
        // Try newline
        splitIndex = remaining.lastIndexOf('\n', MAX_MESSAGE_LENGTH);
        if (splitIndex < MAX_MESSAGE_LENGTH * 0.3) {
          // Try space
          splitIndex = remaining.lastIndexOf(' ', MAX_MESSAGE_LENGTH);
          if (splitIndex < MAX_MESSAGE_LENGTH * 0.3) {
            // Hard split
            splitIndex = MAX_MESSAGE_LENGTH;
          }
        }
      }

      parts.push(remaining.slice(0, splitIndex));
      remaining = remaining.slice(splitIndex).trimStart();
    }

    return parts;
  }

  // --- Channel Mapping Management ---

  async assignAgentToChannel(channelKey, agentId) {
    if (!this.channelMappings[channelKey]) {
      this.channelMappings[channelKey] = [];
    }
    if (!this.channelMappings[channelKey].includes(agentId)) {
      this.channelMappings[channelKey].push(agentId);
    }
    await this._saveConfig();
    this.logger?.info('[DiscordService] Agent assigned to channel', { channelKey, agentId });
  }

  async removeAgentFromChannel(channelKey, agentId) {
    if (this.channelMappings[channelKey]) {
      this.channelMappings[channelKey] = this.channelMappings[channelKey].filter(id => id !== agentId);
      if (this.channelMappings[channelKey].length === 0) {
        delete this.channelMappings[channelKey];
      }
    }
    // Clean sticky if removed agent was sticky
    if (this.stickyAgent.get(channelKey) === agentId) {
      this.stickyAgent.delete(channelKey);
    }
    await this._saveConfig();
    this.logger?.info('[DiscordService] Agent removed from channel', { channelKey, agentId });
  }

  getChannelMappings() {
    return {
      mappings: this.channelMappings,
      knownGuilds: this.knownGuilds,
      knownChannels: this.knownChannels
    };
  }

  getAvailableChannels() {
    if (!this.client || this.status !== DISCORD_STATUS.CONNECTED) {
      // Return cached channels if disconnected
      return Object.entries(this.knownChannels).map(([key, ch]) => ({
        key,
        channelId: key.split(':')[1],
        guildId: key.split(':')[0],
        name: ch.name,
        guildName: ch.guildName,
        isThread: ch.isThread || false,
        parentKey: ch.parentKey || null
      }));
    }

    const channels = [];
    const CT = this._ChannelType;
    for (const [guildId, guild] of this.client.guilds.cache) {
      for (const [channelId, channel] of guild.channels.cache) {
        const isText = channel.type === CT?.GuildText || channel.type === 0;
        const isThread = channel.type === CT?.PublicThread || channel.type === 11 ||
                         channel.type === CT?.PrivateThread || channel.type === 12;
        if (isText || isThread) {
          const key = `${guildId}:${channelId}`;
          channels.push({
            key,
            channelId,
            guildId,
            name: channel.name,
            guildName: guild.name,
            isThread,
            parentKey: isThread && channel.parentId ? `${guildId}:${channel.parentId}` : null
          });
        }
      }
    }
    return channels;
  }
}

// Singleton pattern (matches Telegram)
let instance = null;

export function getDiscordService(logger) {
  if (!instance) {
    instance = new DiscordService(logger);
  }
  return instance;
}

export { DiscordService, DISCORD_STATUS };
export default DiscordService;
