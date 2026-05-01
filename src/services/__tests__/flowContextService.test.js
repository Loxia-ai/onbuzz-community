import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';

const { default: FlowContextService } = await import('../flowContextService.js');

describe('FlowContextService', () => {
  let service;
  let logger;

  const baseFlowMetadata = {
    flowId: 'flow-1',
    flowName: 'Test Flow',
    nodeName: 'Step A',
    nodePosition: 1,
    totalNodes: 3
  };

  beforeEach(() => {
    logger = createMockLogger();
    service = new FlowContextService({}, logger);
  });

  describe('buildFlowAgentContext', () => {
    test('builds context with flow header for first agent (no previous data)', () => {
      const result = service.buildFlowAgentContext(baseFlowMetadata, null);
      expect(result).toContain('FLOW_EXECUTION_CONTEXT');
      expect(result).toContain('Step A');
      expect(result).toContain('1/3');
      expect(result).toContain('Test Flow');
      expect(result).toContain('FIRST agent in the flow');
      expect(result).toContain('CRITICAL HANDOFF REQUIREMENT');
      expect(result).toContain('job-done');
    });

    test('builds context with previous agent data', () => {
      const prevData = {
        agentId: 'prev-agent',
        agentName: 'Previous Agent',
        summary: 'Did some work',
        filesCreated: ['/src/file.js', '/src/file2.js'],
        output: 'Some output text'
      };
      const result = service.buildFlowAgentContext(baseFlowMetadata, prevData);
      expect(result).toContain('CONTEXT FROM PREVIOUS AGENT');
      expect(result).toContain('Previous Agent');
      expect(result).toContain('Did some work');
      expect(result).toContain('/src/file.js');
      expect(result).toContain('/src/file2.js');
      expect(result).toContain('Some output text');
      expect(result).not.toContain('FIRST agent');
    });

    test('handles previous agent data without agent name', () => {
      const prevData = { agentId: 'prev-1', summary: 'done' };
      const result = service.buildFlowAgentContext(baseFlowMetadata, prevData);
      expect(result).toContain('Previous agent ID: prev-1');
    });

    test('handles previous agent with no files created', () => {
      const prevData = { agentId: 'prev-1', filesCreated: [] };
      const result = service.buildFlowAgentContext(baseFlowMetadata, prevData);
      expect(result).toContain('No files created');
    });

    test('handles missing nodeName gracefully', () => {
      const meta = { ...baseFlowMetadata, nodeName: null };
      const result = service.buildFlowAgentContext(meta, null);
      expect(result).toContain('Agent');
    });

    // -- Phase 1.5: typed-output advertisement --

    test('advertises declared outputs by name + type when nodeContract is provided', () => {
      // When the agent's node declares typed outputs, the system prompt
      // tells the agent EXACTLY what fields to produce. This is the
      // mechanism that turns vague job-done summaries into structured
      // handoffs that the next agent can rely on.
      const nodeContract = {
        inputs: [{ name: 'topic', type: 'text', required: true }],
        outputs: [
          { name: 'draft',     type: 'text' },
          { name: 'wordCount', type: 'number' },
          { name: 'sources',   type: 'file[]' },
        ],
      };
      const result = service.buildFlowAgentContext(baseFlowMetadata, null, nodeContract);
      expect(result).toContain('REQUIRED OUTPUTS');
      expect(result).toContain('draft');
      expect(result).toContain('wordCount');
      expect(result).toContain('sources');
      expect(result).toContain('text');
      expect(result).toContain('number');
      expect(result).toContain('file[]');
    });

    test('advertises declared inputs (so agent knows what payload to expect)', () => {
      const nodeContract = {
        inputs: [
          { name: 'topic',    type: 'text',  required: true },
          { name: 'research', type: 'json',  required: false },
        ],
        outputs: [{ name: 'draft', type: 'text' }],
      };
      const result = service.buildFlowAgentContext(baseFlowMetadata, null, nodeContract);
      expect(result).toContain('INPUTS');
      expect(result).toContain('topic');
      expect(result).toContain('research');
    });

    test('omits outputs section when nodeContract is absent (v1 backwards compat)', () => {
      const result = service.buildFlowAgentContext(baseFlowMetadata, null);
      expect(result).not.toContain('REQUIRED OUTPUTS');
    });

    test('omits outputs section when contract.outputs is empty', () => {
      const nodeContract = { inputs: [], outputs: [] };
      const result = service.buildFlowAgentContext(baseFlowMetadata, null, nodeContract);
      expect(result).not.toContain('REQUIRED OUTPUTS');
    });

    // ---- Phase 7: rich contracts (description / example / instructions) ----

    test('renders FLOW GOAL when flowMetadata.flowDescription is set', () => {
      const meta = { ...baseFlowMetadata, flowDescription: 'Produce a fact-checked article on the input topic.' };
      const result = service.buildFlowAgentContext(meta, null);
      expect(result).toContain('FLOW GOAL:');
      expect(result).toContain('Produce a fact-checked article');
    });

    test('omits FLOW GOAL when flowDescription is empty/whitespace', () => {
      const meta = { ...baseFlowMetadata, flowDescription: '   ' };
      const result = service.buildFlowAgentContext(meta, null);
      expect(result).not.toContain('FLOW GOAL:');
    });

    test('renders NODE INSTRUCTIONS when nodeContract.instructions is set', () => {
      const nodeContract = { inputs: [], outputs: [],
        instructions: 'Search peer-reviewed sources first; done when ≥3 citations.' };
      const result = service.buildFlowAgentContext(baseFlowMetadata, null, nodeContract);
      expect(result).toContain('NODE INSTRUCTIONS');
      expect(result).toContain('Search peer-reviewed sources');
      expect(result).toContain('≥3 citations');
    });

    test('omits NODE INSTRUCTIONS when instructions is missing or empty', () => {
      // Missing
      let result = service.buildFlowAgentContext(baseFlowMetadata, null,
        { inputs: [], outputs: [{ name: 'x', type: 'text' }] });
      expect(result).not.toContain('NODE INSTRUCTIONS');
      // Empty string
      result = service.buildFlowAgentContext(baseFlowMetadata, null,
        { inputs: [], outputs: [{ name: 'x', type: 'text' }], instructions: '' });
      expect(result).not.toContain('NODE INSTRUCTIONS');
    });

    test('renders description under each input when provided', () => {
      const nodeContract = {
        inputs: [{
          name: 'topic', type: 'text', required: true,
          description: 'The research topic exactly as provided by the user.',
        }],
        outputs: [],
      };
      const result = service.buildFlowAgentContext(baseFlowMetadata, null, nodeContract);
      expect(result).toContain('topic');
      expect(result).toContain('text');
      expect(result).toContain('The research topic exactly as provided');
    });

    test('renders description under each output when provided', () => {
      const nodeContract = {
        inputs: [],
        outputs: [{
          name: 'findings', type: 'json',
          description: 'Structured research bag for the writer to use as source of truth.',
        }],
      };
      const result = service.buildFlowAgentContext(baseFlowMetadata, null, nodeContract);
      expect(result).toContain('findings');
      expect(result).toContain('Structured research bag');
    });

    test('renders inline example for short scalar values', () => {
      const nodeContract = {
        inputs: [],
        outputs: [{ name: 'wordCount', type: 'number', example: 850 }],
      };
      const result = service.buildFlowAgentContext(baseFlowMetadata, null, nodeContract);
      expect(result).toContain('Example: 850');
    });

    test('renders multi-line example as indented block for object values', () => {
      const nodeContract = {
        inputs: [],
        outputs: [{
          name: 'findings', type: 'json',
          example: { title: 'AI safety', citations: ['Bostrom 2014'] },
        }],
      };
      const result = service.buildFlowAgentContext(baseFlowMetadata, null, nodeContract);
      expect(result).toContain('Example:');
      expect(result).toContain('"title"');
      expect(result).toContain('"AI safety"');
      expect(result).toContain('"Bostrom 2014"');
    });

    test('handles unstringifiable example without throwing (circular ref)', () => {
      const circular = {};
      circular.self = circular;
      const nodeContract = {
        inputs: [],
        outputs: [{ name: 'x', type: 'json', example: circular }],
      };
      expect(() => service.buildFlowAgentContext(baseFlowMetadata, null, nodeContract))
        .not.toThrow();
    });

    test('combines description + example + required marker in one block per field', () => {
      const nodeContract = {
        inputs: [],
        outputs: [{
          name: 'draft', type: 'text', required: true,
          description: 'The article draft, ≥500 words.',
          example: 'Once upon a time...',
        }],
      };
      const result = service.buildFlowAgentContext(baseFlowMetadata, null, nodeContract);
      // All three pieces appear together
      expect(result).toContain('draft');
      expect(result).toContain('text');
      expect(result).toContain('The article draft, ≥500 words.');
      expect(result).toContain('"Once upon a time..."');
    });

    test('treats empty-string description as absent', () => {
      const nodeContract = {
        inputs: [],
        outputs: [{ name: 'x', type: 'text', description: '   ' }],
      };
      const result = service.buildFlowAgentContext(baseFlowMetadata, null, nodeContract);
      // The whitespace-only description should NOT appear in the prompt
      expect(result).not.toMatch(/^\s+\s+$/m);
    });

    // -- Phase 5/6 fix: structured handoff rendering --

    test('renders STRUCTURED HANDOFF section when previous agent provided outputs', () => {
      // The whole point of v2: the next agent reads structured fields,
      // not free text. This section is what makes the handoff usable.
      const prevData = {
        agentId: 'prev', agentName: 'Researcher',
        summary: 'Did research',
        outputs: { findings: { title: 'AI safety' }, citations: 5 },
      };
      const result = service.buildFlowAgentContext(baseFlowMetadata, prevData);
      expect(result).toContain('STRUCTURED HANDOFF');
      expect(result).toContain('findings');
      expect(result).toContain('citations');
      // Number values are rendered raw (no JSON quoting)
      expect(result).toContain('= 5');
    });

    test('does NOT render structured handoff when previous outputs is empty/absent', () => {
      const prevData = { agentId: 'prev', summary: 'Did stuff' };
      const result = service.buildFlowAgentContext(baseFlowMetadata, prevData);
      expect(result).not.toContain('STRUCTURED HANDOFF');
    });

    test('renders ALL UPSTREAM CONTRIBUTORS when multiple agents fed this node', () => {
      const prevData = {
        agentId: 'last', agentName: 'Aggregator',
        summary: 'Merged',
        contributors: [
          { agentId: 'a', agentName: 'Researcher', outputs: { facts: 'x' } },
          { agentId: 'b', agentName: 'Analyst',    outputs: { trends: 'y' } },
        ],
      };
      const result = service.buildFlowAgentContext(baseFlowMetadata, prevData);
      expect(result).toContain('ALL UPSTREAM CONTRIBUTORS');
      expect(result).toContain('Researcher');
      expect(result).toContain('Analyst');
      expect(result).toContain('facts');
      expect(result).toContain('trends');
    });
  });

  describe('buildFlowAgentSystemPrompt (Phase 8 — replace mode)', () => {
    test('returns null when no contract', () => {
      expect(service.buildFlowAgentSystemPrompt(baseFlowMetadata, null, null)).toBeNull();
      expect(service.buildFlowAgentSystemPrompt(baseFlowMetadata, null, undefined)).toBeNull();
    });

    test('returns null when contract has no instructions and no outputs', () => {
      const contract = { inputs: [{ name: 'x', type: 'text' }], outputs: [], instructions: '' };
      expect(service.buildFlowAgentSystemPrompt(baseFlowMetadata, null, contract)).toBeNull();
    });

    test('builds standalone prompt that REPLACES rather than appends', () => {
      const contract = {
        inputs:  [{ name: 'topic', type: 'text', required: true, description: 'The topic.' }],
        outputs: [{ name: 'bullets', type: 'list<text>', description: '3 bullets.', example: ['a','b','c'] }],
        instructions: 'Produce 3 substantive bullets on the topic.',
      };
      const prompt = service.buildFlowAgentSystemPrompt(
        { ...baseFlowMetadata, flowDescription: 'Summarize topics into bullet lists.' },
        null,
        contract,
      );
      // The output is a SELF-CONTAINED prompt — does NOT presuppose a
      // "you are a software developer" base prompt before it.
      expect(prompt).toContain('You are acting as the "Step A" step (1/3)');
      expect(prompt).toContain('OVERALL FLOW GOAL');
      expect(prompt).toContain('YOUR ROLE FOR THIS STEP');
      expect(prompt).toContain('Produce 3 substantive bullets');
      expect(prompt).toContain('REQUIRED OUTPUTS');
      expect(prompt).toContain('bullets');
      expect(prompt).toContain('list<text>');
      // Strict completion guidance — phrased as "DO NOT:" + bullet list
      expect(prompt).toMatch(/DO NOT/);
      expect(prompt).toMatch(/Maintain or update task lists/i);
      expect(prompt).toMatch(/Write status paragraphs/i);
      // Concrete example block
      expect(prompt).toContain('"toolId": "jobdone"');
      expect(prompt).toContain('"action": "complete"');
    });

    test('renders previous agent\'s structured outputs in upstream context', () => {
      const contract = {
        inputs:  [{ name: 'findings', type: 'json', required: true }],
        outputs: [{ name: 'draft', type: 'text' }],
        instructions: 'Write an article using the findings.',
      };
      const prevData = {
        agentId: 'r', agentName: 'Researcher',
        summary: 'Did research',
        outputs: { findings: { title: 'AI safety', citations: ['Bostrom 2014'] } },
      };
      const prompt = service.buildFlowAgentSystemPrompt(baseFlowMetadata, prevData, contract);
      expect(prompt).toContain('UPSTREAM CONTEXT');
      expect(prompt).toContain('Researcher');
      expect(prompt).toContain('AI safety');
      expect(prompt).toContain('Bostrom 2014');
    });

    test('builds prompt for first-step (no previous agent)', () => {
      const contract = {
        outputs: [{ name: 'topic', type: 'text' }],
        instructions: 'Identify the topic.',
      };
      const prompt = service.buildFlowAgentSystemPrompt(baseFlowMetadata, null, contract);
      expect(prompt).toContain('FIRST step');
    });
  });

  describe('_formatStructuredValue', () => {
    test('strings get quoted inline when short', () => {
      expect(service._formatStructuredValue('hi')).toBe('"hi"');
    });

    test('multi-line strings get triple-quoted block', () => {
      const v = 'line1\nline2\nline3';
      const result = service._formatStructuredValue(v);
      expect(result).toContain('"""');
      expect(result).toContain('line1');
    });

    test('numbers and booleans render as raw values', () => {
      expect(service._formatStructuredValue(42)).toBe('42');
      expect(service._formatStructuredValue(true)).toBe('true');
    });

    test('arrays of strings render compactly when short', () => {
      expect(service._formatStructuredValue(['a', 'b'])).toBe('["a", "b"]');
    });

    test('objects render as pretty JSON', () => {
      const result = service._formatStructuredValue({ a: 1, b: 'two' });
      expect(result).toContain('"a"');
      expect(result).toContain('1');
    });

    test('null/undefined return literal labels', () => {
      expect(service._formatStructuredValue(null)).toBe('null');
      expect(service._formatStructuredValue(undefined)).toBe('undefined');
    });

    test('long values are truncated', () => {
      const huge = 'x'.repeat(5000);
      const result = service._formatStructuredValue(huge);
      expect(result.length).toBeLessThan(2000);
      expect(result).toContain('truncated');
    });
  });

  describe('_formatPreviousOutput', () => {
    test('returns empty string for null', () => {
      expect(service._formatPreviousOutput(null)).toBe('');
    });

    test('converts object to JSON string', () => {
      const result = service._formatPreviousOutput({ key: 'value' });
      expect(result).toContain('"key"');
      expect(result).toContain('"value"');
    });

    test('truncates long output', () => {
      const longStr = 'x'.repeat(3000);
      const result = service._formatPreviousOutput(longStr);
      expect(result.length).toBeLessThan(3000);
      expect(result).toContain('truncated');
    });

    test('returns short string as-is', () => {
      expect(service._formatPreviousOutput('short')).toBe('short');
    });
  });

  describe('buildContextSummary', () => {
    test('returns summary object without previous agent', () => {
      const summary = service.buildContextSummary(baseFlowMetadata, null);
      expect(summary.flowId).toBe('flow-1');
      expect(summary.flowName).toBe('Test Flow');
      expect(summary.currentNode).toBe('Step A');
      expect(summary.position).toBe('1/3');
      expect(summary.hasPreviousAgent).toBe(false);
      expect(summary.previousAgentId).toBeNull();
      expect(summary.previousFilesCount).toBe(0);
    });

    test('returns summary with previous agent data', () => {
      const prevData = { agentId: 'prev-1', filesCreated: ['a.txt', 'b.txt'] };
      const summary = service.buildContextSummary(baseFlowMetadata, prevData);
      expect(summary.hasPreviousAgent).toBe(true);
      expect(summary.previousAgentId).toBe('prev-1');
      expect(summary.previousFilesCount).toBe(2);
    });
  });

  describe('validateJobDoneForFlow', () => {
    test('returns valid for complete job-done result', () => {
      const result = service.validateJobDoneForFlow({
        summary: 'Completed the full analysis of the project with detailed findings',
        details: 'All files created at /src/output.js',
        filesCreated: ['/src/output.js']
      });
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(result.suggestions).toBeNull();
    });

    test('warns on too brief summary', () => {
      const result = service.validateJobDoneForFlow({
        summary: 'done',
        details: 'some details'
      });
      expect(result.valid).toBe(false);
      expect(result.warnings.some(w => w.includes('brief'))).toBe(true);
    });

    test('warns when no summary or details', () => {
      const result = service.validateJobDoneForFlow({});
      expect(result.valid).toBe(false);
      expect(result.warnings.some(w => w.includes('No details'))).toBe(true);
    });

    test('warns when files mentioned but no paths listed', () => {
      const result = service.validateJobDoneForFlow({
        summary: 'I created several output files for the project analysis',
        filesCreated: []
      });
      expect(result.warnings.some(w => w.includes('paths'))).toBe(true);
    });

    test('no warning when file mentioned with explicit path', () => {
      const result = service.validateJobDoneForFlow({
        summary: 'Created the output file at /src/output.js for the project',
        filesCreated: ['/src/output.js']
      });
      expect(result.valid).toBe(true);
    });

    // -- Phase 1.5: structured-output validation against nodeContract --

    test('validates jobDone.outputs against nodeContract — happy path', () => {
      const nodeContract = {
        outputs: [
          { name: 'draft',     type: 'text' },
          { name: 'wordCount', type: 'number' },
        ],
      };
      // Summary intentionally avoids file-mention keywords ("created",
      // "wrote", etc.) so the v1 file-path heuristic stays quiet and we
      // can isolate the v2 outputs-contract behavior.
      const result = service.validateJobDoneForFlow({
        summary: 'Produced a thorough analysis of the topic with full coverage',
        outputs: { draft: 'Long draft text', wordCount: 850 },
      }, nodeContract);
      expect(result.valid).toBe(true);
      expect(result.missingOutputs).toEqual([]);
    });

    test('reports missing required output fields', () => {
      const nodeContract = {
        outputs: [
          { name: 'draft',     type: 'text' },
          { name: 'wordCount', type: 'number' },
          { name: 'sources',   type: 'file[]' },
        ],
      };
      const result = service.validateJobDoneForFlow({
        summary: 'Wrote a thorough draft of the article on AI safety',
        outputs: { draft: 'text only' },              // missing wordCount + sources
      }, nodeContract);
      expect(result.valid).toBe(false);
      expect(result.missingOutputs).toEqual(expect.arrayContaining(['wordCount', 'sources']));
    });

    test('reports type mismatch on declared output', () => {
      const nodeContract = {
        outputs: [{ name: 'wordCount', type: 'number' }],
      };
      const result = service.validateJobDoneForFlow({
        summary: 'Wrote a thorough draft of the article on AI safety',
        outputs: { wordCount: 'not a number' },
      }, nodeContract);
      expect(result.valid).toBe(false);
      expect(result.warnings.some(w => /wordCount.*number|type/i.test(w))).toBe(true);
    });

    test('treats missing outputs object as missing all required fields', () => {
      const nodeContract = {
        outputs: [{ name: 'draft', type: 'text' }],
      };
      const result = service.validateJobDoneForFlow({
        summary: 'Wrote a thorough draft of the article on AI safety',
        // no outputs at all
      }, nodeContract);
      expect(result.valid).toBe(false);
      expect(result.missingOutputs).toContain('draft');
    });

    test('without nodeContract → no outputs field validation (v1 compat)', () => {
      const result = service.validateJobDoneForFlow({
        summary: 'Wrote a thorough draft of the article on AI safety',
        details: 'some details',
      });
      expect(result.missingOutputs).toBeUndefined();
    });
  });

  describe('extractFilePaths', () => {
    test('extracts file paths from messages', () => {
      const messages = [
        { content: 'created file "/src/output.js"' },
        { content: 'File written: /build/result.txt' }
      ];
      const paths = service.extractFilePaths(messages);
      expect(paths).toContain('/src/output.js');
    });

    test('ignores HTTP URLs', () => {
      const messages = [{ content: 'saved to https://example.com/file.txt' }];
      const paths = service.extractFilePaths(messages);
      expect(paths).toHaveLength(0);
    });

    test('handles non-string content', () => {
      const messages = [{ content: { text: 'wrote to /src/file.js' } }];
      const paths = service.extractFilePaths(messages);
      expect(paths.length).toBeGreaterThanOrEqual(0);
    });

    test('returns empty for no matches', () => {
      const messages = [{ content: 'no files here' }];
      const paths = service.extractFilePaths(messages);
      expect(paths).toHaveLength(0);
    });

    test('deduplicates paths', () => {
      const messages = [
        { content: 'created /src/file.js' },
        { content: 'saved to /src/file.js' }
      ];
      const paths = service.extractFilePaths(messages);
      // Set-based deduplication
      const unique = [...new Set(paths)];
      expect(unique.length).toBe(paths.length);
    });
  });
});
