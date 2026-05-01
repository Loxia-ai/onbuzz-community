/**
 * flowJudge unit tests — parser + prompt-builder + evaluateFlow with
 * a stubbed AI call. The actual live model behavior is exercised by
 * the e2e runner script; these tests just lock the contract of the
 * judge module so it can be evolved without breaking downstream evals.
 */

import { describe, test, expect, jest } from '@jest/globals';
import { buildJudgePrompt, parseJudgeResponse, evaluateFlow } from '../__test-utils__/flowJudge.js';

const sampleCaptured = {
  flowGoal: 'Produce a fact-checked article on the input topic.',
  userInput: 'AI safety',
  agents: [
    {
      name: 'Researcher', position: 1, totalAgents: 3,
      role: 'Search peer-reviewed sources, ≥3 citations.',
      inputs: { topic: 'AI safety' },
      outputs: { findings: { title: 'AI safety', citations: ['Bostrom 2014'] } },
      summary: 'Research complete with 3 citations.',
    },
  ],
  handoffs: [
    { edge: 'researcher.findings → writer.findings', payload: { title: 'AI safety' } },
  ],
  finalOutput: 'A fact-checked article.',
};

describe('buildJudgePrompt', () => {
  test('renders all sections in the expected order', () => {
    const prompt = buildJudgePrompt(sampleCaptured);
    expect(prompt).toContain('FLOW GOAL:');
    expect(prompt).toContain('AGENT TIMELINE');
    expect(prompt).toContain('STRUCTURED HANDOFFS');
    expect(prompt).toContain('FINAL OUTPUT:');
    // The required JSON shape is included
    expect(prompt).toContain('"passes"');
    expect(prompt).toContain('"score"');
  });

  test('truncates extremely long values to keep prompt size bounded', () => {
    const huge = { ...sampleCaptured, finalOutput: 'x'.repeat(10000) };
    const prompt = buildJudgePrompt(huge);
    expect(prompt.length).toBeLessThan(8000);
    expect(prompt).toContain('truncated');
  });

  test('handles missing handoffs gracefully', () => {
    const c = { ...sampleCaptured, handoffs: [] };
    const prompt = buildJudgePrompt(c);
    expect(prompt).not.toContain('STRUCTURED HANDOFFS');
    expect(prompt).toContain('FLOW GOAL');
  });

  test('handles missing flowGoal gracefully', () => {
    const c = { ...sampleCaptured, flowGoal: undefined };
    const prompt = buildJudgePrompt(c);
    expect(prompt).toContain('FLOW GOAL: (none declared)');
  });
});

describe('parseJudgeResponse', () => {
  test('parses a clean JSON response', () => {
    const raw = JSON.stringify({
      passes: true, score: 4,
      agents: [{ name: 'a', fulfilledRole: true, note: 'ok' }],
      handoffs: [{ edge: 'a→b', preservedInfo: true, note: 'fine' }],
      finalOutput: { meetsGoal: true, note: 'good' },
      issues: [],
    });
    const r = parseJudgeResponse(raw);
    expect(r.passes).toBe(true);
    expect(r.score).toBe(4);
    expect(r.agents).toHaveLength(1);
  });

  test('strips markdown code fences', () => {
    const raw = '```json\n{"passes":true,"score":3,"agents":[],"handoffs":[],"finalOutput":{"meetsGoal":true,"note":""},"issues":[]}\n```';
    const r = parseJudgeResponse(raw);
    expect(r.passes).toBe(true);
    expect(r.score).toBe(3);
  });

  test('extracts JSON when surrounded by prose', () => {
    const raw = 'Here is my evaluation:\n{"passes":false,"score":2,"agents":[],"handoffs":[],"finalOutput":{"meetsGoal":false,"note":"x"},"issues":["bad"]}\nHope that helps.';
    const r = parseJudgeResponse(raw);
    expect(r.passes).toBe(false);
    expect(r.issues).toEqual(['bad']);
  });

  test('returns fail-shape on empty response', () => {
    const r = parseJudgeResponse('');
    expect(r.passes).toBe(false);
    expect(r.issues[0]).toMatch(/empty/i);
  });

  test('returns fail-shape on non-JSON garbage', () => {
    const r = parseJudgeResponse('the model went off the rails completely');
    expect(r.passes).toBe(false);
    expect(r.issues[0]).toMatch(/no JSON|not valid/i);
  });

  test('normalizes missing optional fields with defaults', () => {
    const r = parseJudgeResponse('{"passes": true}');
    expect(r.passes).toBe(true);
    expect(r.score).toBe(0);
    expect(r.agents).toEqual([]);
    expect(r.handoffs).toEqual([]);
    expect(r.issues).toEqual([]);
  });
});

describe('evaluateFlow', () => {
  test('calls the injected aiCall with system + user + model', async () => {
    const aiCall = jest.fn().mockResolvedValue(JSON.stringify({
      passes: true, score: 5,
      agents: [], handoffs: [], finalOutput: { meetsGoal: true, note: '' }, issues: [],
    }));
    const r = await evaluateFlow(sampleCaptured, { model: 'Kimi-K2.6', aiCall });
    expect(aiCall).toHaveBeenCalledTimes(1);
    const args = aiCall.mock.calls[0][0];
    expect(args.system).toContain('judge');
    expect(args.user).toContain('FLOW GOAL');
    expect(args.model).toBe('Kimi-K2.6');
    expect(r.passes).toBe(true);
    expect(r.score).toBe(5);
    expect(r.raw).toContain('passes');
  });

  test('throws when aiCall not provided', async () => {
    await expect(evaluateFlow(sampleCaptured, {})).rejects.toThrow(/aiCall/i);
  });

  test('returns fail-shape when judge returns garbage', async () => {
    const aiCall = jest.fn().mockResolvedValue('lol no thanks');
    const r = await evaluateFlow(sampleCaptured, { model: 'x', aiCall });
    expect(r.passes).toBe(false);
    expect(r.issues.length).toBeGreaterThan(0);
  });
});
