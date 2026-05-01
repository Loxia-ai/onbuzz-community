# Flows Feature - Implementation Plan

## Overview

**Flows** is a visual DAG (Directed Acyclic Graph) editor for orchestrating AI agent pipelines where output from one agent becomes input for the next.

### Example Flow
```
Prompt -> Pilot1 (Architect) -> Pilot2 (API Engineer) -> Pilot3 (Frontend) -> Pilot5 (QA) -> END
                                        |
                                     Pilot4 (Backend) -> Pilot6 (QA) -> END
```

### Recommended Library: **React Flow (@xyflow/react)**
- Industry standard for React workflow editors (2M+ weekly downloads)
- Built-in drag-drop, zoom, pan, minimap
- TypeScript support, excellent performance

---

## Architecture: Integrated with Existing System

### Integration Diagram
```
┌─────────────────────────────────────────────────────────┐
│                      FlowExecutor                        │
│  - Parses DAG, determines execution order               │
│  - Tracks node states, manages flow context             │
│  - Listens for completion events                        │
└────────────────────────┬────────────────────────────────┘
                         │ Queues messages with flow context
                         ▼
┌─────────────────────────────────────────────────────────┐
│                   MessageProcessor                       │
│  - Existing message queue system                        │
│  - Messages tagged: { flowId, nodeId, flowInput }       │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                    AgentScheduler                        │
│  - Existing cooperative scheduling                       │
│  - Processes flow messages like any other               │
│  - Broadcasts results via WebSocket (with flow context) │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                      AgentPool                           │
│  - Same agents used for chat AND flows                  │
│  - Agent state persists across both                     │
└─────────────────────────────────────────────────────────┘
```

### Key Integration Points

| Component | Change Required | Purpose |
|-----------|-----------------|---------|
| `MessageProcessor` | Add `metadata` field passthrough | Tag messages with flow context |
| `AgentScheduler` | Include metadata in broadcasts | Flow can track progress |
| `WebSocket` | New event: `flow_node_complete` | Dedicated flow progress events |
| `AgentPool` | None | Agents work unchanged |
| `Orchestrator` | New actions for flow CRUD/execute | Entry point for flow operations |

### Agent Locking During Flow
```javascript
// When flow starts
agent.flowLock = {
  flowId: 'flow-123',
  runId: 'run-456',
  lockedAt: timestamp,
};

// In chat UI - show warning if agent is in flow
```

---

## Phase 1: Foundation & Read-Only Visualization

**Goal:** Display flows visually, add sidebar navigation, persist flow definitions
**Testable Outcome:** Can create flow via API, see it rendered as a diagram

### 1.1 Backend - Flow Data Model & Persistence

**File:** `src/utilities/constants.js`
```javascript
ORCHESTRATOR_ACTIONS: {
  // ... existing
  CREATE_FLOW: 'create_flow',
  UPDATE_FLOW: 'update_flow',
  DELETE_FLOW: 'delete_flow',
  LIST_FLOWS: 'list_flows',
  GET_FLOW: 'get_flow',
}
```

**Flow Schema:**
```javascript
{
  id: 'flow-{uuid}',
  name: string,
  description: string,
  nodes: [
    {
      id: 'node-{uuid}',
      type: 'agent' | 'input' | 'output' | 'condition',
      label: string,
      agentId?: string,        // For agent nodes
      position: { x, y },
      config: {
        inputMapping: {},      // How to map previous outputs to this input
        outputKey: string,     // Key name for this node's output
        promptTemplate: string,// Template with {{variables}}
      }
    }
  ],
  edges: [
    {
      id: 'edge-{uuid}',
      source: 'node-id',
      target: 'node-id',
      sourceHandle?: string,   // For conditional branches
      label?: string,
    }
  ],
  variables: {},               // Flow-level variables
  createdAt: timestamp,
  updatedAt: timestamp,
}
```

**Persistence:** `~/.local/share/loxia-autopilot/state/flows/flow-{id}.json`

### 1.2 Backend - REST Endpoints

**File:** `src/interfaces/webServer.js`
```
GET    /api/flows              - List all flows
POST   /api/flows              - Create flow
GET    /api/flows/:flowId      - Get flow details
PUT    /api/flows/:flowId      - Update flow
DELETE /api/flows/:flowId      - Delete flow
```

### 1.3 Frontend - Store & API Client

