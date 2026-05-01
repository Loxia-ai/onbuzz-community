/**
 * User Prompt Tool - Interactive user questioning for agents
 *
 * Purpose:
 * - Allow agents to ask users questions during execution
 * - Support multiple question types (options, free text, multi-select)
 * - Pause agent execution while waiting for user response
 * - Return formatted responses back to the agent
 *
 * Pattern: Similar to credential vault modal interaction
 */

import { BaseTool } from './baseTool.js';
import { getPromptService } from '../services/promptService.js';
// AGENT_STATUS no longer needed — we use awaitingUserInput flag instead of status change

class UserPromptTool extends BaseTool {
  constructor(config = {}, logger = null) {
    super(config, logger);

    this.agentPool = null;
    this.webSocketManager = null;

    // Tool metadata
    this.requiresProject = false;
    this.isAsync = false; // Blocks until user responds
    this.timeout = 5 * 60 * 1000; // 5 minute timeout
  }

  /**
   * Get tool description for LLM consumption
   * @returns {string} Tool description
   */
  getDescription() {
    return `
User Prompt Tool: Ask users questions and get their input during task execution.

IMPORTANT: This tool pauses agent execution until the user responds. Use only when you need clarification or user decisions that cannot be inferred.

USAGE:
\`\`\`json
{
  "toolId": "userprompt",
  "message": "Optional context message",
  "questions": [
    {
      "id": "q1",
      "message": "Your question here?",
      "options": ["Option 1", "Option 2", "Option 3"],
      "allowFreeText": true,
      "allowWebSearch": true
    }
  ]
}
\`\`\`

PARAMETERS:
- message: (optional) Context message shown to user
- questions: Array of question objects
  - id: Question identifier (auto-generated if omitted)
  - message: The question text
  - options: Array of options (strings or objects with id/label/description)
  - allowFreeText: Allow user to type custom response (default: true)
  - allowWebSearch: Show web search icon suggesting agent research (default: true)
  - multiSelect: Allow selecting multiple options (default: false)
  - required: Whether answer is required (default: true)

EXAMPLES:

1. Simple yes/no question:
\`\`\`json
{
  "toolId": "userprompt",
  "questions": [{
    "message": "Should I proceed with the refactoring?",
    "options": ["Yes, proceed", "No, wait"],
    "allowFreeText": false
  }]
}
\`\`\`

2. Multiple choice with free text:
\`\`\`json
{
  "toolId": "userprompt",
  "message": "I found several approaches for the authentication system.",
  "questions": [{
    "id": "auth_method",
    "message": "Which authentication method should we use?",
    "options": [
      {"id": "jwt", "label": "JWT Tokens", "description": "Stateless, scalable"},
      {"id": "session", "label": "Session-based", "description": "Traditional, server-side"},
      {"id": "oauth", "label": "OAuth 2.0", "description": "Third-party integration"}
    ],
    "allowFreeText": true
  }]
}
\`\`\`

3. Multiple questions at once:
\`\`\`json
{
  "toolId": "userprompt",
  "message": "Before setting up the project, I need some preferences.",
  "questions": [
    {
      "id": "language",
      "message": "Which programming language?",
      "options": ["TypeScript", "JavaScript"],
      "allowFreeText": false
    },
    {
      "id": "styling",
      "message": "Which styling solution?",
      "options": ["Tailwind CSS", "CSS Modules", "Styled Components"],
      "allowFreeText": true
    },
    {
      "id": "features",
      "message": "Which features should be included?",
      "options": ["Authentication", "Database", "API Routes", "Testing"],
      "multiSelect": true
    }
  ]
}
\`\`\`

RESPONSE FORMAT:
The user's responses will be returned as a formatted message containing:
- Each question with the user's selected option(s) or free text response
- Web search suggestions if the user clicked the search icon

BEHAVIOR:
- Agent execution PAUSES while waiting for user response
- User sees a modal with the questions in the chat interface
- Default timeout: 5 minutes (then resumes with timeout error)
- Use sparingly - only when user input is truly necessary
    `;
  }

  /**
   * Parse parameters from tool command content
   * @param {string} content
   * @returns {Object}
   */
  parseParameters(content) {
    return content;
  }

  /**
   * Get required parameters
   * @returns {Array<string>}
   */
  getRequiredParameters() {
    return ['questions'];
  }

