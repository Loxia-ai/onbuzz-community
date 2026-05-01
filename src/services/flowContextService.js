/**
 * FlowContextService - Builds flow-aware context for agents in flow execution
 *
 * Purpose:
 * - Inject flow execution instructions into agent system prompts
 * - Pass previous agent data (summary, files created, output) to next agent
 * - Guide agents on comprehensive job-done completion
 */

class FlowContextService {
  constructor(config = {}, logger = null) {
    this.config = config;
    this.logger = logger;
  }

  /**
   * Build flow execution context to inject into agent's system prompt
   * @param {Object} flowMetadata - Current flow execution metadata
   * @param {Object} previousAgentData - Data from previous agent (if any)
   * @param {Object} [nodeContract] - v2 typed I/O { inputs, outputs }; when
   *                                  present, the system prompt advertises
   *                                  the EXACT named/typed payload the
   *                                  agent receives and must produce.
   * @returns {string} Context string to inject into system prompt
   */
  buildFlowAgentContext(flowMetadata, previousAgentData, nodeContract) {
    const sections = [];

    // Flow execution header
    sections.push(`
<FLOW_EXECUTION_CONTEXT>
You are executing step "${flowMetadata.nodeName || 'Agent'}" (${flowMetadata.nodePosition}/${flowMetadata.totalNodes}) in flow "${flowMetadata.flowName}".`);

    // Phase 7: overall flow goal — orients each agent to the bigger
    // picture so they reason about their step in context of the whole.
    if (this._hasText(flowMetadata?.flowDescription)) {
      sections.push(`
FLOW GOAL:
${flowMetadata.flowDescription.trim()}`);
    }

    // Phase 7: per-node instructions — role, working style, and
    // success criteria for THIS step. Distinct from the user prompt
    // template (which is the input message). Lives at node.data.instructions.
    if (this._hasText(nodeContract?.instructions)) {
      sections.push(`
NODE INSTRUCTIONS (your role + how to succeed at this step):
${nodeContract.instructions.trim()}`);
    }

    // Critical instruction about context isolation
    sections.push(`
CRITICAL HANDOFF REQUIREMENT:
The NEXT agent in this flow has NO ACCESS to your conversation history or any context you've built up.
Everything you learn, create, or discover must be explicitly passed via job-done.`);

    // v2: declared INPUTS — what payload the agent is receiving.
    // Phase 7: each input now optionally carries a description and an
    // example. The description tells the agent what this input
    // represents AND how to use it; the example shows concrete shape.
    if (nodeContract && Array.isArray(nodeContract.inputs) && nodeContract.inputs.length > 0) {
      const lines = nodeContract.inputs.map(i => this._renderIOEntry(i, /*required default*/ true));
      sections.push(`
INPUTS (this step receives these typed values; reference them in your reasoning):
${lines.join('\n')}`);
    }

    // v2: declared OUTPUTS — exactly what the agent must produce.
    // Phase 7 hardening: stronger framing + concrete example shape that
    // the model can mimic literally. Empirical finding: weak instruction
    // ("you MUST include outputs") + abstract placeholder (`<text value>`)
    // → models default to schema-minimum. Loud framing + concrete shape
    // dramatically improves first-pass compliance.
    if (nodeContract && Array.isArray(nodeContract.outputs) && nodeContract.outputs.length > 0) {
      const lines = nodeContract.outputs.map(o => this._renderIOEntry(o, /*required default*/ false));
      // Build a concrete example object using each field's example if
      // provided, else a typed placeholder. The agent should imitate
      // this shape literally — only the values change.
      const exampleEntries = nodeContract.outputs.map(o => {
        let exVal;
        if (o.example !== undefined && o.example !== null) {
          try { exVal = JSON.stringify(o.example); }
          catch { exVal = this._typedPlaceholder(o.type); }
        } else {
          exVal = this._typedPlaceholder(o.type);
        }
        return `      "${o.name}": ${exVal}`;
      }).join(',\n');

      sections.push(`
═══════════════════════════════════════════════════════════════
REQUIRED OUTPUTS — your job-done call MUST populate every field below
═══════════════════════════════════════════════════════════════

${lines.join('\n')}

THE ONLY VALID FORMAT for ending this task is a jobdone tool call
with this exact shape (replace example values with your real content,
keep field names and structure identical):

{
  "toolId": "jobdone",
  "actions": [{
    "action": "complete",
    "summary": "<your one-paragraph summary>",
    "outputs": {
${exampleEntries}
    }
  }]
}

Calls without the "outputs" field — or with "outputs" missing any of
the field names listed above — will be REJECTED and you will be
re-prompted. The flow CANNOT proceed without these structured outputs.
═══════════════════════════════════════════════════════════════`);
    }

    // Job-done instructions
    sections.push(`
When you complete your task, you MUST call the job-done tool with comprehensive details:
- summary: A complete summary of what you accomplished (not just "task complete")
- details: ALL information the next agent needs to continue, including:
  • Full results, findings, or output content
  • File paths of ANY files created or modified (list each explicitly)
  • Important decisions made and their rationale
  • Any warnings, caveats, or considerations for the next step
  • Context that would be lost without explicit documentation`);

    // Previous agent context (if exists)
    if (previousAgentData) {
      sections.push(`
CONTEXT FROM PREVIOUS AGENT:
${previousAgentData.agentName ? `- Previous agent: ${previousAgentData.agentName} (${previousAgentData.agentId})` : `- Previous agent ID: ${previousAgentData.agentId}`}
${previousAgentData.summary ? `- Their summary: ${previousAgentData.summary}` : ''}
${previousAgentData.filesCreated?.length > 0 ? `- Files they created/modified:\n${previousAgentData.filesCreated.map(f => `    • ${f}`).join('\n')}` : '- No files created by previous agent'}
${previousAgentData.output ? `
- Their output:
${this._formatPreviousOutput(previousAgentData.output)}` : ''}`);

      // v2: render the structured outputs bag if upstream agents
      // produced one. THIS is the handoff payload — agents downstream
      // should reason from these named fields, not from the prose
      // summary. Without this section the typed contract is invisible
      // at runtime and agents fabricate the data.
      if (previousAgentData.outputs && typeof previousAgentData.outputs === 'object'
          && Object.keys(previousAgentData.outputs).length > 0) {
        const lines = Object.entries(previousAgentData.outputs).map(([k, v]) =>
          `  • ${k} = ${this._formatStructuredValue(v)}`
        );
        sections.push(`
STRUCTURED HANDOFF FROM UPSTREAM (use these as the source of truth — not the summary):
${lines.join('\n')}`);
      }

      // If multiple agents fed this node, list contributors per-agent
      // so the model knows who produced what. Helpful for fan-in nodes.
      if (Array.isArray(previousAgentData.contributors) && previousAgentData.contributors.length > 1) {
        const blocks = previousAgentData.contributors.map(c => {
          const outs = c.outputs && Object.keys(c.outputs).length > 0
            ? Object.entries(c.outputs).map(([k, v]) => `      ${k} = ${this._formatStructuredValue(v)}`).join('\n')
            : '      (no structured outputs)';
          return `  - ${c.agentName} (${c.agentId}):\n${outs}`;
        });
        sections.push(`
ALL UPSTREAM CONTRIBUTORS (this node has multiple inputs):
${blocks.join('\n')}`);
      }
    } else {
      sections.push(`
This is the FIRST agent in the flow - you are receiving the initial user input.`);
    }

    // Closing instructions
    sections.push(`
FLOW EXECUTION RULES:
1. Focus on your specific task in this pipeline step
2. Be thorough in your job-done summary - err on the side of more detail
3. List ALL file operations explicitly (create, modify, delete)
4. Stay in agent mode after job-done in case there are follow-up questions
5. Do not assume the next agent knows anything about what you did

</FLOW_EXECUTION_CONTEXT>`);

    return sections.join('');
  }

