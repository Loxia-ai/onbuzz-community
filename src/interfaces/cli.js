/**
 * CLI Interface - Command Line Interface for OnBuzz Community
 * 
 * Purpose:
 * - Provide command-line interaction with the orchestrator
 * - Handle user input and display responses
 * - Support basic agent management and messaging
 * - Interactive REPL-style interface
 */

import readline from 'readline';
import { INTERFACE_TYPES, ORCHESTRATOR_ACTIONS } from '../utilities/constants.js';

class CLIInterface {
  constructor(orchestrator, logger, config = {}) {
    this.orchestrator = orchestrator;
    this.logger = logger;
    this.config = config;
    
    this.rl = null;
    this.sessionId = `cli-${Date.now()}`;
    this.currentAgent = null;
    this.isRunning = false;
    this.historySize = config.historySize || 1000;
    this.commandHistory = [];
    
    // CLI commands
    this.commands = {
      help: this.showHelp.bind(this),
      exit: this.exit.bind(this),
      quit: this.exit.bind(this),
      status: this.showStatus.bind(this),
      agents: this.listAgents.bind(this),
      create: this.createAgent.bind(this),
      switch: this.switchAgent.bind(this),
      pause: this.pauseAgent.bind(this),
      resume: this.resumeAgent.bind(this),
      clear: this.clearScreen.bind(this),
      history: this.showHistory.bind(this)
    };
  }

