# Building Tools for OnBuzz Community

This document explains how to create a new tool that plugs into the OnBuzz Community system. Follow this spec and your tool will work with the scheduler, the AI prompt system, the Web UI, and all agent modes.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  AI Model receives system prompt with tool descriptions     │
│  ↓ responds with JSON tool invocation                       │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ MessageProcessor.extractToolCommands()                 │ │
│  │  → TagParser parses JSON code blocks                   │ │
│  │  → Resolves toolId                                     │ │
│  └──────────┬─────────────────────────────────────────────┘ │
│             ↓                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ ToolsRegistry.getTool(toolId)                          │ │
│  │  → tool.parseParameters(content)                       │ │
│  │  → tool.execute(params, context)                       │ │
│  └──────────┬─────────────────────────────────────────────┘ │
│             ↓                                               │
│  Result injected into conversation as system message         │
│  Agent continues with updated context                       │
└─────────────────────────────────────────────────────────────┘
```

**Key insight:** The AI never calls your tool directly. It writes a JSON block in its response, the system parses it, calls your tool, and feeds the result back as a system message. Your tool's `getDescription()` is what teaches the AI how to use it.

---

## Step 1: Create the Tool File

Create `src/tools/myNewTool.js`. Every tool extends `BaseTool`:

```javascript
import { BaseTool } from './baseTool.js';

class MyNewTool extends BaseTool {
  constructor(config = {}, logger = null) {
    super(config, logger);

    // ── Required Properties ──────────────────────────────
    this.id = 'mynew';                // Unique tool ID (lowercase, no spaces)
                                      // This is what the AI uses in "toolId"
    this.name = 'My New Tool';        // Human-readable name
    this.description = 'One-line description for registry metadata';
    this.version = '1.0.0';

    // ── Optional Properties ──────────────────────────────
    this.capabilities = ['some-tag']; // Arbitrary tags for categorization
    this.requiresProject = false;     // true = tool needs a projectDir in context
    this.async = false;               // true = fire-and-forget execution (see "Async Tools")
    this.builtinDelay = 0;            // ms delay after execution (scheduler waits)
    this.timeout = 300000;            // ms execution timeout (default: 5 min)
  }
}
```

### The `id` Property

This is the most important property. It must:
- Be unique across all tools
- Be lowercase with no spaces (hyphens OK: `my-tool`)
- Match what the AI writes in `"toolId": "mynew"`
- Match what appears in the agent's `capabilities` array
- Match what appears in `ToolsSelectorDropdown.jsx` (for UI toggle)

---

## Step 2: Implement `getDescription()`

This method returns the text that gets injected into the AI's system prompt. It is the **only way** the AI learns about your tool. Write it like you're explaining the tool to a developer who will use it via JSON.

```javascript
getDescription() {
  return `
My New Tool: Brief explanation of what this tool does.

USAGE:
\`\`\`json
{
  "toolId": "mynew",
  "actions": [{
    "action": "do-something",
    "param1": "value",
    "param2": 42
  }]
}
\`\`\`

ACTIONS:

1. do-something - Explain what this action does
   - param1 (required): What this parameter controls
   - param2 (optional, default: 10): Numeric parameter

2. do-other-thing - Another action
   - input (required): The input data

EXAMPLES:

1. Basic usage:
\`\`\`json
{
  "toolId": "mynew",
  "actions": [{
    "action": "do-something",
    "param1": "hello world",
    "param2": 5
  }]
}
\`\`\`

2. Another example:
\`\`\`json
{
  "toolId": "mynew",
  "actions": [{
    "action": "do-other-thing",
    "input": "process this data"
  }]
}
\`\`\`

NOTES:
- Important constraints or limitations
- When to use vs when not to use
  `.trim();
}
```

### Description Guidelines

- **Be explicit about JSON structure.** The AI copies your examples.
- **Show 2-3 concrete examples.** More examples = more reliable invocations.
- **Document every parameter** with type, required/optional, and default value.
- **Use the `actions` array pattern** if your tool has multiple operations. Use flat `parameters` if it has only one.
- **State constraints clearly** (max values, allowed formats, etc).

---

## Step 3: Implement `parseParameters(content)`

This method converts raw content from the AI's response into a structured parameters object. In practice, JSON tool invocations are already parsed by TagParser before reaching your tool, so this is mainly a fallback for edge cases.

```javascript
parseParameters(content) {
  // content is typically already an object (parsed JSON from TagParser)
  if (typeof content === 'object' && content !== null) {
    return content;
  }

  // Fallback: try to parse as JSON string
  try {
    return JSON.parse(content);
  } catch {
    // Last resort: treat entire content as a single parameter
    return {
      actions: [{
        action: 'default-action',
        input: content.trim()
      }]
    };
  }
}
```

For most tools, the above pattern is sufficient. The system handles JSON parsing upstream.

---

## Step 4: Implement `execute(params, context)`

This is where your tool does its work.

### Parameters

```javascript
async execute(params, context = {}) {
  // params: The parsed parameters object (output of parseParameters)
  //   Typically: { actions: [{ action: 'do-something', param1: 'value' }] }
  //   Or:        { action: 'do-something', param1: 'value' }

  // context: Runtime information about the calling agent
  //   context.agentId          - Agent ID (string)
  //   context.sessionId        - Web session ID (string)
  //   context.projectDir       - Working directory (string)
  //   context.directoryAccess  - Directory permissions (object)
  //   context.agentPool        - AgentPool instance
  //   context.aiService        - AIService instance (for LLM calls)
  //   context.messageProcessor - MessageProcessor instance
  //   context.wasRepaired      - true if JSON was auto-repaired
  //   context.wasTruncated     - true if input was truncated
}
```

### Return Value

Return an object. It gets serialized to JSON and injected into the agent's conversation as a system message.

```javascript
// Success
return {
  success: true,
  output: 'Human-readable summary of what happened',
  data: { /* structured data the AI can reference */ }
};