  /**
   * Format previous agent's output for display (truncate if very long)
   * @param {string|Object} output - Previous output
   * @returns {string} Formatted output
   */
  /**
   * Phase 8 (the big one): build a STANDALONE system prompt that REPLACES
   * the agent's persisted system prompt for the duration of a flow step.
   *
   * Why: production findings showed the agent's own system prompt
   * ("You are a software developer...") fights the flow contract.
   * The agent's training pulls it toward its native role
   * (engineering, code, task lists) instead of producing the typed
   * outputs the flow declares. Appending flow context didn't beat the
   * prior identity.
   *
   * This builder produces a single self-contained prompt that defines
   * the agent's IDENTITY for this step in terms of the flow node's
   * declared role + I/O contract. The agent's tools/capabilities/model
   * stay the same — only the role-defining prose changes.
   *
   * Returns null when there's no node-level role to assert (no
   * instructions AND no typed I/O). In that case the caller falls back
   * to the legacy append-context behavior.
   *
   * @returns {string|null} the new system prompt, or null to keep native
   */
  buildFlowAgentSystemPrompt(flowMetadata, previousAgentData, nodeContract) {
    if (!nodeContract) return null;
    const hasInstructions = this._hasText(nodeContract.instructions);
    const hasOutputs      = Array.isArray(nodeContract.outputs) && nodeContract.outputs.length > 0;
    if (!hasInstructions && !hasOutputs) return null;

    const sections = [];
    sections.push(
`You are acting as the "${flowMetadata.nodeName || 'Agent'}" step (${flowMetadata.nodePosition}/${flowMetadata.totalNodes}) of the flow "${flowMetadata.flowName}".`
    );

    if (this._hasText(flowMetadata?.flowDescription)) {
      sections.push(`OVERALL FLOW GOAL:\n${flowMetadata.flowDescription.trim()}`);
    }

    if (hasInstructions) {
      sections.push(`YOUR ROLE FOR THIS STEP:\n${nodeContract.instructions.trim()}`);
    }

    sections.push(
`HOW TO COMPLETE THIS STEP — the only valid completion:
1. Read the typed inputs you receive (listed below).
2. Produce the typed outputs declared below.
3. Call the job-done tool with summary, details, AND a populated
   "outputs" object containing every required field.

DO NOT:
- Maintain or update task lists. This step has no other steps.
- Write status paragraphs. The flow is autonomous.
- Call any tool other than job-done unless it is genuinely required
  to gather data for the structured outputs.
- Defer the work. There is no human in this conversation — produce
  the outputs and finish.

The flow CANNOT proceed until you call job-done with the correct
"outputs" object. Calls that omit any required field will be rejected
and you will be asked to re-emit.`
    );

    // INPUTS — typed, with descriptions/examples
    if (Array.isArray(nodeContract.inputs) && nodeContract.inputs.length > 0) {
      const lines = nodeContract.inputs.map(i => this._renderIOEntry(i, true));
      sections.push(`INPUTS (you receive these typed values from upstream):\n${lines.join('\n')}`);
    }

    // OUTPUTS — typed, with descriptions/examples + concrete shape
    if (hasOutputs) {
      const lines = nodeContract.outputs.map(o => this._renderIOEntry(o, false));
      const exampleEntries = nodeContract.outputs.map(o => {
        let exVal;
        if (o.example !== undefined && o.example !== null) {
          try { exVal = JSON.stringify(o.example); }
          catch { exVal = this._typedPlaceholder(o.type); }
        } else {
          exVal = this._typedPlaceholder(o.type);
        }
        return `      "${o.name}": ${exVal}`;
      }).join(',\n');

      sections.push(
`REQUIRED OUTPUTS — you MUST populate every field below in job-done's "outputs":
${lines.join('\n')}

EXACT job-done call shape (replace example values; keep keys identical):
{
  "toolId": "jobdone",
  "actions": [{
    "action": "complete",
    "summary": "<one-paragraph summary of what you produced>",
    "outputs": {
${exampleEntries}
    }
  }]
}`
      );
    }

    // Previous agent context — same as in append mode but inside the
    // standalone prompt now.
    if (previousAgentData) {
      const parts = [`Previous step: ${previousAgentData.agentName || previousAgentData.agentId}.`];
      if (previousAgentData.summary) parts.push(`Their summary: ${previousAgentData.summary}`);
      if (previousAgentData.outputs && Object.keys(previousAgentData.outputs).length > 0) {
        const fields = Object.entries(previousAgentData.outputs)
          .map(([k, v]) => `  • ${k} = ${this._formatStructuredValue(v)}`)
          .join('\n');
        parts.push(`Their structured outputs (use as your source of truth):\n${fields}`);
      } else if (previousAgentData.output) {
        parts.push(`Their output:\n${this._formatPreviousOutput(previousAgentData.output)}`);
      }
      sections.push(`UPSTREAM CONTEXT:\n${parts.join('\n')}`);
    } else {
      sections.push(`This is the FIRST step. You receive the user's initial input.`);
    }

    return sections.join('\n\n');
  }

