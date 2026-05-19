# Agent Coordination

OnBuzz agents coordinate inside one local OnBuzz runtime. The runtime owns the
agent pool, message queues, scheduler, tools, and persisted state; agents do not
need an external broker to hand work to each other.

This page covers the built-in coordination path: task lists, inter-agent
messages, delays, and completion signals.

## Mental Model

The high-level flow for a coordinated task is:

1. A user, flow, schedule, or another agent sends work to an agent.
2. `MessageProcessor` queues that work instead of executing it inline.
3. `AgentPool` stores the queued message on the target agent.
4. `AgentScheduler` wakes active agents and advances their work loop.
5. The agent calls coordination tools as needed:
   - `taskmanager` to plan and track work
   - `agentcommunication` to ask or answer another agent
   - `agentdelay` to pause while waiting
   - `jobdone` to return control when finished or blocked

The important detail: in agent mode, pending tasks are what keep an agent
eligible for scheduler cycles. Incoming user and inter-agent messages create
pending work so the agent can be picked up on the next scheduler pass.

## Coordination Tools

### `taskmanager`

The task manager is the agent's local work board. It is used by the scheduler to
decide whether an agent has useful work to do.

Common actions:

- `sync` - replace or reconcile the full task list; recommended for initial planning
- `create` - add one new task
- `update` - change task status, priority, title, or description
- `list` - inspect the current task list
- `complete` - mark one task complete
- `cancel` - stop tracking one task
- `clear` - remove completed or cancelled tasks

Task statuses are:

- `pending`
- `in_progress`
- `blocked`
- `completed`
- `cancelled`

Recommended pattern:

```json
{
  "toolId": "taskmanager",
  "actions": [{
    "type": "sync",
    "tasks": [
      {
        "title": "Review requirements",
        "status": "completed",
        "priority": "high",
        "description": "Read the user request and decide which agent owns each part."
      },
      {
        "title": "Ask reviewer for second pass",
        "status": "pending",
        "priority": "medium",
        "description": "Send a focused review request after the patch is ready."
      }
    ]
  }]
}
```

Use `sync` when the plan materially changes. Use `update` or `create` for normal
step-by-step progress.

### `agentcommunication`

Agent communication lets one active agent discover, message, and reply to other
agents in the same runtime.

Common actions:

- `get-available-agents` - list active agents the caller can message
- `send-message` - start a message thread
- `reply-to-message` - reply inside an existing thread
- `get-unreplied-messages` - list messages that still need attention
- `mark-conversation-ended` - close a conversation thread

The recipient must be a full agent ID returned by `get-available-agents`.

Example:

```json
{
  "toolId": "agentcommunication",
  "actions": [{
    "type": "send-message",
    "recipient": "agent-reviewer-1234567890",
    "subject": "Review API error handling",
    "message": "Please inspect the provider error normalization path and reply with risks only.",
    "priority": "normal",
    "requiresReply": true
  }]
}
```

`requiresReply` defaults to true. Set it to false for notifications where the
sender does not need a response; this helps avoid unnecessary reply loops.
JSON tool calls may use camelCase fields such as `requiresReply`, `messageId`,
and `conversationId`; XML-style tags may use the existing kebab-case names.

### `agentdelay`

Agent delay pauses an agent for a bounded number of seconds. Use it when the
agent is genuinely waiting for an external process, service startup, build, or
long-running tool.

Example:

```json
{
  "toolId": "agentdelay",
  "duration": 60,
  "reason": "Waiting for the development server to finish starting"
}
```

While delayed, messages can still queue for the agent. Tool results and incoming
messages can wake delayed agents when the runtime knows new work is ready.

### `jobdone`

`jobdone` tells the runtime that an autonomous task is complete, blocked, or
partially complete. It exits autonomous work and returns control to the user.

Example:

```json
{
  "toolId": "jobdone",
  "actions": [{
    "action": "complete",
    "summary": "Implemented the docs update and verified markdown links.",
    "success": true
  }]
}
```

Use `success: false` when the agent cannot proceed and needs user input,
credentials, a design decision, or a manual check.

## What Happens To Inter-Agent Messages

When one agent sends a message to another:

1. `agentcommunication` validates the sender, recipients, limits, and message.
2. It stores a message object and conversation metadata.
3. It queues the message in the recipient agent's `interAgentMessages` queue.
4. If the recipient is in agent mode, `AgentPool` auto-creates a pending task.
5. The scheduler is registered with the sender's session context so the
   recipient can resolve provider keys for its next model call.
6. The web UI receives a broadcast so the message is visible to the operator.

That means the message is both visible in the UI and actionable by the runtime.

## Safety Limits

Coordination has guardrails to reduce runaway loops:

- Maximum recipients per message
- Maximum conversation depth
- Conversation timeout
- Message retention period
- Optional broadcast configuration
- Per-agent tool config overrides via `agent.toolConfig.agentcommunication`

If a conversation hits the depth limit, the sender should end the current thread
and start a fresh, narrower one only if more work is still needed.

## Troubleshooting

If an agent cannot find another agent:

- Call `get-available-agents` first.
- Use the full returned agent ID, not the display name.
- Check whether the target agent is paused or inactive.

If a recipient does not answer:

- Check whether the original message had `requiresReply: true`.
- Ask the recipient to run `get-unreplied-messages`.
- Confirm the recipient is in agent mode or has pending work.
- Check whether the recipient is paused by `agentdelay`.

If agents are looping:

- Use `requiresReply: false` for one-way notifications.
- Ask one participant to call `mark-conversation-ended`.
- Send a narrower message with one explicit requested output.
- Prefer `taskmanager` updates over repeated status messages.

If an agent keeps running after the work is done:

- Ensure all active tasks are marked `completed` or `cancelled`.
- Call `jobdone` with a clear summary.

## Source Map

Key runtime files:

- `src/core/messageProcessor.js` - queues user and inter-agent messages
- `src/core/agentPool.js` - stores queues, creates tasks from incoming messages
- `src/core/agentScheduler.js` - advances active agents
- `src/tools/taskManagerTool.js` - task list management
- `src/tools/agentCommunicationTool.js` - inter-agent messaging
- `src/tools/agentDelayTool.js` - bounded pauses
- `src/tools/jobDoneTool.js` - completion signaling
- `web-ui/src/components/toolRenderers/AgentCommunicationRenderer.jsx` - UI rendering for agent messages