  /**
   * Validate parameter types
   * @param {Object} params
   * @returns {Object}
   */
  validateParameterTypes(params) {
    const errors = [];

    if (params.message && typeof params.message !== 'string') {
      errors.push('message must be a string');
    }

    if (params.questions && !Array.isArray(params.questions)) {
      errors.push('questions must be an array');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Custom parameter validation
   * @param {Object} params
   * @returns {Object}
   */
  customValidateParameters(params) {
    const errors = [];

    if (!params.questions || params.questions.length === 0) {
      errors.push('At least one question is required');
    } else if (params.questions.length > 5) {
      errors.push('Maximum 5 questions allowed per prompt');
    } else {
      for (let i = 0; i < params.questions.length; i++) {
        const q = params.questions[i];
        if (!q.message && !q.question && !q.text) {
          errors.push(`Question ${i + 1}: message is required`);
        }
      }
    }

    if (params.message && params.message.length > 500) {
      errors.push('message cannot exceed 500 characters');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Execute tool with parsed parameters
   * @param {Object} params
   * @param {Object} context
   * @returns {Promise<Object>}
   */
  async execute(params, context) {
    const { agentId, sessionId } = context;

    if (!agentId) {
      throw new Error('Agent ID is required for user prompt tool');
    }

    if (!this.webSocketManager) {
      throw new Error('WebSocket manager not available - cannot show prompt to user');
    }

    const promptService = getPromptService(this.logger);
    let agent = null;

    try {
      // Create prompt request
      const { requestInfo, promise } = promptService.createPromptRequest(
        agentId,
        {
          message: params.message,
          questions: params.questions
        },
        { timeout: this.timeout }
      );

      // Block scheduling while waiting for user input.
      // We set awaitingUserInput (checked by agentActivityService) instead of
      // changing status to PAUSED, so the agent stays visible to other agents.
      if (this.agentPool) {
        agent = await this.agentPool.getAgent(agentId);
        if (agent) {
          agent.awaitingUserInput = {
            type: 'user_prompt',
            requestId: requestInfo.requestId,
            startedAt: new Date().toISOString()
          };
          await this.agentPool.persistAgentState(agentId);
        }
      }

      // Broadcast to UI
      this.webSocketManager.broadcastToSession(sessionId, {
        type: 'user_prompt_request',
        data: {
          requestId: requestInfo.requestId,
          agentId,
          message: requestInfo.message,
          questions: requestInfo.questions,
          timeoutAt: requestInfo.timeoutAt,
          timestamp: new Date().toISOString()
        }
      });

      // Notify agent is awaiting input
      this.webSocketManager.broadcastToSession(sessionId, {
        type: 'agent_awaiting_input',
        data: {
          agentId,
          inputType: 'user_prompt',
          requestId: requestInfo.requestId,
          message: 'Waiting for user response...',
          timestamp: new Date().toISOString()
        }
      });

      this.logger?.info('[UserPromptTool] Waiting for user response', {
        requestId: requestInfo.requestId,
        agentId,
        questionCount: requestInfo.questions.length
      });

      // Wait for user response
      let result;
      try {
        result = await promise;
      } catch (error) {
        // Handle timeout or cancellation
        this._resumeAgent(agent, sessionId, false, error.message);

        if (error.message.includes('timed out')) {
          return {
            success: false,
            action: 'prompt',
            error: 'User did not respond within the timeout period',
            message: 'Prompt timed out - user did not respond in time'
          };
        }

        if (error.message.includes('cancelled')) {
          return {
            success: false,
            action: 'prompt',
            error: 'User cancelled the prompt',
            message: 'User cancelled - consider proceeding with default behavior or asking differently'
          };
        }

        throw error;
      }

      // Resume agent
      this._resumeAgent(agent, sessionId, true);

      // Format response as message
      const formattedResponse = promptService.formatResponseAsMessage(
        requestInfo,
        result.response
      );

      // CRITICAL FIX: In CHAT mode, tool results alone don't trigger processing
      // Queue the user's response as a user message to ensure continuation
      if (agent && this.agentPool && agent.mode === 'chat') {
        this.logger?.info('[UserPromptTool] CHAT mode - queueing response as user message to trigger continuation', {
          agentId,
          mode: agent.mode
        });

        // Queue the formatted response as a user message
        await this.agentPool.addUserMessage(agentId, {
          role: 'user',
          content: `[User Response to Agent Prompt]\n\n${formattedResponse}`,
          type: 'prompt-response',
          promptRequestId: requestInfo.requestId,
          timestamp: new Date().toISOString()
        });
      }

      return {
        success: true,
        action: 'prompt',
        requestId: requestInfo.requestId,
        response: result.response,
        formattedResponse,
        message: 'User responded to prompt'
      };

    } catch (error) {
      // Ensure agent is resumed on error
      this._resumeAgent(agent, sessionId, false, error.message);

      this.logger?.error('[UserPromptTool] Execution failed', {
        agentId,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Resume agent after prompt completion
   * @private
   */
  _resumeAgent(agent, sessionId, success, reason = null) {
    if (agent && this.agentPool) {
      delete agent.awaitingUserInput;
      this.agentPool.persistAgentState(agent.id).catch(err => {
        this.logger?.warn('[UserPromptTool] Failed to persist agent state', {
          agentId: agent.id,
          error: err.message
        });
      });

      // Notify UI agent is resumed
      if (this.webSocketManager && sessionId) {
        this.webSocketManager.broadcastToSession(sessionId, {
          type: 'agent_input_complete',
          data: {
            agentId: agent.id,
            inputType: 'user_prompt',
            success,
            reason,
            timestamp: new Date().toISOString()
          }
        });
      }
    }
  }

  /**
   * Get supported actions
   * @returns {Array<string>}
   */
  getSupportedActions() {
    return ['prompt', 'ask', 'question'];
  }

  /**
   * Get parameter schema
   * @returns {Object}
   */
  getParameterSchema() {
    return {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          maxLength: 500,
          description: 'Optional context message'
        },
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              message: { type: 'string' },
              options: { type: 'array' },
              allowFreeText: { type: 'boolean' },
              allowWebSearch: { type: 'boolean' },
              multiSelect: { type: 'boolean' },
              required: { type: 'boolean' }
            },
            required: ['message']
          },
          minItems: 1,
          maxItems: 5,
          description: 'Questions to ask the user'
        }
      },
      required: ['questions']
    };
  }

  /**
   * Get tool capabilities
   * @returns {Object}
   */
  getCapabilities() {
    const baseCapabilities = super.getCapabilities();

    return {
      ...baseCapabilities,
      pausesAgent: true,
      requiresUI: true,
      useCases: [
        'clarification',
        'user-preferences',
        'decision-points',
        'confirmation'
      ]
    };
  }

  /**
   * Set dependencies
   */
  setAgentPool(agentPool) {
    this.agentPool = agentPool;
  }

  setWebSocketManager(wsManager) {
    this.webSocketManager = wsManager;
    this.isEnabled = !!wsManager;
  }
}

export default UserPromptTool;