**File:** `web-ui/src/stores/flowsStore.js`
```javascript
{
  flows: [],
  currentFlow: null,
  loading: false,

  // Actions
  fetchFlows,
  createFlow,
  updateFlow,
  deleteFlow,
  setCurrentFlow,
}
```

### 1.4 Frontend - Navigation & Basic UI

**File:** `web-ui/src/components/Layout.jsx`
- Add "Flows" to navigation: `{ name: 'Flows', href: '/flows', icon: ShareIcon }`

**New Files:**
```
web-ui/src/components/Flows/
  ├── FlowsPage.jsx           # Main page container
  ├── FlowList.jsx            # List of flows (left panel)
  └── FlowViewer.jsx          # Read-only React Flow canvas
```

---

## Phase 2: Flow Editor - Create & Edit

**Goal:** Visual drag-drop editor to create/modify flows
**Testable Outcome:** Can visually build a flow, save it, reload it

### 2.1 Editor Components

```
web-ui/src/components/Flows/
  ├── FlowEditor.jsx          # Main editor with toolbar
  ├── FlowCanvas.jsx          # React Flow with edit capabilities
  ├── NodePalette.jsx         # Draggable node types
  ├── nodes/
  │   ├── AgentNode.jsx       # Custom node: Select agent, configure
  │   ├── InputNode.jsx       # Flow input (user prompt)
  │   ├── OutputNode.jsx      # Flow output (final result)
  │   └── ConditionNode.jsx   # Branching logic
  └── panels/
      ├── NodeProperties.jsx  # Right panel: Edit selected node
      └── FlowProperties.jsx  # Flow name, description, variables
```

### 2.2 Node Configuration

**AgentNode Properties:**
- Select agent from dropdown (loaded agents)
- Input mapping: Which previous node outputs to use
- Prompt template with variable interpolation
- Timeout configuration

### 2.3 Validation

**File:** `web-ui/src/utils/flowValidator.js`
- Check for cycles (must be DAG)
- Verify all referenced agents exist
- Validate input/output mappings

---

## Phase 3: Flow Execution - Basic

**Goal:** Execute a linear flow (no branches)
**Testable Outcome:** Run a 2-3 agent pipeline, see results flow through

### 3.1 Backend - Flow Executor

**File:** `src/core/flowExecutor.js`
```javascript
class FlowExecutor {
  constructor(flowDefinition, orchestrator) { }

  async execute(initialInput) {
    // 1. Topologically sort nodes
    // 2. For each node in order:
    //    - Gather inputs from completed upstream nodes
    //    - Queue message to agent via MessageProcessor
    //    - Wait for completion (job-done tool or response end)
    //    - Store output in execution context
    //    - Broadcast progress via WebSocket
    // 3. Return final outputs
  }

  stop() { /* Cancel execution */ }
}
```

### 3.2 New Endpoints

```
POST   /api/flows/:flowId/execute   - Start execution
POST   /api/flows/:flowId/stop      - Stop execution
GET    /api/flows/:flowId/runs      - List past runs
GET    /api/flows/:flowId/runs/:runId - Get run details
```

### 3.3 Execution State

```javascript
{
  runId: 'run-{uuid}',
  flowId: 'flow-{uuid}',
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped',
  nodeStates: {
    'node-1': {
      status: 'completed',
      input: { ... },
      output: { ... },
    },
  },
}
```

### 3.4 Frontend - Execution UI

**Visual Feedback on Nodes:**
- Pending: Gray
- Running: Blue pulse animation
- Completed: Green checkmark
- Failed: Red X

---

## Phase 4: Advanced Execution - Branching & Parallelism

**Goal:** Support conditional branches and parallel execution

### 4.1 Conditional Routing
- ConditionNode evaluates expression against upstream output
- Routes to different downstream nodes based on result

### 4.2 Parallel Execution
- Nodes with no dependency run in parallel
- MergeNode to combine parallel outputs

---

## Phase 5: Polish & Advanced Features

### 5.1 Flow Templates
- Pre-built templates (Code Review, Documentation, etc.)
- Export/Import flows as JSON

### 5.2 Execution History
- List past runs with status
- View completed run details
- Re-run with same or modified inputs

---

## File Structure Summary