// Failure
return {
  success: false,
  error: 'What went wrong',
  output: 'Explanation the AI can act on'
};
```

The `output` field is what the AI "reads" as the tool's response. Make it descriptive enough for the AI to understand what happened and decide next steps.

### Full Example

```javascript
async execute(params, context = {}) {
  try {
    const { actions } = params;

    if (!actions || !Array.isArray(actions) || actions.length === 0) {
      throw new Error('Actions array is required');
    }

    const action = actions[0];

    switch (action.action) {
      case 'do-something':
        return await this._handleDoSomething(action, context);

      case 'do-other-thing':
        return await this._handleDoOtherThing(action, context);

      default:
        throw new Error(`Unknown action: ${action.action}. Supported: do-something, do-other-thing`);
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      output: `MyNew tool failed: ${error.message}`
    };
  }
}

async _handleDoSomething(action, context) {
  const { param1, param2 = 10 } = action;

  if (!param1) {
    throw new Error('param1 is required');
  }

  // ... do actual work ...

  return {
    success: true,
    output: `Processed "${param1}" with intensity ${param2}`,
    result: { processed: true, value: param1 }
  };
}
```

---

## Step 5: Register the Tool

### 5a. Import and register in `src/index.js`

Add the import at the top with the other tool imports:

```javascript
import MyNewTool from './tools/myNewTool.js';
```

Add registration inside `initializeTools()`:

```javascript
async initializeTools() {
  // ... existing registrations ...

  // Register My New Tool
  await this.toolsRegistry.registerTool(MyNewTool);
}
```

### 5b. Wire up dependencies (if needed)

If your tool needs runtime services (AgentPool, WebSocketManager, AIService, etc.), add setter methods and wire them after registration:

```javascript
// In initializeTools(), after all registerTool calls:

const myNewTool = this.toolsRegistry.getTool('mynew');
if (myNewTool && typeof myNewTool.setSomeService === 'function') {
  myNewTool.setSomeService(this.someService);
}
```

See "Dependency Injection" section below for patterns.

### 5c. Add to Web UI tools list

In `web-ui/src/components/ToolsSelectorDropdown.jsx`, add your tool to the `availableCapabilities` array:

```javascript
const availableCapabilities = [
  // ... existing tools ...
  { id: 'mynew', name: 'My New Tool', description: 'What it does', category: 'Utility' }
];
```

Categories: `System`, `Automation`, `Analysis`, `Utility`, `Collaboration`, `AI Tools`

### 5d. Add to express templates (optional)

If your tool should be enabled by default for new agents, add its ID to the template arrays in `web-ui/src/components/Chat.jsx`:

```javascript
const EXPRESS_TOOLS = {
  [AGENT_TEMPLATES.CODING_ASSISTANT]: [
    // ... existing tools ...
    'mynew'
  ],
  // ...
};
```

---

## Dependency Injection

Tools are instantiated with no arguments by `registerTool()`. If your tool needs access to system services, use the setter pattern.

### Pattern: Setter Method

```javascript
class MyNewTool extends BaseTool {
  constructor(config = {}, logger = null) {
    super(config, logger);
    this.someService = null; // Will be set after registration
  }

  setSomeService(service) {
    this.someService = service;
  }

  async execute(params, context) {
    // Use injected service
    if (this.someService) {
      await this.someService.doThing();
    }

    // Or use context (always available, no injection needed)
    const agent = await context.agentPool.getAgent(context.agentId);
  }
}
```

### Available via Context (no injection needed)

These are always available in `context` during execution:

| Field | Type | Description |
|-------|------|-------------|
| `agentId` | string | Current agent ID |
| `sessionId` | string | Web session ID |
| `projectDir` | string | Agent working directory |
| `directoryAccess` | object | Directory permissions |
| `agentPool` | AgentPool | Agent lifecycle manager |
| `aiService` | AIService | Make LLM API calls |
| `messageProcessor` | MessageProcessor | Queue messages, manage conversations |
| `contextManager` | ContextManager | File context management |

### Available via Setter Injection (must wire in index.js)

Use setters when you need services that are **not** in the execution context, or when you need to hold a reference between executions:

| Service | When to Inject |
|---------|---------------|
| `AgentPool` | Modifying agent state outside of execution (e.g., pausing) |
| `WebSocketManager` | Broadcasting events to the Web UI |
| `FlowExecutor` | Signaling flow completion |
| `AIService` | Making LLM calls from the tool itself |
| `Scheduler` | Adding/removing agents from processing |

---

## Async Tools

Set `this.async = true` (or `this.isAsync = true`) if your tool performs long-running operations. The system will:

1. Start your `execute()` in the background
2. Immediately return an operation ID to the agent
3. When `execute()` resolves, queue the result back to the agent
4. The scheduler picks up the result and feeds it to the LLM

```javascript
class SlowTool extends BaseTool {
  constructor() {
    super();
    this.id = 'slow-thing';
    this.isAsync = true;       // Mark as async
    this.builtinDelay = 3000;  // Optional: scheduler waits 3s before next cycle
  }

  async execute(params, context) {
    // This runs in the background. Take as long as needed.
    const result = await someSlowOperation();

    // Return value gets queued as a tool result for the agent
    return {
      success: true,
      output: 'Operation completed',
      data: result
    };
  }
}
```

The agent receives this after completion:

```
Tool slow-thing completed successfully:
{
  "success": true,
  "output": "Operation completed",
  "data": { ... }
}
```

---

## Optional Overrides

### `getSchema()`

Return a JSON Schema for your parameters. Used by `getCapabilities()` for metadata:

```javascript
getSchema() {
  return {
    type: 'object',
    properties: {
      actions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['do-something'] },
            param1: { type: 'string', description: 'Required input' }
          },
          required: ['action', 'param1']
        }
      }
    },
    required: ['actions']
  };
}
```

### `getCapabilities()`

Return metadata about your tool for the registry and UI:

```javascript
getCapabilities() {
  return {
    id: this.id,
    name: this.name,
    description: this.description,
    version: this.version,
    capabilities: this.capabilities,
    requiresProject: this.requiresProject,
    async: this.isAsync,
    enabled: true,
    schema: this.getSchema()
  };
}
```

### `getSupportedActions()`

List the action names your tool handles:

```javascript
getSupportedActions() {
  return ['do-something', 'do-other-thing'];
}
```

---

## Checklist

When creating a new tool, make sure you've done all of the following:

| # | Item | File |
|---|------|------|
| 1 | Create tool class extending `BaseTool` | `src/tools/myNewTool.js` |
| 2 | Set `this.id` to a unique lowercase ID | `src/tools/myNewTool.js` |
| 3 | Implement `getDescription()` with examples | `src/tools/myNewTool.js` |
| 4 | Implement `parseParameters(content)` | `src/tools/myNewTool.js` |
| 5 | Implement `execute(params, context)` | `src/tools/myNewTool.js` |
| 6 | Export as default | `src/tools/myNewTool.js` |
| 7 | Import the tool class | `src/index.js` |
| 8 | Call `registerTool(MyNewTool)` in `initializeTools()` | `src/index.js` |
| 9 | Wire dependency setters (if needed) | `src/index.js` |
| 10 | Add to `availableCapabilities` array | `web-ui/src/components/ToolsSelectorDropdown.jsx` |
| 11 | Add to express templates (if default-on) | `web-ui/src/components/Chat.jsx` |

---

## Minimal Complete Example

```javascript
// src/tools/counterTool.js