  /**
   * Initialize CLI interface
   * @returns {Promise<void>}
   */
  async initialize() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.getPrompt(),
      historySize: this.historySize
    });
    
    // Setup input handling
    this.rl.on('line', this.handleInput.bind(this));
    this.rl.on('close', this.exit.bind(this));
    
    // Handle Ctrl+C - show hint about /exit command
    this.rl.on('SIGINT', () => {
      console.log('\n(To exit, type "/exit" or press Ctrl+C again)');
      this.rl.prompt();
    });
    
    this.isRunning = true;
    
    // Show welcome message
    this.showWelcome();
    
    // Start the prompt
    this.rl.prompt();
  }

  /**
   * Handle user input
   * @private
   */
  async handleInput(input) {
    const trimmedInput = input.trim();
    
    if (trimmedInput.length === 0) {
      this.rl.prompt();
      return;
    }
    
    // Add to history
    this.commandHistory.push({
      command: trimmedInput,
      timestamp: new Date().toISOString()
    });
    
    // Keep history within limits
    if (this.commandHistory.length > this.historySize) {
      this.commandHistory.shift();
    }
    
    try {
      await this.processInput(trimmedInput);
    } catch (error) {
      console.error('❌ Error:', error.message);
      this.logger?.error('CLI command error', {
        command: trimmedInput,
        error: error.message
      });
    }
    
    if (this.isRunning) {
      this.rl.prompt();
    }
  }

  /**
   * Process user input
   * @private
   */
  async processInput(input) {
    // Check for CLI commands
    if (input.startsWith('/')) {
      const commandParts = input.slice(1).split(' ');
      const command = commandParts[0].toLowerCase();
      const args = commandParts.slice(1);
      
      if (this.commands[command]) {
        await this.commands[command](args);
        return;
      } else {
        console.log(`❌ Unknown command: /${command}`);
        console.log('Type /help for available commands');
        return;
      }
    }
    
    // If no current agent, suggest creating one
    if (!this.currentAgent) {
      console.log('💡 No agent selected. Create an agent first with: /create <agent-name>');
      return;
    }
    
    // Send message to current agent
    await this.sendMessageToAgent(input);
  }

  /**
   * Send message to current agent
   * @private
   */
  async sendMessageToAgent(message) {
    console.log('📤 Sending to agent...');
    
    try {
      const request = {
        interface: INTERFACE_TYPES.CLI,
        sessionId: this.sessionId,
        action: ORCHESTRATOR_ACTIONS.SEND_MESSAGE,
        payload: {
          agentId: this.currentAgent.id,
          message,
          mode: 'chat'
        },
        projectDir: process.cwd()
      };
      
      const response = await this.orchestrator.processRequest(request);
      
      if (response.success) {
        console.log('🤖 Agent response:');
        console.log(response.data.message.content);
        
        // Show tool results if any
        if (response.data.toolResults && response.data.toolResults.length > 0) {
          console.log('\n🔧 Tool execution results:');
          for (const result of response.data.toolResults) {
            console.log(`  ${result.toolId}: ${result.status}`);
            if (result.result) {
              console.log(`    Result: ${JSON.stringify(result.result, null, 2)}`);
            }
          }
        }
        
      } else {
        console.error('❌ Agent response failed:', response.error);
      }
      
    } catch (error) {
      console.error('❌ Failed to send message:', error.message);
    }
  }

  /**
   * Show welcome message
   * @private
   */
  showWelcome() {
    console.log('');
    console.log('🎯 Welcome to OnBuzz Community CLI');
    console.log('   Type /help for available commands');
    console.log('   Type /create <name> to create your first agent');
    console.log('');
  }

  /**
   * Show help information
   * @private
   */
  async showHelp() {
    console.log('');
    console.log('📚 OnBuzz Community CLI Commands:');
    console.log('');
    console.log('  /help                 - Show this help message');
    console.log('  /status              - Show system status');
    console.log('  /agents              - List all agents');
    console.log('  /create <name>       - Create a new agent');
    console.log('  /switch <agent-id>   - Switch to different agent');
    console.log('  /pause <agent-id>    - Pause an agent');
    console.log('  /resume <agent-id>   - Resume a paused agent');
    console.log('  /history             - Show command history');
    console.log('  /clear               - Clear screen');
    console.log('  /exit or /quit       - Exit the CLI');
    console.log('');
    console.log('💬 Chat with agents:');
    console.log('   Simply type your message to send it to the current agent');
    console.log('   Agents can use tools and communicate with other agents');
    console.log('');
  }

  /**
   * Show system status
   * @private
   */
  async showStatus() {
    try {
      const request = {
        interface: INTERFACE_TYPES.CLI,
        sessionId: this.sessionId,
        action: ORCHESTRATOR_ACTIONS.GET_SESSION_STATE,
        payload: {},
        projectDir: process.cwd()
      };
      
      const response = await this.orchestrator.processRequest(request);
      
      if (response.success) {
        const state = response.data;
        console.log('');
        console.log('📊 System Status:');
        console.log(`   Session ID: ${state.sessionId}`);
        console.log(`   Project: ${state.projectDir}`);
        console.log(`   Agents: ${state.agents.length}`);
        console.log(`   Current Agent: ${this.currentAgent ? this.currentAgent.name : 'None'}`);
        console.log('');
        
        if (state.agents.length > 0) {
          console.log('🤖 Active Agents:');
          for (const agent of state.agents) {
            const status = agent.isPaused ? `${agent.status} (until ${agent.pausedUntil})` : agent.status;
            console.log(`   ${agent.id}: ${agent.name} (${status})`);
          }
          console.log('');
        }
      } else {
        console.error('❌ Failed to get status:', response.error);
      }
      
    } catch (error) {
      console.error('❌ Status command failed:', error.message);
    }
  }

  /**
   * List all agents
   * @private
   */
  async listAgents() {
    try {
      const request = {
        interface: INTERFACE_TYPES.CLI,
        sessionId: this.sessionId,
        action: ORCHESTRATOR_ACTIONS.LIST_AGENTS,
        payload: {},
        projectDir: process.cwd()
      };
      
      const response = await this.orchestrator.processRequest(request);
      
      if (response.success) {
        const agents = response.data;
        console.log('');
        
        if (agents.length === 0) {
          console.log('📭 No agents created yet');
          console.log('   Use /create <name> to create your first agent');
        } else {
          console.log('🤖 Available Agents:');
          
          for (const agent of agents) {
            const current = this.currentAgent && this.currentAgent.id === agent.id ? ' (current)' : '';
            const status = agent.isPaused ? `${agent.status} (until ${agent.pausedUntil})` : agent.status;
            
            console.log(`   ${agent.id}: ${agent.name}${current}`);
            console.log(`     Status: ${status}`);
            console.log(`     Model: ${agent.currentModel}`);
            console.log(`     Messages: ${agent.messageCount}`);
            console.log('');
          }
        }
        
      } else {
        console.error('❌ Failed to list agents:', response.error);
      }
      
    } catch (error) {
      console.error('❌ List agents command failed:', error.message);
    }
  }

  /**
   * Create a new agent
   * @private
   */
  async createAgent(args) {
    if (args.length === 0) {
      console.log('❌ Usage: /create <agent-name> [model]');
      return;
    }
    
    const name = args[0];
    const model = args[1] || 'anthropic-sonnet';
    
    console.log(`🔨 Creating agent "${name}" with model ${model}...`);
    
    try {
      const request = {
        interface: INTERFACE_TYPES.CLI,
        sessionId: this.sessionId,
        action: ORCHESTRATOR_ACTIONS.CREATE_AGENT,
        payload: {
          name,
          systemPrompt: `You are ${name}, an AI assistant created in the OnBuzz Community system. You can help with coding, analysis, and various tasks using the available tools.`,
          model,
          capabilities: ['terminal', 'filesystem', 'agentdelay', 'browser']
        },
        projectDir: process.cwd()
      };
      
      const response = await this.orchestrator.processRequest(request);
      
      if (response.success) {
        const agent = response.data;
        this.currentAgent = agent;
        
        console.log('✅ Agent created successfully!');
        console.log(`   ID: ${agent.id}`);
        console.log(`   Name: ${agent.name}`);
        console.log(`   Model: ${agent.preferredModel}`);
        console.log('   Switched to this agent automatically');
        
        // Update prompt
        this.rl.setPrompt(this.getPrompt());
        
      } else {
        console.error('❌ Failed to create agent:', response.error);
      }
      
    } catch (error) {
      console.error('❌ Create agent command failed:', error.message);
    }
  }

  /**
   * Switch to different agent
   * @private
   */
  async switchAgent(args) {
    if (args.length === 0) {
      console.log('❌ Usage: /switch <agent-id>');
      return;
    }
    
    const agentId = args[0];
    
    try {
      // First, get the agent to verify it exists
      const request = {
        interface: INTERFACE_TYPES.CLI,
        sessionId: this.sessionId,
        action: ORCHESTRATOR_ACTIONS.GET_AGENT_STATUS,
        payload: { agentId },
        projectDir: process.cwd()
      };
      
      const response = await this.orchestrator.processRequest(request);
      
      if (response.success) {
        this.currentAgent = response.data;
        console.log(`✅ Switched to agent: ${this.currentAgent.name} (${this.currentAgent.id})`);
        
        // Update prompt
        this.rl.setPrompt(this.getPrompt());
        
      } else {
        console.error('❌ Failed to switch agent:', response.error);
      }
      
    } catch (error) {
      console.error('❌ Switch agent command failed:', error.message);
    }
  }

  /**
   * Pause an agent
   * @private
   */
  async pauseAgent(args) {
    if (args.length === 0) {
      console.log('❌ Usage: /pause <agent-id> [duration] [reason]');
      return;
    }
    
    const agentId = args[0];
    const duration = parseInt(args[1]) || 60;
    const reason = args.slice(2).join(' ') || 'Manual pause from CLI';
    
    try {
      const request = {
        interface: INTERFACE_TYPES.CLI,
        sessionId: this.sessionId,
        action: ORCHESTRATOR_ACTIONS.PAUSE_AGENT,
        payload: { agentId, duration, reason },
        projectDir: process.cwd()
      };
      
      const response = await this.orchestrator.processRequest(request);
      
      if (response.success) {
        console.log(`✅ Agent paused for ${duration} seconds`);
        console.log(`   Reason: ${reason}`);
      } else {
        console.error('❌ Failed to pause agent:', response.error);
      }
      
    } catch (error) {
      console.error('❌ Pause agent command failed:', error.message);
    }
  }

  /**
   * Resume a paused agent
   * @private
   */
  async resumeAgent(args) {
    if (args.length === 0) {
      console.log('❌ Usage: /resume <agent-id>');
      return;
    }
    
    const agentId = args[0];
    
    try {
      const request = {
        interface: INTERFACE_TYPES.CLI,
        sessionId: this.sessionId,
        action: ORCHESTRATOR_ACTIONS.RESUME_AGENT,
        payload: { agentId },
        projectDir: process.cwd()
      };
      
      const response = await this.orchestrator.processRequest(request);
      
      if (response.success) {
        console.log('✅ Agent resumed successfully');
      } else {
        console.error('❌ Failed to resume agent:', response.error);
      }
      
    } catch (error) {
      console.error('❌ Resume agent command failed:', error.message);
    }
  }

  /**
   * Show command history
   * @private
   */
  async showHistory() {
    console.log('');
    console.log('📜 Command History:');
    
    if (this.commandHistory.length === 0) {
      console.log('   No commands executed yet');
    } else {
      const recent = this.commandHistory.slice(-10); // Show last 10 commands
      
      for (let i = 0; i < recent.length; i++) {
        const entry = recent[i];
        const time = new Date(entry.timestamp).toLocaleTimeString();
        console.log(`   ${i + 1}. [${time}] ${entry.command}`);
      }
      
      if (this.commandHistory.length > 10) {
        console.log(`   ... and ${this.commandHistory.length - 10} more commands`);
      }
    }
    
    console.log('');
  }

  /**
   * Clear screen
   * @private
   */
  async clearScreen() {
    console.clear();
    this.showWelcome();
  }

  /**
   * Exit the CLI and terminate the server
   * @private
   */
  async exit() {
    if (this.isRunning) {
      console.log('\n👋 Goodbye!');
      this.isRunning = false;

      if (this.rl) {
        this.rl.close();
      }

      // Trigger graceful shutdown by emitting SIGINT
      // This allows the application's shutdown handlers to run
      process.emit('SIGINT');
    }
  }

  /**
   * Get command prompt
   * @private
   */
  getPrompt() {
    const agentName = this.currentAgent ? this.currentAgent.name : 'no-agent';
    return `onbuzz:${agentName}> `;
  }

  /**
   * Shutdown the CLI interface
   * @returns {Promise<void>}
   */
  async shutdown() {
    await this.exit();
  }
}

export default CLIInterface;
