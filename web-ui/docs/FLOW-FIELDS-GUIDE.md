# Flow Node Fields Guide

This guide explains what each field in the Flow Editor nodes does, how to run a flow, and where the initial input comes from.

---

## How to Run a Flow

1. **Design your flow** - Drag nodes from the palette and connect them with edges
2. **Configure nodes** - Click each node to edit its properties (see fields below)
3. **Save** - Click the "Save" button (or it auto-saves before running)
4. **Click "Run"** - A dialog appears showing:
   - **Agent status**: Which agents are loaded vs need loading
   - **Input field**: Where you type your initial input
5. **Enter your input** - Type whatever you want to process (this becomes `{{userInput}}`)
6. **Click "Run Flow"** - Unloaded agents are automatically loaded from disk
7. **Monitor progress** - Watch node status indicators and the execution panel

### Agent Auto-Loading

When you run a flow, the system automatically:
- Checks which agents are referenced in Agent nodes
- Loads any unloaded agents from disk before execution starts
- Shows you the status in the Run dialog (Loaded / Will load / Not Found)

---

## Input Node

The starting point of your flow - where user input enters the pipeline.

| Field | Purpose | What to Write |
|-------|---------|---------------|
| **Label** | Display name on the canvas | e.g., "User Request", "Initial Prompt" |
| **Prompt Template** | Wraps the user's input before passing to the first agent | Use `{{userInput}}` as a placeholder for whatever the user types when running the flow. Example: `"Please analyze this request:\n\n{{userInput}}"` |

---

## Agent Node

Represents an AI agent that processes data. You can chain multiple of these.

| Field | Purpose | What to Write |
|-------|---------|---------------|
| **Label** | Display name on the canvas | e.g., "Code Analyzer", "Summarizer" |
| **Agent** | Which loaded pilot processes this step | Select from the dropdown (must have agents loaded in Squadron HQ) |
| **Prompt Template** | Instructions sent to the selected agent | Use `{{input}}` for the previous node's output. Example: `"Review this code and suggest improvements:\n\n{{input}}"` |
| **Output Key** | Variable name for this node's result | e.g., `codeReview`, `summary`. Later nodes can reference it via `{{codeReview}}` |

---

## Output Node

The final node that formats and returns the flow's result.

| Field | Purpose | What to Write |
|-------|---------|---------------|
| **Label** | Display name on the canvas | e.g., "Final Result", "Report" |
| **Output Format** | How to format the final output | Choose: `text` (plain), `json` (structured), or `markdown` (formatted) |

---

## Template Variables

| Variable | Available In | Description |
|----------|--------------|-------------|
| `{{userInput}}` | Input Node | The text entered when running the flow |
| `{{input}}` | Agent Nodes | Output from the previous connected node (most common) |
| `{{previousOutput}}` | Agent Nodes | Alias for `{{input}}` |
| `{{<outputKey>}}` | Agent Nodes | Reference a specific node's output by its Output Key |

### How Data Flows

```
User types: "Fix this bug"
        ↓
[Input Node] uses {{userInput}}
  Output: "Fix this bug" (or wrapped in your template)
        ↓
[Agent Node 1] uses {{input}}
  {{input}} = "Fix this bug"
  Output: "The bug is caused by..."
        ↓
[Agent Node 2] uses {{input}}
  {{input}} = "The bug is caused by..."
```

**Key insight**: `{{input}}` always contains whatever the previous node produced. You don't need to think about `{{userInput}}` in Agent nodes - it's already been processed by the Input node.

---

## Example Flow

**Scenario**: A flow that takes user code, gets it reviewed, then summarized.

```
[Input Node]
  Label: "Code Input"
  Prompt Template: "{{userInput}}"
        ↓
[Agent Node 1]
  Label: "Code Reviewer"
  Agent: (select your code-focused agent)
  Prompt Template: "Review this code for bugs and improvements:\n\n{{input}}"
  Output Key: "review"
        ↓
[Agent Node 2]
  Label: "Summarizer"
  Agent: (select your summarizer agent)
  Prompt Template: "Summarize this code review in 3 bullet points:\n\n{{input}}"
  Output Key: "summary"
        ↓
[Output Node]
  Label: "Final Summary"
  Output Format: "markdown"
```

When you run this flow and enter some code, it:
1. Takes your code via `{{userInput}}`
2. Sends it to the Code Reviewer agent
3. Passes that review to the Summarizer
4. Outputs the summary in markdown format