import { BaseTool } from './baseTool.js';

class CounterTool extends BaseTool {
  constructor(config = {}, logger = null) {
    super(config, logger);
    this.id = 'counter';
    this.name = 'Counter';
    this.description = 'Count words, lines, or characters in text';
    this.version = '1.0.0';
    this.capabilities = ['text-analysis'];
    this.requiresProject = false;
    this.isAsync = false;
  }

  getDescription() {
    return `
Counter Tool: Count words, lines, or characters in provided text.

USAGE:
\`\`\`json
{
  "toolId": "counter",
  "actions": [{
    "action": "count",
    "text": "The text to analyze",
    "metric": "words"
  }]
}
\`\`\`

PARAMETERS:
- action: Always "count"
- text (required): The text to count
- metric (optional, default: "words"): One of "words", "lines", "characters"

EXAMPLE:
\`\`\`json
{
  "toolId": "counter",
  "actions": [{
    "action": "count",
    "text": "Hello world, this is a test.",
    "metric": "words"
  }]
}
\`\`\`
    `.trim();
  }

  parseParameters(content) {
    if (typeof content === 'object') return content;
    try { return JSON.parse(content); } catch { return { actions: [{ action: 'count', text: content }] }; }
  }

  async execute(params, context = {}) {
    try {
      const { actions } = params;
      if (!actions?.[0]) throw new Error('Actions array is required');

      const { text, metric = 'words' } = actions[0];
      if (!text) throw new Error('text is required');

      let count;
      switch (metric) {
        case 'words':      count = text.split(/\s+/).filter(Boolean).length; break;
        case 'lines':      count = text.split('\n').length; break;
        case 'characters': count = text.length; break;
        default: throw new Error(`Unknown metric: ${metric}. Use: words, lines, characters`);
      }

      return {
        success: true,
        output: `Text has ${count} ${metric}`,
        count,
        metric
      };
    } catch (error) {
      return { success: false, error: error.message, output: `Counter failed: ${error.message}` };
    }
  }

  getCapabilities() {
    return {
      id: this.id, name: this.name, description: this.description,
      version: this.version, capabilities: this.capabilities,
      requiresProject: this.requiresProject, async: this.isAsync,
      enabled: true, schema: this.getSchema()
    };
  }

  getSchema() {
    return {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['count'] },
              text: { type: 'string' },
              metric: { type: 'string', enum: ['words', 'lines', 'characters'] }
            },
            required: ['action', 'text']
          }
        }
      },
      required: ['actions']
    };
  }
}

export default CounterTool;
```

Then in `src/index.js`:

```javascript
import CounterTool from './tools/counterTool.js';

// Inside initializeTools():
await this.toolsRegistry.registerTool(CounterTool);
```

And in `web-ui/src/components/ToolsSelectorDropdown.jsx`:

```javascript
{ id: 'counter', name: 'Counter', description: 'Count words, lines, or characters', category: 'Utility' }
```
