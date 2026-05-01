/**
 * AgentDelayTool - Allows agents to pause their activity for specified duration
 * 
 * Purpose:
 * - Pause agent activity during waiting periods
 * - Prevent unnecessary message exchanges
 * - Handle installation and startup delays
 * - Manage agent status during long operations
 */

import { BaseTool } from './baseTool.js';
import TagParser from '../utilities/tagParser.js';

import {
  TOOL_STATUS,
  SYSTEM_DEFAULTS,
  AGENT_STATUS
} from '../utilities/constants.js';

class AgentDelayTool extends BaseTool {
  constructor(config = {}, logger = null, agentPool = null) {
    super(config, logger);
    
    this.agentPool = agentPool;
    this.maxPauseDuration = config.maxDuration || SYSTEM_DEFAULTS.MAX_PAUSE_DURATION;
    this.minPauseDuration = config.minDuration || 1;
    
    // Tool metadata
    this.requiresProject = false;
    this.isAsync = false; // Synchronous - immediately updates agent status
  }

  /**
   * Get tool description for LLM consumption
   * @returns {string} Tool description
   */
  getDescription() {
    return `
Agent Delay Tool: Pause agent activity for a specified duration to prevent unnecessary message exchanges during waiting periods.

USAGE:
\`\`\`json
{
  "toolId": "agentdelay",
  "duration": 30,
  "reason": "Waiting for npm install to complete"
}
\`\`\`

PARAMETERS:
- duration: Number of seconds to pause (${this.minPauseDuration}-${this.maxPauseDuration}) - required
- reason: Optional explanation for the pause

USE CASES:
- After running 'npm install' or similar long-running commands
- Waiting for services to start up
- Allowing time for file system operations to complete
- Preventing rapid status checking loops
- During build processes or compilation

EXAMPLES:

1. Basic pause for 1 minute:
\`\`\`json
{
  "toolId": "agentdelay",
  "duration": 60
}
\`\`\`

2. Pause with reason:
\`\`\`json
{
  "toolId": "agentdelay",
  "duration": 120,
  "reason": "Installing dependencies"
}
\`\`\`

3. Brief pause for service startup:
\`\`\`json
{
  "toolId": "agentdelay",
  "duration": 30,
  "reason": "Waiting for server startup"
}
\`\`\`

BEHAVIOR:
The agent will be marked as '${AGENT_STATUS.PAUSED}' and will not process new messages until the duration expires.
Other agents can still send messages, but they will be queued until the agent resumes.

IMPORTANT: Use this tool judiciously. Only pause when genuinely waiting for external processes.
Maximum pause duration: ${this.maxPauseDuration} seconds (${Math.floor(this.maxPauseDuration / 60)} minutes).
    `;
  }

  /**
   * Parse parameters from tool command content
   * @param {string} content - Raw tool command content
   * @returns {Object} Parsed parameters
   */
  parseParameters(content) {
    try {
      // Extract pause-duration and reason using TagParser
      const durationMatches = TagParser.extractContent(content, 'pause-duration');
      const reasonMatches = TagParser.extractContent(content, 'reason');
      
      const duration = durationMatches.length > 0 ? parseInt(durationMatches[0], 10) : null;
      const reason = reasonMatches.length > 0 ? reasonMatches[0].trim() : 'Agent pause requested';
      
      return {
        duration,
        reason,
        rawContent: content.trim()
      };
      
    } catch (error) {
      throw new Error(`Failed to parse agent delay parameters: ${error.message}`);
    }
  }

  /**
   * Get required parameters
   * @returns {Array<string>} Array of required parameter names
   */
  getRequiredParameters() {
    return ['duration'];
  }