  /**
   * Phase 7 hardening helper: typed placeholder rendering for the
   * concrete example block in REQUIRED OUTPUTS. Used only when the
   * field has no `example` declared. Each placeholder is itself valid
   * JSON of the right type so the agent can copy-paste the structure.
   */
  _typedPlaceholder(type) {
    switch (type) {
      case 'text':       return '"<your text content here>"';
      case 'number':     return '0';
      case 'boolean':    return 'true';
      case 'json':       return '{ "key": "value" }';
      case 'file':       return '"/path/to/file.ext"';
      case 'file[]':     return '["/path/to/file1", "/path/to/file2"]';
      case 'list<text>': return '["item 1", "item 2", "item 3"]';
      default:           return '"<value>"';
    }
  }

  /**
   * Phase 7 helper: true when a string is present and non-empty after
   * trimming. Empty/whitespace-only descriptions are treated as absent.
   */
  _hasText(s) {
    return typeof s === 'string' && s.trim().length > 0;
  }

  /**
   * Phase 7 helper: render one input or output declaration as a multi-
   * line block:
   *
   *   • topic (text, required)
   *     The research topic exactly as provided.
   *     Example: "AI safety"
   *
   * Description and example are both optional. Required-marker policy
   * differs slightly between inputs (default required:true) and outputs
   * (no inherent required flag) — caller passes `requiredByDefault`.
   *
   * The same description text is read by BOTH the producer (interprets
   * as "format thus") and the consumer (interprets as "expect thus").
   * That bidirectional contract is the whole point.
   */
  _renderIOEntry(entry, requiredByDefault) {
    if (!entry || typeof entry.name !== 'string') return '';
    const reqLabel = (entry.required === true)  ? ', required'
                   : (entry.required === false) ? ', optional'
                   : (requiredByDefault ? ', required' : '');
    const head = `  • ${entry.name} (${entry.type}${reqLabel})`;
    const lines = [head];
    if (this._hasText(entry.description)) {
      // Indent every line of the description by 4 spaces.
      const indented = entry.description.trim().split('\n').map(l => `    ${l}`).join('\n');
      lines.push(indented);
    }
    if (entry.example !== undefined && entry.example !== null) {
      let rendered;
      try {
        rendered = (typeof entry.example === 'string')
          ? JSON.stringify(entry.example)
          : JSON.stringify(entry.example, null, 2);
      } catch {
        rendered = '<unstringifiable example>';
      }
      // Single-line examples stay inline; multi-line get their own block.
      if (rendered.includes('\n')) {
        const indented = rendered.split('\n').map(l => `    ${l}`).join('\n');
        lines.push(`    Example:\n${indented}`);
      } else {
        lines.push(`    Example: ${rendered}`);
      }
    }
    return lines.join('\n');
  }

