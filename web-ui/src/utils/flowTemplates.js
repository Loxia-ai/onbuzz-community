/**
 * Starter flow templates — pre-built v2 typed flows users can load
 * with one click. Each is a complete, validated flow definition.
 *
 * The set is intentionally small and demonstrates a different
 * architectural pattern per template:
 *   - linear-research:  3-stage research → write → fact-check pipeline
 *   - code-review:      analyzer + reviewer with structured comments
 *   - rag-summarize:    fan-out summarizer + aggregator
 *   - daily-report:     scheduled fetch → analyze → format
 *   - human-approval:   propose → human-review pause → publish
 *
 * Each template has placeholder agentIds (e.g. "researcher-agent")
 * that the user wires to their own agent IDs after loading.
 */

// Layout helpers — templates render left-to-right in a grid so the
// visual editor doesn't have to compute positions itself.
const COL_W = 280;     // horizontal spacing between pipeline stages
const ROW_H = 140;     // vertical spacing for parallel branches
const TOP_Y = 100;     // baseline y for the main pipeline row
const pos = (col, row = 0) => ({ x: 60 + col * COL_W, y: TOP_Y + row * ROW_H });

export const STARTER_TEMPLATES = [
  {
    key: 'linear-research',
    label: 'Research → Write → Fact-Check',
    description: 'Three-agent pipeline: a researcher gathers sources, a writer drafts the article, a fact-checker verifies citations against sources.',
    flow: {
      name: 'Research → Write → Fact-Check',
      // Phase 7: flow.description doubles as the "FLOW GOAL" advertised
      // to every agent — orients each step toward the overall outcome.
      description: 'Produce a fact-checked article on the input topic. Every claim in the final draft must trace to a citation that the fact-checker has verified.',
      schemaVersion: 2,
      nodes: [
        { id: 'in', type: 'input', position: pos(0),
          data: { promptTemplate: '{{userInput}}' },
          inputs: [],
          outputs: [{ name: 'topic', type: 'text',
            description: 'The article topic, as provided by the user. A short phrase or question (e.g. "AI safety alignment").',
            example: 'AI safety alignment' }] },

        { id: 'researcher', type: 'agent', position: pos(1),
          data: {
            agentId: '', label: 'Researcher',
            instructions: 'Search peer-reviewed sources first; cite verifiable URLs only. You are done when findings has ≥3 citations and a clear summary.',
            promptTemplate: 'Research the topic: {{topic}}\n\nReturn structured findings (title, 2-3 sentence summary, ≥3 citations) and the source files you reviewed.',
          },
          inputs: [
            { name: 'topic', type: 'text', required: true,
              description: 'The article topic to research. Use exactly as provided.',
              example: 'AI safety alignment' },
          ],
          outputs: [
            { name: 'findings', type: 'json',
              description: 'Structured research bag. Must include: title (text — same as input topic), summary (text — 2-3 plain-English sentences), citations (list of "Author Year — URL" strings, ≥3 entries, all URLs reachable). Do not include personal commentary.',
              example: {
                title: 'AI safety alignment',
                summary: 'Alignment research focuses on ensuring AI systems pursue intended goals. The field combines specification, robustness, and assurance.',
                citations: ['Bostrom 2014 — https://example.org/superintelligence', 'Russell 2019 — https://example.org/human-compatible'],
              } },
            { name: 'sources', type: 'file[]',
              description: 'Local file paths of the source documents used. Will be passed to the fact-checker for citation verification.',
              example: ['/tmp/sources/bostrom-2014.pdf', '/tmp/sources/russell-2019.pdf'] },
          ] },

        { id: 'writer', type: 'agent', position: pos(2, -0.5),
          data: {
            agentId: '', label: 'Writer',
            instructions: 'Write a clear 500-word article. Quote citations verbatim. You are done when the draft has ≥500 words and references every citation in findings.',
            promptTemplate: 'Write a 500-word article about {{topic}}.\n\nUse the structured findings as your source of truth — paraphrase the summary, quote the citations verbatim:\n\n{{findings}}',
          },
          inputs: [
            { name: 'topic', type: 'text', required: true,
              description: 'The article topic. Mirror it in the article title.' },
            { name: 'findings', type: 'json', required: true,
              description: 'Structured research from the researcher. Shape: { title (use as your article H1), summary (paraphrase, do not copy), citations (list of "Author Year — URL" — quote each verbatim) }. Source of truth.',
              example: { title: 'AI safety alignment', summary: '...', citations: ['Bostrom 2014 — http://...'] } },
          ],
          outputs: [
            { name: 'draft', type: 'text',
              description: 'The article draft. ≥500 words, plain prose. References every citation in findings.citations exactly as written.',
              example: '# AI Safety Alignment\n\nAlignment research focuses on...\n\nAs Bostrom (2014) argues, "..."' },
          ] },

        { id: 'checker', type: 'agent', position: pos(3),
          data: {
            agentId: '', label: 'Fact-Checker',
            instructions: 'Verify every citation in draft against the actual source files. You are done when verdict is set, corrections lists every failed claim, and finalArticle is populated (draft as-is when approved; draft with a "Corrections" section appended when revision needed).',
            promptTemplate: 'Verify the article draft.\n\nDraft:\n{{draft}}\n\nSource files to check against:\n{{sources}}\n\nFor each cited claim, confirm the source supports it. Return: verdict (one word), corrections (list), and finalArticle (the draft when approved, or the draft + a "## Corrections" section listing each failed claim when not).',
          },
          inputs: [
            { name: 'draft', type: 'text', required: true,
              description: 'The article draft from the writer. Verify every cited claim.' },
            { name: 'sources', type: 'file[]', required: true,
              description: 'Source files from the researcher. Open each one to verify cited claims.' },
          ],
          outputs: [
            { name: 'verdict', type: 'text',
              description: 'One of: "approved" (all claims verified), "needs-revision" (some claims fail). Single token.',
              example: 'approved' },
            { name: 'corrections', type: 'list<text>',
              description: 'For each failed claim: a short note like "Paragraph 3 cites Russell 2019 but the source does not support X". Empty list when verdict is "approved".',
              example: ['Paragraph 3 misattributes the X claim to Russell 2019.'] },
            { name: 'finalArticle', type: 'text',
              description: 'The user-facing article. When verdict="approved", this equals the draft. When verdict="needs-revision", this is the draft with a "## Corrections" section appended listing each failed claim. THIS is what the user sees as the flow output.',
              example: '# AI Safety Alignment\n\nAlignment research focuses on...\n\n## Corrections\n- Paragraph 3 misattributes...' },
          ] },

        { id: 'out', type: 'output', position: pos(4),
          data: { outputFormat: 'markdown' },
          inputs: [{ name: 'context', type: 'text', required: true,
            description: 'The fact-checked final article (with corrections section if any). Rendered to the user as markdown.' }],
          outputs: [] },
      ],
      edges: [
        { source: 'in',         sourceField: 'topic',        target: 'researcher', targetField: 'topic' },
        { source: 'in',         sourceField: 'topic',        target: 'writer',     targetField: 'topic' },
        { source: 'researcher', sourceField: 'findings',     target: 'writer',     targetField: 'findings' },
        { source: 'writer',     sourceField: 'draft',        target: 'checker',    targetField: 'draft' },
        { source: 'researcher', sourceField: 'sources',      target: 'checker',    targetField: 'sources' },
        // Logical fix (Phase 7 audit): wire the FINAL ARTICLE to the
        // output node, not just the verdict. Previously the user saw
        // "approved" as the entire output of the flow.
        { source: 'checker',    sourceField: 'finalArticle', target: 'out',        targetField: 'context' },
      ],
      variables: {},
    },
  },
  {
    key: 'code-review',
    label: 'Code Review Pipeline',
    description: 'PR fetcher + static analyzer + reviewer agent producing structured comments {file, line, comment} that a posting node can deterministically push to GitHub.',
    flow: {
      name: 'Code Review Pipeline',
      description: 'Review a pull request: fetch the diff, run static analysis, then produce structured per-line comments a posting node can push to GitHub deterministically.',
      schemaVersion: 2,
      nodes: [
        { id: 'in', type: 'input', position: pos(0),
          data: { promptTemplate: '{{userInput}}' },
          inputs: [],
          outputs: [{ name: 'prUrl', type: 'text',
            description: 'GitHub PR URL or owner/repo#number identifier.',
            example: 'https://github.com/example/repo/pull/42' }] },
        { id: 'fetcher', type: 'agent', position: pos(1),
          data: {
            agentId: '', label: 'PR Fetcher',
            instructions: 'Fetch the PR diff and the list of changed files. Done when both diff and files are populated.',
            promptTemplate: 'Fetch the PR diff and changed files for: {{prUrl}}',
          },
          inputs: [{ name: 'prUrl', type: 'text', required: true,
            description: 'The PR URL to fetch — supports github.com/owner/repo/pull/N or owner/repo#N format.' }],
          outputs: [
            { name: 'diff', type: 'text',
              description: 'Unified-diff text of the PR. Plain text, ready for human review.',
              example: 'diff --git a/foo.js b/foo.js\n--- a/foo.js\n+++ b/foo.js\n@@ -1,3 +1,4 @@\n+const x = 1;' },
            { name: 'files', type: 'file[]',
              description: 'Local paths to the changed files (post-PR state).',
              example: ['/tmp/pr/foo.js', '/tmp/pr/bar.js'] },
          ] },
        { id: 'analyzer', type: 'agent', position: pos(2, -0.5),
          data: {
            agentId: '', label: 'Analyzer',
            instructions: 'Run static analysis (lint, security scan, type check) on each changed file. Done when findings is populated, even if empty.',
            promptTemplate: 'Run static analysis on these changed files: {{files}}\n\nReturn findings as a JSON array.',
          },
          inputs: [{ name: 'files', type: 'file[]', required: true,
            description: 'Files to analyze (from the fetcher). Run lint, security scan, and type check on each — return findings keyed by file + line.' }],
          outputs: [{ name: 'findings', type: 'json',
            description: 'Array of findings: [{ file, line, severity, message }]. severity ∈ "info"|"warn"|"error". Empty array when nothing found.',
            example: [{ file: 'foo.js', line: 12, severity: 'warn', message: 'unused variable "x"' }] }] },
        { id: 'reviewer', type: 'agent', position: pos(3),
          data: {
            agentId: '', label: 'Reviewer',
            instructions: 'Review the diff considering analyzer findings. Be specific: cite file + line for each comment. Done when approve is set and comments is populated (empty list is fine when approving cleanly).',
            promptTemplate: 'Review this PR.\n\nDiff:\n{{diff}}\n\nStatic analyzer findings:\n{{findings}}\n\nReturn: approve (boolean) and comments (list of structured per-line comments).',
          },
          inputs: [
            { name: 'diff', type: 'text', required: true,
              description: 'The PR diff (unified-diff format) to review. Read line-by-line — your comments must reference real file paths and line numbers from this diff.' },
            { name: 'findings', type: 'json', required: true,
              description: 'Static analyzer findings. Array of { file, line, severity, message } where severity ∈ "info"|"warn"|"error". Use as objective signal alongside your own judgment — empty array means analyzer found nothing.' },
          ],
          outputs: [
            { name: 'approve', type: 'boolean',
              description: 'true to approve the PR; false to request changes.',
              example: false },
            { name: 'comments', type: 'json',
              description: 'Array of per-line comments to post: [{ file, line, comment }]. Each comment is human-readable, specific, and references the diff. Empty array when approving without notes.',
              example: [{ file: 'foo.js', line: 12, comment: 'Consider naming this variable; "x" is too generic.' }] },
          ] },
        { id: 'out', type: 'output', position: pos(4),
          data: { outputFormat: 'json' },
          inputs: [{ name: 'context', type: 'text', required: true,
            description: 'Reviewer comments (the structured handoff for downstream posting).' }],
          outputs: [] },
      ],
      edges: [
        { source: 'in',       sourceField: 'prUrl',    target: 'fetcher',  targetField: 'prUrl' },
        { source: 'fetcher',  sourceField: 'files',    target: 'analyzer', targetField: 'files' },
        { source: 'fetcher',  sourceField: 'diff',     target: 'reviewer', targetField: 'diff' },
        { source: 'analyzer', sourceField: 'findings', target: 'reviewer', targetField: 'findings' },
        { source: 'reviewer', sourceField: 'comments', target: 'out',      targetField: 'context' },
      ],
      variables: {},
    },
  },
  {
    key: 'rag-summarize',
    label: 'Multi-Document RAG Summarize',
    description: 'Loader + per-document summarizer (fan-out pattern) + aggregator that merges summaries into a final brief.',
    flow: {
      name: 'Multi-Document RAG Summarize',
      description: 'Given a query, find relevant documents, summarize each one, and synthesize a final brief that answers the query with attributed sources.',
      schemaVersion: 2,
      nodes: [
        { id: 'in', type: 'input', position: pos(0),
          data: { promptTemplate: '{{userInput}}' },
          inputs: [],
          outputs: [{ name: 'query', type: 'text',
            description: 'The user\'s research query — a question or topic statement.',
            example: 'What are the best practices for AI safety alignment?' }] },
        { id: 'loader', type: 'agent', position: pos(1),
          data: {
            agentId: '', label: 'Loader',
            instructions: 'Find documents relevant to the query. Done when documents has ≥1 entry. Prefer authoritative sources over recency.',
            promptTemplate: 'Find documents relevant to this query: {{query}}\n\nReturn local file paths.',
          },
          inputs: [{ name: 'query', type: 'text', required: true,
            description: 'The query to retrieve documents for. Use it as the relevance criterion — prefer authoritative sources over recency.' }],
          outputs: [{ name: 'documents', type: 'file[]',
            description: 'Local file paths of relevant documents. Each must exist on disk so the summarizer can read it.',
            example: ['/tmp/rag/paper-1.pdf', '/tmp/rag/paper-2.md'] }] },
        { id: 'summarizer', type: 'agent', position: pos(2),
          data: {
            agentId: '', label: 'Summarizer',
            instructions: 'Read each document and produce a 3-5 sentence summary. Done when summaries.length === documents.length, in the same order.',
            promptTemplate: 'Summarize each document. Return a list of summaries in the same order as the input.\n\nDocuments:\n{{documents}}',
          },
          inputs: [{ name: 'documents', type: 'file[]', required: true,
            description: 'Documents to summarize (from the loader).' }],
          outputs: [{ name: 'summaries', type: 'list<text>',
            description: 'One summary per document, same order. Each summary 3-5 sentences, plain English, includes the source filename.',
            example: ['paper-1.pdf: This paper argues that...', 'paper-2.md: The author presents...'] }] },
        { id: 'aggregator', type: 'agent', position: pos(3),
          data: {
            agentId: '', label: 'Aggregator',
            instructions: 'Synthesize the summaries into a single brief answering the original query. Cite each source by filename.',
            promptTemplate: 'Synthesize a final brief that answers the query: {{query}}\n\nUse these summaries as source material:\n{{summaries}}',
          },
          inputs: [
            { name: 'query', type: 'text', required: false,
              description: 'Original query (for context — pass through unchanged).' },
            { name: 'summaries', type: 'list<text>', required: true,
              description: 'Summaries from the summarizer. Cite each source by filename.' },
          ],
          outputs: [{ name: 'brief', type: 'text',
            description: 'Final brief answering the query. Markdown formatted, ≥3 paragraphs, with inline source citations like (paper-1.pdf).',
            example: '# Summary\n\nResearch consensus suggests... (paper-1.pdf). Other authors argue... (paper-2.md).' }] },
        { id: 'out', type: 'output', position: pos(4),
          data: { outputFormat: 'markdown' },
          inputs: [{ name: 'context', type: 'text', required: true,
            description: 'Final synthesized brief — markdown text answering the original query with inline source citations.' }],
          outputs: [] },
      ],
      edges: [
        { source: 'in',         sourceField: 'query',     target: 'loader',     targetField: 'query' },
        { source: 'in',         sourceField: 'query',     target: 'aggregator', targetField: 'query' },
        { source: 'loader',     sourceField: 'documents', target: 'summarizer', targetField: 'documents' },
        { source: 'summarizer', sourceField: 'summaries', target: 'aggregator', targetField: 'summaries' },
        { source: 'aggregator', sourceField: 'brief',     target: 'out',        targetField: 'context' },
      ],
      variables: {},
    },
  },
  {
    key: 'daily-report',
    label: 'Daily Data Report',
    description: 'Scheduled fetch → analyze → format → publish. Versioned + observable — runs unattended overnight.',
    flow: {
      name: 'Daily Data Report',
      description: 'Fetch the day\'s metrics, find trends, format a human-readable report. Runs unattended overnight; resumable on failure.',
      schemaVersion: 2,
      nodes: [
        { id: 'in', type: 'input', position: pos(0),
          data: { promptTemplate: '{{userInput}}' },
          inputs: [],
          outputs: [{ name: 'date', type: 'text',
            description: 'The report date in YYYY-MM-DD format. Drives the metrics window.',
            example: '2026-04-28' }] },
        { id: 'fetcher', type: 'agent', position: pos(1),
          data: {
            agentId: '', label: 'Fetcher',
            instructions: 'Fetch metrics for the given date from the configured data source. Done when metrics is populated with all required keys.',
            promptTemplate: 'Fetch metrics for {{date}}.\n\nReturn a JSON object with keys: visits, conversions, revenue, errors.',
          },
          inputs: [{ name: 'date', type: 'text', required: true,
            description: 'YYYY-MM-DD report date. Drives the metrics window — fetch totals for this 24-hour period only.' }],
          outputs: [{ name: 'metrics', type: 'json',
            description: 'Object with shape { visits: number, conversions: number, revenue: number, errors: number }. All values are totals for the day.',
            example: { visits: 12450, conversions: 380, revenue: 4275.50, errors: 12 } }] },
        { id: 'analyzer', type: 'agent', position: pos(2),
          data: {
            agentId: '', label: 'Analyst',
            instructions: 'Compare today\'s metrics against typical ranges and call out notable trends. Done when insights has ≥3 entries (more if anomalous).',
            promptTemplate: 'Analyze these metrics and identify the 3-5 most important trends:\n\n{{metrics}}\n\nReturn each insight as a short, actionable sentence.',
          },
          inputs: [{ name: 'metrics', type: 'json', required: true,
            description: 'Day\'s metrics from the fetcher. Shape: { visits, conversions, revenue, errors } — all numbers, totals for the day. Compare each against typical ranges to spot trends.' }],
          outputs: [{ name: 'insights', type: 'list<text>',
            description: 'Each insight is a single short sentence (max 25 words). Order by importance descending. ≥3 entries.',
            example: ['Revenue up 12% vs typical Tuesday — driven by promo cohort.', 'Errors spiked at 14:00 (12 vs typical 0-2) — investigate.', 'Conversions stable.'] }] },
        { id: 'formatter', type: 'agent', position: pos(3),
          data: {
            agentId: '', label: 'Formatter',
            instructions: 'Render the insights as a markdown report. Done when report is ≥1 paragraph and includes the date.',
            promptTemplate: 'Format these insights as a daily report for {{date}}:\n\n{{insights}}\n\nReturn markdown. Title with the date. Bullet list of insights. Brief 2-3 sentence summary at the bottom.',
          },
          inputs: [
            { name: 'date', type: 'text', required: true,
              description: 'Report date in YYYY-MM-DD format. Include in the report title and any "as of" lines.' },
            { name: 'insights', type: 'list<text>', required: true,
              description: 'Analyst insights to render — each is a single sentence, ordered by importance. Render as a markdown bullet list.' },
          ],
          outputs: [{ name: 'report', type: 'text',
            description: 'Final markdown report. Title includes the date. Bullet-list of insights. 2-3 sentence summary.',
            example: '# Daily Report — 2026-04-28\n\n- Revenue up 12%...\n\n## Summary\nA strong Tuesday overall; investigate the 14:00 error spike.' }] },
        { id: 'out', type: 'output', position: pos(4),
          data: { outputFormat: 'markdown' },
          inputs: [{ name: 'context', type: 'text', required: true,
            description: 'Final report markdown — title with the date, bullet list of insights, brief summary at the bottom. Rendered to the user.' }],
          outputs: [] },
      ],
      edges: [
        { source: 'in',        sourceField: 'date',     target: 'fetcher',   targetField: 'date' },
        { source: 'in',        sourceField: 'date',     target: 'formatter', targetField: 'date' },
        { source: 'fetcher',   sourceField: 'metrics',  target: 'analyzer',  targetField: 'metrics' },
        { source: 'analyzer',  sourceField: 'insights', target: 'formatter', targetField: 'insights' },
        { source: 'formatter', sourceField: 'report',   target: 'out',       targetField: 'context' },
      ],
      variables: {},
    },
  },
  {
    key: 'human-approval',
    label: 'Human-in-the-Loop Approval',
    description: 'Generator → human review pause → publisher. Checkpoints let approval wait days; resume picks up where it left off.',
    flow: {
      name: 'Human-in-the-Loop Approval',
      description: 'Generate a proposal, surface it for human review, then publish only after approval. Checkpoints make the human-wait period free — resume picks up where it left off.',
      schemaVersion: 2,
      nodes: [
        { id: 'in', type: 'input', position: pos(0),
          data: { promptTemplate: '{{userInput}}' },
          inputs: [],
          outputs: [{ name: 'request', type: 'text',
            description: 'The user\'s proposal request — what they want generated and approved.',
            example: 'Draft a customer announcement for the Q3 pricing change.' }] },
        { id: 'generator', type: 'agent', position: pos(1),
          data: {
            agentId: '', label: 'Generator',
            instructions: 'Produce a polished proposal that a human reviewer can approve as-is or send back. Done when proposal reads as final-quality.',
            promptTemplate: 'Generate a proposal for this request:\n\n{{request}}\n\nReturn the full proposal text, ready for human review.',
          },
          inputs: [{ name: 'request', type: 'text', required: true,
            description: 'What to generate. The output will be sent to a human for approval before publishing — produce final-quality text, not a draft.' }],
          outputs: [{ name: 'proposal', type: 'text',
            description: 'Final-quality proposal text. Plain prose. Self-contained — the reviewer should be able to approve without rereading the request.',
            example: 'Dear customer,\n\nEffective Q3 2026, we are adjusting our pricing...' }] },
        { id: 'reviewer', type: 'agent', position: pos(2),
          data: {
            agentId: '', label: 'Review Coordinator',
            instructions: 'Forward the proposal for human approval (DM, email, or whatever channel is configured). Wait for the human verdict. Done when approved is set and finalContent reflects any human edits.',
            promptTemplate: 'A human needs to approve this proposal:\n\n{{proposal}}\n\nForward it via your configured channel, wait for a response, then return:\n  - approved (true/false)\n  - finalContent (the proposal verbatim if approved unchanged, else with the human\'s edits applied).',
          },
          inputs: [{ name: 'proposal', type: 'text', required: true,
            description: 'The proposal to send for approval. Forward verbatim — do not edit before showing the human; their decision is on this exact text.' }],
          outputs: [
            { name: 'approved', type: 'boolean',
              description: 'true if the human approved (with or without edits); false if they rejected.',
              example: true },
            { name: 'finalContent', type: 'text',
              description: 'The final approved content. Equals proposal if no edits; reflects the human\'s changes otherwise. Empty string if approved is false.',
              example: 'Dear customer, [approved with minor edits]...' },
          ] },
        { id: 'out', type: 'output', position: pos(3),
          data: { outputFormat: 'text' },
          inputs: [{ name: 'context', type: 'text', required: true,
            description: 'Final approved content (or empty if rejected).' }],
          outputs: [] },
      ],
      edges: [
        { source: 'in',        sourceField: 'request',      target: 'generator', targetField: 'request' },
        { source: 'generator', sourceField: 'proposal',     target: 'reviewer',  targetField: 'proposal' },
        { source: 'reviewer',  sourceField: 'finalContent', target: 'out',       targetField: 'context' },
      ],
      variables: {},
    },
  },
  {
    key: 'support-triage',
    label: 'Customer-Support Triage',
    description: 'Classifier → category-specific specialists → reply formatter. Per-node timeouts + retries + checkpoint/resume mean a midnight crash doesn\'t lose the queue.',
    flow: {
      name: 'Customer-Support Triage',
      description: 'Classify an inbound support ticket, route it to the matching specialist, format a customer-ready reply. Designed to run unattended — short timeout on the classifier, longer on the specialist, checkpoint after each step so a 5pm crash resumes from where it left off.',
      schemaVersion: 2,
      // Per-flow execution policy — applied to every node unless the
      // node overrides it. The triage scenario benefits from aggressive
      // retries (transient model errors are common at scale) and from
      // checkpoint+resume (overnight runs).
      execution: { maxRetries: 2, backoffBaseMs: 2000, backoffMultiplier: 2 },
      nodes: [
        { id: 'in', type: 'input', position: pos(0),
          data: { promptTemplate: '{{userInput}}' },
          inputs: [],
          outputs: [{ name: 'ticket', type: 'text',
            description: 'The raw customer message — exactly what arrived in the inbox. The classifier reads this verbatim.',
            example: 'Hi — I was charged twice for my November subscription. Order #84219.' }] },
        { id: 'classifier', type: 'agent', position: pos(1),
          data: {
            agentId: '', label: 'Triage Classifier',
            instructions: 'Read the ticket and classify it. Output category as ONE of: "billing", "technical", "feature-request", "other". Output urgency 1-5 (1=can wait days, 5=outage). Output sentiment as ONE of: "calm", "frustrated", "angry". Done immediately when all three fields are set — do not draft a reply, do not ask follow-up questions.',
            promptTemplate: 'Classify this support ticket:\n\n{{ticket}}\n\nReturn category (billing/technical/feature-request/other), urgency (1-5), and sentiment (calm/frustrated/angry).',
          },
          // Tight timeout — classifier should answer in seconds, not
          // minutes. If the model hangs, retry rather than blocking the
          // queue behind a stuck classification.
          execution: { timeoutMs: 15000, maxRetries: 2 },
          inputs: [{ name: 'ticket', type: 'text', required: true,
            description: 'The raw customer message. Read verbatim — do not pre-process; sentiment cues are in the original wording.' }],
          outputs: [
            { name: 'category', type: 'text',
              description: 'One of: "billing", "technical", "feature-request", "other". Drives downstream routing — must match exactly.',
              example: 'billing' },
            { name: 'urgency', type: 'number',
              description: 'Integer 1-5. 1 = informational/can-wait, 5 = active outage / customer impact.',
              example: 5 },
            { name: 'sentiment', type: 'text',
              description: 'One of: "calm", "frustrated", "angry". Used by the specialist to set tone.',
              example: 'frustrated' },
          ] },
        { id: 'specialist', type: 'agent', position: pos(2),
          data: {
            agentId: '', label: 'Support Specialist',
            instructions: 'Resolve the ticket. Match the customer\'s sentiment with appropriate tone — apologetic for "frustrated"/"angry", professional for "calm". For billing: cite the order id, propose a concrete fix (refund, credit, escalate). For technical: propose a triage step or workaround. For feature-request: acknowledge + log. For "other": route to general queue. Done when resolution and toneNote are set.',
            promptTemplate: 'Resolve this {{category}} ticket (urgency {{urgency}}/5, customer is {{sentiment}}):\n\n{{ticket}}\n\nReturn:\n  - resolution: full text of your proposed fix or response\n  - toneNote: one short line on how you matched the customer\'s sentiment',
          },
          // Specialists need more time — a billing case may involve
          // looking up an order. Two-minute budget per attempt; one retry.
          execution: { timeoutMs: 120000, maxRetries: 1 },
          inputs: [
            { name: 'ticket', type: 'text', required: true,
              description: 'The original customer message — refer to specifics (order id, error code) when crafting the reply.' },
            { name: 'category', type: 'text', required: true,
              description: 'The classifier\'s category — drives the playbook (billing vs technical etc.).' },
            { name: 'urgency', type: 'number', required: true,
              description: 'Urgency 1-5 from the classifier. Higher urgency = shorter, more direct response.' },
            { name: 'sentiment', type: 'text', required: true,
              description: 'Customer sentiment — match the tone of your reply.' },
          ],
          outputs: [
            { name: 'resolution', type: 'text',
              description: 'The proposed resolution. Full prose, customer-ready (the formatter polishes wording but not content).',
              example: 'Hi — I see the duplicate charge on order #84219. I\'ve issued a refund of $14.99...' },
            { name: 'toneNote', type: 'text',
              description: 'One-line note about the tone you used — used by ops review, not shown to the customer.',
              example: 'Apologetic opening to match customer frustration; concise factual middle; warm close.' },
          ] },
        { id: 'formatter', type: 'agent', position: pos(3),
          data: {
            agentId: '', label: 'Reply Formatter',
            instructions: 'Polish the resolution into a customer-ready reply. Add a greeting matching the sentiment, a clear subject, and a brief sign-off. Preserve every concrete detail (order ids, dollar amounts, dates) verbatim. Done when reply is set and subject is set.',
            promptTemplate: 'Polish this support reply:\n\nResolution:\n{{resolution}}\n\nCustomer sentiment: {{sentiment}}\n\nReturn a final reply (with greeting + sign-off) and a short subject line.',
          },
          execution: { timeoutMs: 30000, maxRetries: 1 },
          inputs: [
            { name: 'resolution', type: 'text', required: true,
              description: 'The specialist\'s resolution. Polish wording but preserve every concrete fact verbatim.' },
            { name: 'sentiment', type: 'text', required: true,
              description: 'Customer sentiment — sets greeting and sign-off tone.' },
          ],
          outputs: [
            { name: 'subject', type: 'text',
              description: 'Short email-style subject line. Should reference the ticket type (refund, error code) for inbox scanning.',
              example: 'Re: duplicate charge on order #84219 — refunded' },
            { name: 'reply', type: 'text',
              description: 'The full customer-ready reply. Greeting + body + sign-off. This is what gets sent.',
              example: 'Hi Sarah,\n\nI\'m sorry about the duplicate charge — I see both transactions on order #84219. I\'ve issued a refund of $14.99...\n\nThanks for your patience,\nThe support team' },
          ] },
        { id: 'out', type: 'output', position: pos(4),
          data: { outputFormat: 'text' },
          inputs: [{ name: 'context', type: 'text', required: true,
            description: 'The polished customer-ready reply — full text including greeting, body, and sign-off. This is what gets sent to the customer.' }],
          outputs: [] },
      ],
      edges: [
        { source: 'in',         sourceField: 'ticket',     target: 'classifier', targetField: 'ticket' },
        // Classifier outputs fan into the specialist (4 typed handoffs).
        { source: 'in',         sourceField: 'ticket',     target: 'specialist', targetField: 'ticket' },
        { source: 'classifier', sourceField: 'category',   target: 'specialist', targetField: 'category' },
        { source: 'classifier', sourceField: 'urgency',    target: 'specialist', targetField: 'urgency' },
        { source: 'classifier', sourceField: 'sentiment',  target: 'specialist', targetField: 'sentiment' },
        // Specialist + classifier sentiment fan into the formatter.
        { source: 'specialist', sourceField: 'resolution', target: 'formatter',  targetField: 'resolution' },
        { source: 'classifier', sourceField: 'sentiment',  target: 'formatter',  targetField: 'sentiment' },
        // Final output is the polished reply.
        { source: 'formatter',  sourceField: 'reply',      target: 'out',        targetField: 'context' },
      ],
      variables: {},
    },
  },
  {
    key: 'spec-plan-implement-verify',
    label: 'Spec → Plan → Implement → Verify',
    description: 'Autonomous coding pipeline: PM extracts requirements, architect plans the file layout, implementer writes the code, verifier runs tests and reports failures. Each handoff is typed so the implementer literally cannot run without the architect\'s file list.',
    flow: {
      name: 'Spec → Plan → Implement → Verify',
      description: 'Turn a feature spec into shipped, verified code. PM agent extracts structured requirements, architect proposes a concrete file layout, implementer writes the files exactly as planned, verifier runs tests and reports any failures. The typed handoffs make the implementer use the architect\'s exact file list — eliminating the most common autonomous-coding failure mode where the implementer "drifts" from the plan.',
      schemaVersion: 2,
      // Per-node retries default to 1 — let an agent recover from a
      // transient model hiccup, but bound the budget so a misbehaving
      // step doesn't burn 10 minutes.
      execution: { maxRetries: 1, backoffBaseMs: 5000, backoffMultiplier: 2 },
      nodes: [
        { id: 'in', type: 'input', position: pos(0),
          data: { promptTemplate: '{{userInput}}' },
          inputs: [],
          outputs: [{ name: 'spec', type: 'text',
            description: 'The feature spec — natural-language description of what to build. Can be a single sentence ("add a dark-mode toggle") or several paragraphs.',
            example: 'Add a /api/users/:id/avatar endpoint that returns the user\'s avatar URL, falling back to a Gravatar default. Cache for 24 h.' }] },
        { id: 'pm', type: 'agent', position: pos(1),
          data: {
            agentId: '', label: 'Product Manager',
            instructions: 'Read the spec and extract structured requirements. Done when requirements is populated as JSON with: goal (one-sentence summary), acceptanceCriteria (list of testable assertions), constraints (list of must-have/must-not non-functionals). Do NOT write code. Do NOT design files yet. Just structure the spec.',
            promptTemplate: 'Extract structured requirements from this spec:\n\n{{spec}}\n\nReturn JSON: { goal, acceptanceCriteria: [...], constraints: [...] }.',
          },
          inputs: [{ name: 'spec', type: 'text', required: true,
            description: 'The natural-language spec from the user. May be terse — fill in reasonable defaults but flag any ambiguity in constraints.' }],
          outputs: [{ name: 'requirements', type: 'json',
            description: 'Structured requirements: { goal: "<one sentence>", acceptanceCriteria: ["<each is independently testable>", ...], constraints: ["e.g. backwards-compatible, no new dependencies", ...] }.',
            example: { goal: 'Avatar endpoint with Gravatar fallback', acceptanceCriteria: ['returns 200 + JSON for known user', 'falls back to Gravatar for unknown', 'response cached 24h'], constraints: ['no new dependencies', 'preserve existing /api/users/:id behavior'] } }] },
        { id: 'architect', type: 'agent', position: pos(2),
          data: {
            agentId: '', label: 'Architect',
            instructions: 'Read the requirements and propose a concrete file layout. Done when plan is set (prose explanation of the approach) and files is populated (the EXACT list of files to create or modify, each with its purpose). The implementer will use this list verbatim — be precise.',
            promptTemplate: 'Plan the implementation for these requirements:\n\n{{requirements}}\n\nReturn:\n  - plan: a short paragraph explaining the approach\n  - files: list of objects, each { path: "src/path/to/file.js", purpose: "what this file does" }. Include EVERY file the implementer should create or modify.',
          },
          inputs: [{ name: 'requirements', type: 'json', required: true,
            description: 'Structured requirements from the PM. Use acceptanceCriteria to scope what the implementation must satisfy and constraints to bound what it must not do.' }],
          outputs: [
            { name: 'plan', type: 'text',
              description: 'Short prose paragraph explaining the chosen approach — why this file layout, what the data flow is.',
              example: 'Add a new route handler in src/routes/users.js that calls src/services/avatar.js. The avatar service caches via existing src/cache/ttl.js. No DB schema changes.' },
            { name: 'files', type: 'json',
              description: 'List of objects: { path, purpose }. THIS IS THE CONTRACT — the implementer writes exactly these files, no more, no less. Include every file.',
              example: [{ path: 'src/routes/users.js', purpose: 'Add GET /:id/avatar handler' }, { path: 'src/services/avatar.js', purpose: 'New: gravatar lookup + cache wrapper' }] },
          ] },
        { id: 'implementer', type: 'agent', position: pos(3),
          data: {
            agentId: '', label: 'Implementer',
            instructions: 'Implement the plan. Read each entry in files and create/modify exactly that file with the described purpose. Stay within the architect\'s file list — do NOT introduce files that aren\'t in the plan; if the plan is incomplete, fail loudly with a clear error rather than silently inventing files. Done when filesWritten lists every file you touched, with the actual contents written.',
            promptTemplate: 'Implement this plan:\n\n{{plan}}\n\nFiles to create/modify:\n{{files}}\n\nFor each file in the list, write the actual code. Use your filesystem and code-replace tools. Return filesWritten as a list of objects { path, summary } documenting what landed in each file. Stay within the file list — do not add files the architect didn\'t plan for.',
          },
          // Implementer gets the longest budget — code generation can
          // take minutes for non-trivial plans. Two retries because
          // partial-write failures (auth flakes mid-write) are recoverable.
          execution: { timeoutMs: 600000, maxRetries: 2 },
          inputs: [
            { name: 'plan', type: 'text', required: true,
              description: 'The architect\'s prose plan — read this for the WHY before writing code.' },
            { name: 'files', type: 'json', required: true,
              description: 'The architect\'s file list. THIS IS YOUR CONTRACT — write exactly these files, with the described purposes. Do not add files outside this list.' },
          ],
          outputs: [{ name: 'filesWritten', type: 'json',
            description: 'List of objects: { path, summary }. One entry per file actually written. Should match the architect\'s files list 1:1 — if you skipped any, say why in the summary.',
            example: [{ path: 'src/routes/users.js', summary: 'Added GET /:id/avatar handler delegating to avatarService' }, { path: 'src/services/avatar.js', summary: 'New service: gravatarLookup() + cached wrapper using ttl.js' }] }] },
        { id: 'verifier', type: 'agent', position: pos(4),
          data: {
            agentId: '', label: 'Verifier',
            instructions: 'Run tests against the files the implementer wrote. Use the project\'s test runner (npm test, pytest, etc.). Done when passed is set (boolean) and failures lists every failing test with a one-line description. If passed is false, the user knows exactly what to fix on the next run — do not suppress failures.',
            promptTemplate: 'Run the tests covering these files:\n\n{{filesWritten}}\n\nReturn:\n  - passed: true if all tests pass, false otherwise\n  - failures: list of one-line descriptions of each failing test (empty list when passed is true)\n  - report: a one-line human-readable summary — e.g. "PASS — all 12 tests green" or "FAIL: 3 tests failed (tests/users.test.js, tests/avatar.test.js, ...)"',
          },
          execution: { timeoutMs: 300000, maxRetries: 0 }, // tests should be deterministic — no retry
          inputs: [{ name: 'filesWritten', type: 'json', required: true,
            description: 'The implementer\'s filesWritten list. Use it to scope which tests to run (run the whole suite if there\'s any uncertainty).' }],
          outputs: [
            { name: 'passed', type: 'boolean',
              description: 'true when every test passes; false when any test fails. The flow output is gated on this.',
              example: false },
            { name: 'failures', type: 'list<text>',
              description: 'One entry per failing test, formatted "<file>: <test name> — <one-line reason>". Empty when passed is true.',
              example: ['tests/routes/users.test.js: avatar endpoint 404s for unknown user — expected Gravatar fallback URL'] },
            { name: 'report', type: 'text',
              description: 'Human-readable pass/fail summary for the user — one line saying PASS or "FAIL: N tests failed", followed by the failure list when applicable. This is what the flow surfaces as its final output.',
              example: 'PASS — all 12 tests green' },
          ] },
        { id: 'out', type: 'output', position: pos(5),
          data: { outputFormat: 'text' },
          inputs: [{ name: 'context', type: 'text', required: true,
            description: 'Pass/fail report — the user reads this to decide whether to ship or iterate.' }],
          outputs: [] },
      ],
      edges: [
        { source: 'in',          sourceField: 'spec',         target: 'pm',          targetField: 'spec' },
        { source: 'pm',          sourceField: 'requirements', target: 'architect',   targetField: 'requirements' },
        { source: 'architect',   sourceField: 'plan',         target: 'implementer', targetField: 'plan' },
        { source: 'architect',   sourceField: 'files',        target: 'implementer', targetField: 'files' },
        { source: 'implementer', sourceField: 'filesWritten', target: 'verifier',    targetField: 'filesWritten' },
        // Future enhancement: verifier.passed=false back-edge to implementer
        // for an autonomous fix-up loop. Today the executor's topo sort
        // doesn't support cycles, so this template is linear — the user
        // re-runs manually if `passed` is false. Failures are surfaced in
        // structured form so the next run can address them precisely.
        { source: 'verifier',    sourceField: 'report',       target: 'out',         targetField: 'context' },
      ],
      variables: {},
    },
  },
];

export function getTemplateByKey(key) {
  return STARTER_TEMPLATES.find(t => t.key === key) || null;
}

export default { STARTER_TEMPLATES, getTemplateByKey };