  /**
   * Validate parameter types
   * @param {Object} params - Parameters to validate
   * @returns {Object} Validation result
   */
  validateParameterTypes(params) {
    const errors = [];
    
    if (params.duration !== null && params.duration !== undefined) {
      if (typeof params.duration !== 'number' || isNaN(params.duration)) {
        errors.push('pause-duration must be a valid number');
      }
    }
    
    if (params.reason && typeof params.reason !== 'string') {
      errors.push('reason must be a string');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Custom parameter validation
   * @param {Object} params - Parameters to validate
   * @returns {Object} Validation result
   */
  customValidateParameters(params) {
    const errors = [];
    
    if (params.duration === null || params.duration === undefined) {
      errors.push('pause-duration is required');
    } else {
      if (params.duration < this.minPauseDuration) {
        errors.push(`pause-duration must be at least ${this.minPauseDuration} second(s)`);
      }
      
      if (params.duration > this.maxPauseDuration) {
        errors.push(`pause-duration cannot exceed ${this.maxPauseDuration} seconds (${Math.floor(this.maxPauseDuration / 60)} minutes)`);
      }
      
      if (!Number.isInteger(params.duration)) {
        errors.push('pause-duration must be a whole number of seconds');
      }
    }
    
    if (params.reason && params.reason.length > 200) {
      errors.push('reason cannot exceed 200 characters');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Execute tool with parsed parameters
   * @param {Object} params - Parsed parameters
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Execution result
   */
  async execute(params, context) {
    const { duration, reason } = params;
    const { agentId } = context;
    
    if (!agentId) {
      throw new Error('Agent ID is required for agent delay tool');
    }
    
    if (!this.agentPool) {
      throw new Error('Agent pool not available - cannot pause agent');
    }
    
    try {
      // Calculate pause end time
      const pausedUntil = new Date(Date.now() + duration * 1000);
      
      // Pause the agent via agent pool
      const pauseResult = await this.agentPool.pauseAgent(agentId, pausedUntil, reason);
      
      // Also set delayEndTime for the new scheduler architecture
      const agent = await this.agentPool.getAgent(agentId);
      if (agent) {
        agent.delayEndTime = pausedUntil.toISOString();
        await this.agentPool.persistAgentState(agentId);
      }
      
      if (!pauseResult.success) {
        throw new Error(`Failed to pause agent: ${pauseResult.message || 'Unknown error'}`);
      }
      
      const result = {
        success: true,
        action: 'agent-pause',
        agentId,
        pauseDuration: duration,
        pausedUntil: pausedUntil.toISOString(),
        reason,
        message: `Agent will resume activity in ${duration} second${duration !== 1 ? 's' : ''}`,
        resumeTime: this.formatResumeTime(pausedUntil),
        toolUsed: 'agent-delay'
      };
      
      this.logger?.info(`Agent paused via agent-delay tool: ${agentId}`, {
        duration,
        reason,
        pausedUntil: pausedUntil.toISOString(),
        toolUsage: true
      });
      
      return result;
      
    } catch (error) {
      this.logger?.error(`Agent delay tool execution failed: ${error.message}`, {
        agentId,
        duration,
        reason,
        error: error.stack
      });
      
      throw error;
    }
  }

  /**
   * Get supported actions for this tool
   * @returns {Array<string>} Array of supported action names
   */
  getSupportedActions() {
    return ['pause', 'delay'];
  }

  /**
   * Get parameter schema for validation
   * @returns {Object} Parameter schema
   */
  getParameterSchema() {
    return {
      type: 'object',
      properties: {
        duration: {
          type: 'integer',
          minimum: this.minPauseDuration,
          maximum: this.maxPauseDuration,
          description: 'Number of seconds to pause agent activity'
        },
        reason: {
          type: 'string',
          maxLength: 200,
          description: 'Optional reason for the pause'
        }
      },
      required: ['duration']
    };
  }

  /**
   * Get tool capabilities metadata
   * @returns {Object} Enhanced capabilities object
   */
  getCapabilities() {
    const baseCapabilities = super.getCapabilities();
    
    return {
      ...baseCapabilities,
      pauseRange: {
        min: this.minPauseDuration,
        max: this.maxPauseDuration,
        unit: 'seconds'
      },
      affects: 'agent-status',
      interactsWithAgentPool: true,
      useCases: [
        'installation-waiting',
        'service-startup',
        'file-operations',
        'build-processes',
        'compilation',
        'deployment-delays'
      ]
    };
  }

  /**
   * Format resume time for human readability
   * @private
   */
  formatResumeTime(resumeDate) {
    const now = new Date();
    const diffSeconds = Math.round((resumeDate.getTime() - now.getTime()) / 1000);
    
    if (diffSeconds < 60) {
      return `in ${diffSeconds} second${diffSeconds !== 1 ? 's' : ''}`;
    } else if (diffSeconds < 3600) {
      const minutes = Math.round(diffSeconds / 60);
      return `in ${minutes} minute${minutes !== 1 ? 's' : ''}`;
    } else {
      const hours = Math.round(diffSeconds / 3600);
      return `in ${hours} hour${hours !== 1 ? 's' : ''}`;
    }
  }

  /**
   * Get usage examples for documentation
   * @returns {Array<Object>} Array of usage examples
   */
  getUsageExamples() {
    return [
      {
        title: 'Basic pause for 30 seconds',
        command: `[tool id="agentdelay"]
<pause-duration>30</pause-duration>
[/tool]`,
        description: 'Simple 30-second pause without specific reason'
      },
      {
        title: 'Pause during package installation',
        command: `[tool id="agentdelay"]
<pause-duration>120</pause-duration>
<reason>Waiting for npm install to complete</reason>
[/tool]`,
        description: 'Pause for 2 minutes while packages are being installed'
      },
      {
        title: 'Brief pause for service startup',
        command: `[tool id="agentdelay"]
<pause-duration>45</pause-duration>
<reason>Allowing database service to start</reason>
[/tool]`,
        description: 'Short pause to allow a service to fully initialize'
      },
      {
        title: 'Extended pause for build process',
        command: `[tool id="agentdelay"]
<pause-duration>300</pause-duration>
<reason>Waiting for large project compilation</reason>
[/tool]`,
        description: 'Maximum duration pause for lengthy build operations'
      }
    ];
  }

  /**
   * Check if agent can be paused
   * @param {string} agentId - Agent identifier
   * @returns {Promise<Object>} Check result
   */
  async canPauseAgent(agentId) {
    if (!this.agentPool) {
      return {
        canPause: false,
        reason: 'Agent pool not available'
      };
    }
    
    try {
      const agent = await this.agentPool.getAgent(agentId);
      
      if (!agent) {
        return {
          canPause: false,
          reason: 'Agent not found'
        };
      }
      
      if (agent.status === AGENT_STATUS.PAUSED) {
        return {
          canPause: false,
          reason: 'Agent is already paused',
          pausedUntil: agent.pausedUntil
        };
      }
      
      return {
        canPause: true,
        currentStatus: agent.status
      };
      
    } catch (error) {
      return {
        canPause: false,
        reason: `Error checking agent status: ${error.message}`
      };
    }
  }

  /**
   * Get pause recommendations based on context
   * @param {Object} context - Execution context
   * @returns {Object} Pause recommendations
   */
  getPauseRecommendations(context) {
    const recommendations = {
      suggested: [],
      warnings: []
    };
    
    // Analyze context for pause suggestions
    if (context.lastCommand && typeof context.lastCommand === 'string') {
      const command = context.lastCommand.toLowerCase();
      
      if (command.includes('npm install') || command.includes('yarn install')) {
        recommendations.suggested.push({
          duration: 90,
          reason: 'Package installation typically takes 1-2 minutes',
          confidence: 'high'
        });
      }
      
      if (command.includes('docker build') || command.includes('docker run')) {
        recommendations.suggested.push({
          duration: 120,
          reason: 'Docker operations often require extended time',
          confidence: 'medium'
        });
      }
      
      if (command.includes('make') || command.includes('build') || command.includes('compile')) {
        recommendations.suggested.push({
          duration: 180,
          reason: 'Build/compilation processes can be time-intensive',
          confidence: 'medium'
        });
      }
      
      if (command.includes('git clone') || command.includes('git pull')) {
        recommendations.suggested.push({
          duration: 30,
          reason: 'Git operations usually complete quickly',
          confidence: 'high'
        });
      }
    }
    
    // Add warnings for very short or long pauses
    if (context.requestedDuration) {
      if (context.requestedDuration < 10) {
        recommendations.warnings.push('Very short pauses may not be necessary');
      }
      
      if (context.requestedDuration > 240) {
        recommendations.warnings.push('Consider if such a long pause is really needed');
      }
    }
    
    return recommendations;
  }

  /**
   * Enable/disable tool based on agent pool availability
   * @param {Object} agentPool - Agent pool instance
   */
  setAgentPool(agentPool) {
    this.agentPool = agentPool;
    this.isEnabled = !!agentPool;
    
    if (this.isEnabled) {
      this.logger?.info('Agent delay tool enabled with agent pool');
    } else {
      this.logger?.warn('Agent delay tool disabled - no agent pool available');
    }
  }
}

export default AgentDelayTool;