  /**
   * Render a structured output value compactly for the system prompt.
   * Strings are quoted, primitives are JSON-ified, arrays/objects are
   * pretty-printed and truncated. Goal: the model can READ the value
   * without it dominating the prompt.
   */
  _formatStructuredValue(v) {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    if (typeof v === 'string') {
      // Single-line: quote inline. Multi-line: truncate-and-quote.
      if (!v.includes('\n') && v.length <= 200) return JSON.stringify(v);
      const truncated = v.length > 1500 ? v.slice(0, 1500) + '\n... (truncated)' : v;
      return `"""\n${truncated}\n"""`;
    }
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) {
      if (v.length === 0) return '[]';
      if (v.every(x => typeof x === 'string') && v.length <= 10) {
        return `[${v.map(x => JSON.stringify(x)).join(', ')}]`;
      }
      const json = JSON.stringify(v, null, 2);
      return json.length > 1500 ? json.slice(0, 1500) + '\n... (truncated)' : json;
    }
    // Object
    try {
      const json = JSON.stringify(v, null, 2);
      return json.length > 1500 ? json.slice(0, 1500) + '\n... (truncated)' : json;
    } catch {
      return String(v);
    }
  }

  _formatPreviousOutput(output) {
    if (!output) return '';

    const outputStr = typeof output === 'object'
      ? JSON.stringify(output, null, 2)
      : String(output);

    // Truncate very long outputs but indicate there's more
    const maxLength = 2000;
    if (outputStr.length > maxLength) {
      return outputStr.substring(0, maxLength) + '\n... (truncated - full output was provided to you)';
    }

    return outputStr;
  }

  /**
   * Build minimal context for logging/debugging
   * @param {Object} flowMetadata - Flow metadata
   * @returns {Object} Simplified context object
   */
  buildContextSummary(flowMetadata, previousAgentData) {
    return {
      flowId: flowMetadata.flowId,
      flowName: flowMetadata.flowName,
      currentNode: flowMetadata.nodeName,
      position: `${flowMetadata.nodePosition}/${flowMetadata.totalNodes}`,
      hasPreviousAgent: !!previousAgentData,
      previousAgentId: previousAgentData?.agentId || null,
      previousFilesCount: previousAgentData?.filesCreated?.length || 0
    };
  }

  /**
   * Validate that job-done result has sufficient detail for flow handoff.
   *
   * @param {Object} jobDoneResult - The job-done tool result
   * @param {Object} [nodeContract] - v2 typed contract { outputs: [...] }.
   *   When provided, ALSO validates that jobDoneResult.outputs contains
   *   every declared output field with a type-correct value. The result
   *   gains a `missingOutputs[]` field listing field names that are
   *   absent or null.
   * @returns {Object} Validation result with warnings if insufficient
   */
  validateJobDoneForFlow(jobDoneResult, nodeContract) {
    const warnings = [];

    if (!jobDoneResult.summary || jobDoneResult.summary.length < 20) {
      warnings.push('Summary is too brief - next agent may lack necessary context');
    }

    if (!jobDoneResult.details && !jobDoneResult.summary) {
      warnings.push('No details provided - next agent will have minimal context');
    }

    // Check for file mentions without explicit paths
    const summaryText = (jobDoneResult.summary || '') + (jobDoneResult.details || '');
    const fileKeywords = ['created', 'wrote', 'saved', 'file', 'generated'];
    const hasFileMention = fileKeywords.some(kw => summaryText.toLowerCase().includes(kw));
    const hasExplicitPath = /[\/\\][\w-]+\.\w+/.test(summaryText);

    if (hasFileMention && !hasExplicitPath && (!jobDoneResult.filesCreated || jobDoneResult.filesCreated.length === 0)) {
      warnings.push('Files mentioned but no explicit paths provided - consider listing created files');
    }

    // v2: structured output validation against the node's declared contract.
    // We check presence + a basic type sanity on each declared field.
    // Type validation here is intentionally permissive (warn, don't reject
    // on type widenings) — the goal is to surface real gaps to the agent
    // so Phase 2 can re-prompt, not to reject borderline values.
    let missingOutputs;
    if (nodeContract && Array.isArray(nodeContract.outputs) && nodeContract.outputs.length > 0) {
      missingOutputs = [];
      const provided = (jobDoneResult.outputs && typeof jobDoneResult.outputs === 'object')
        ? jobDoneResult.outputs : {};
      for (const decl of nodeContract.outputs) {
        if (!decl || typeof decl.name !== 'string') continue;
        if (!(decl.name in provided) || provided[decl.name] === null || provided[decl.name] === undefined) {
          missingOutputs.push(decl.name);
          warnings.push(`Required output "${decl.name}" (${decl.type}) is missing from job-done.outputs`);
          continue;
        }
        const val = provided[decl.name];
        if (!_typeMatches(val, decl.type)) {
          warnings.push(`Output "${decl.name}" expected ${decl.type} but got ${_describeRuntimeType(val)}`);
        }
      }
    }

    const result = {
      valid: warnings.length === 0,
      warnings,
      suggestions: warnings.length > 0
        ? 'Ensure your job-done includes: detailed summary, explicit file paths, and any context the next agent needs.'
        : null
    };
    if (missingOutputs !== undefined) result.missingOutputs = missingOutputs;
    return result;
  }

  /**
   * Extract file paths from agent messages during flow execution
   * Used to auto-track files created for the next agent
   * @param {Array} messages - Agent conversation messages
   * @returns {Array<string>} Detected file paths
   */
  extractFilePaths(messages) {
    const filePaths = new Set();

    // Patterns for detecting file operations
    const patterns = [
      // Common path patterns
      /(?:created|wrote|saved|generated|modified)\s+(?:file\s+)?["']?([\/\\][\w\-\.\/\\]+\.\w+)["']?/gi,
      // Direct path mentions
      /(?:at|to|in)\s+["']?([\/\\][\w\-\.\/\\]+\.\w+)["']?/gi,
      // Tool result file paths (from file tools)
      /File\s+(?:created|written|saved):\s*([\/\\][\w\-\.\/\\]+\.\w+)/gi
    ];

    for (const message of messages) {
      const content = typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content || '');

      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const path = match[1];
          // Filter out obvious non-file paths
          if (path && !path.includes('http') && path.length > 3) {
            filePaths.add(path);
          }
        }
      }
    }

    return Array.from(filePaths);
  }
}

/**
 * Runtime type check for declared output values. Permissive on purpose:
 * we want to surface clear mismatches (number expected, string given)
 * but allow widenings (json accepts anything; text accepts numbers
 * because they'll stringify cleanly downstream).
 */
function _typeMatches(value, type) {
  if (value === null || value === undefined) return false;
  switch (type) {
    case 'text':       return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
    case 'number':     return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':    return typeof value === 'boolean';
    case 'json':       return true;
    case 'file':       return typeof value === 'string' && value.length > 0;
    case 'file[]':     return Array.isArray(value) && value.every(v => typeof v === 'string' && v.length > 0);
    case 'list<text>': return Array.isArray(value) && value.every(v => typeof v === 'string');
    default:           return true; // unknown type → don't gatekeep
  }
}

function _describeRuntimeType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

export default FlowContextService;