```
src/
  core/
    flowExecutor.js           # NEW: Execute flow DAGs
    flowValidator.js          # NEW: Validate flow definitions
  interfaces/
    webServer.js              # MODIFY: Add flow endpoints

web-ui/src/
  stores/
    flowsStore.js             # NEW: Flow state management
  components/
    Flows/
      FlowsPage.jsx
      FlowList.jsx
      FlowEditor.jsx
      FlowCanvas.jsx
      NodePalette.jsx
      nodes/
        AgentNode.jsx
        InputNode.jsx
        OutputNode.jsx
        ConditionNode.jsx
        MergeNode.jsx
      panels/
        NodeProperties.jsx
        FlowProperties.jsx
        ExecutionPanel.jsx
```

---

## Agent Output & Completion Mechanism

### How Agents Signal Completion: The `jobdone` Tool

Agents signal task completion using the **jobdone tool**:

```javascript
// Agent calls this when done
{
  "toolId": "jobdone",
  "actions": [{
    "action": "complete",
    "summary": "Created API spec and assigned tasks to frontend/backend teams",
    "success": true,
    "details": "Output files: api-spec.yaml, frontend-tasks.md, backend-tasks.md"
  }]
}
```

### What `jobdone` Returns

```javascript
{
  success: true,
  taskComplete: true,           // <-- FlowExecutor listens for this
  exitAutonomousMode: true,
  summary: "...",               // <-- PRIMARY OUTPUT for next node
  details: "...",               // <-- STRUCTURED DATA for next node
  successfulCompletion: true,
  metadata: {
    toolId: 'jobdone',
    agentId: 'agent-123',
    completedAt: timestamp
  }
}
```

### What Happens Internally

1. **Returns structured output** with `summary` and `details`
2. **Switches agent mode:** `AGENT` → `CHAT` (stops autonomous loop)
3. **Persists state:** `agent.lastCompletionSummary` saved
4. **Broadcasts:** `agent_mode_changed` event via WebSocket

---

## Flow Integration with Agent Output

### FlowExecutor Captures Output

```javascript
// In FlowExecutor - when processing tool results
handleToolExecution(agentId, toolResult) {
  if (toolResult.toolId === 'jobdone' && toolResult.taskComplete) {
    const nodeId = this.getNodeForAgent(agentId);

    // Capture output for this node
    this.nodeStates[nodeId] = {
      status: 'completed',
      output: {
        summary: toolResult.summary,
        details: toolResult.details,
        success: toolResult.successfulCompletion,
        completedAt: toolResult.metadata.completedAt,
      }
    };

    // Advance flow to next nodes
    this.advanceExecution();
  }
}
```

### Flow-Specific Prompt Injection

FlowExecutor injects context into agent messages for structured output:

```javascript
const flowPrompt = `
You are executing step "${node.label}" in workflow "${flow.name}".

=== INPUT FROM PREVIOUS STEP ===
${JSON.stringify(previousNodeOutput, null, 2)}

=== YOUR TASK ===
${node.config.taskDescription}

=== OUTPUT REQUIREMENTS ===
When complete, call the jobdone tool with:
- summary: One paragraph describing what you produced
- details: JSON string with structured output that the next step can use:
  {
    "deliverables": ["list of files or artifacts created"],
    "data": { /* any structured data for next step */ }
  }

Your output will be passed to: ${nextNodeNames.join(', ')}
`;
```

### Data Flow Between Nodes

```
┌──────────────┐     jobdone.summary      ┌──────────────┐
│   Node 1     │ ──────────────────────▶  │   Node 2     │
│  (Architect) │     jobdone.details      │  (Engineer)  │
└──────────────┘                          └──────────────┘

Node 1 Output:                    Node 2 Receives:
{                                 previousStep: {
  summary: "Designed API",          summary: "Designed API",
  details: {                        details: {
    endpoints: [...],                 endpoints: [...],
    schemas: {...}                    schemas: {...}
  }                                 }
}                                 }
```

---

## Testing Milestones

| Phase | Milestone | Test |
|-------|-----------|------|
| 1.1 | Flow CRUD API | `curl POST /api/flows` creates, `GET` returns |
| 1.4 | Flow visualization | Created flow renders as diagram |
| 2.1 | Drag-drop editor | Can add nodes, connect edges, save |
| 3.1 | Linear execution | 2-agent flow runs, output chains |
| 3.2 | Output capture | `jobdone` output passed to next node |
| 4.1 | Branching | Condition routes to correct branch |
| 4.2 | Parallel | Two parallel agents run simultaneously |
