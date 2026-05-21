# Tool Reference (Core)

This is the initial core-tool reference for OnBuzz Community contributors. It documents the 5 tools from `COMMUNITY_PROGRAM.md` Week 2 daily task.

Note: tool calls are accepted as JSON. The runtime can also parse the XML-ish tag form used in the shell renderer.

## terminal

Agent shell helper for command execution and working-directory management.

### Parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `actions` | `array<object>` | Yes | One or more action objects. |
| `actions[].type` | `string` | Yes | One of: `run-command`, `change-directory`, `list-directory`, `create-directory`, `get-working-directory`. |
| `actions[].command` | `string` | Conditionally | Required when `type` is `run-command`. |
| `actions[].directory` | `string` | Conditionally | Required when `type` is `change-directory`, `list-directory`, `create-directory`. |
| `timeout` | `number` | No | Optional command timeout in ms. Must be between `1000` and tool timeout. |
| `async` | `boolean` | No | Enable async mode for command execution. |

### Example invocations

```json
{"toolId":"terminal","actions":[{"type":"run-command","command":"npm install"}]}
```

```json
{"toolId":"terminal","actions":[{"type":"change-directory","directory":"../frontend"},{"type":"run-command","command":"npm run build"},{"type":"get-working-directory"}]}
```

### Output shape

- **Top-level:** `success`, `actions`, `workingDirectory`, `executedActions`, `failedActions`, `toolUsed: "terminal"`, `message`.
- **`run-command` action result:** `command`, `commandId`, `stdout`, `stderr`, `exitCode`, `executionTime`, `workingDirectory`, optional `translatedCommand`, optional `error`.
- **`change-directory` action result:** `oldDirectory`, `newDirectory`.
- **`list-directory` action result:** `directory`, `contents`, `totalItems`, `directories`, `files`.
- **`create-directory` action result:** `directory`, `relativePath`.
- **`get-working-directory` action result:** `workingDirectory`.

### Failure modes

- Command is blocked by built-in or agent policy (`rm -rf /`, etc.).
- Command not in allowed list when agent-level allow list is set.
- Duplicate running command blocked by terminal dedup (unless `force` semantics in action allow retry).
- Execution timeout or non-zero exit code (`stderr`/`error` returned on the action).
- Unsupported action type.

## filesystem

Agent file operations for read/write/copy/move/delete/list/stat checks.

### Parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `actions` | `array<object>` | Yes | One or more filesystem action objects. |
| `actions[].type` | `string` | Yes | `read`, `write`, `append`, `delete`, `copy`, `move`, `create-dir`, `list`, `exists`, `stats`. |
| `actions[].filePath` | `string` | Conditionally | Required for `read`, `append`, `delete`, `exists`, `stats`. |
| `actions[].outputPath` | `string` | Conditionally | Required for `write`. |
| `actions[].sourcePath` | `string` | Conditionally | Required for `copy` and `move`. |
| `actions[].destPath` | `string` | Conditionally | Required for `copy` and `move`. |
| `actions[].directory` | `string` | Conditionally | Required for `create-dir`, `list`. |
| `actions[].content` | `string` | Conditionally | Required for `write` and `append`. |
| `actions[].encoding` | `string` | No | Defaults to `utf8`. |
| `actions[].createDirs` | `boolean` | No | Create parent dirs on write (parser alias available from XML style calls). |

### Example invocations

```json
{"toolId":"filesystem","actions":[{"type":"read","filePath":"package.json"},{"type":"exists","filePath":"README.md"}]}
```

```json
{"toolId":"filesystem","actions":[{"type":"write","outputPath":"tmp/notes.txt","content":"hello"},{"type":"copy","sourcePath":"tmp/notes.txt","destPath":"tmp/notes-copy.txt"},{"type":"delete","filePath":"tmp/notes.txt"}]}
```

### Output shape

- **Top-level:** `success`, `actions`, `executedActions`, `successfulActions`, `failedActions`, `toolUsed: "filesys"`, optional `warning` when some actions fail.
- **Per-action result examples:**  
  - `read`: `filePath`, `content`, `size`, `encoding`, `lastModified`, `message`.  
  - `write`: `outputPath`, `size`, `verified`, `encoding`, optional `validation`, `backupPath`.  
  - `append`: `filePath`, `appendedBytes`, `totalSize`, `sizeBefore`, `verified`.  
  - `copy`/`move`: `sourcePath`, `destPath`, `size`.  
  - `list`: `directory`, `contents`, `totalItems`, `directories`, `files`.  
  - `exists`: `filePath`, `exists`, `type`.  
  - `stats`: file metadata fields from `fs.stat`.

### Failure modes

- Missing/invalid actions or action fields (`content`, path, `type` not supported).
- File path blocked by allowed/blocked extensions policy.
- Path traversal/access check failure (read/write blocked by agent directory policy).
- Write/append payload too large or file size exceeds max-file-size limit.
- Parse/validation failure (e.g., non-string `content`, empty action path).

## web

Browser-backed web tool for search, fetch, interactive automation, and authentication flow.

### Parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `operation` | `string` | Yes | One of `search`, `fetch`, `interactive`, `authenticate`. |
| `query` | `string` | Conditionally | Required for `search`. |
| `url` | `string` | Conditionally | Required for `fetch`. |
| `formats` | `array<string>` | No | Optional formats for fetch (for example `title`, `text`, `links`). |
| `actions` | `array<object>` | Conditionally | Required for `interactive`. |
| `action.type` | `string` | Yes | Examples: `open-tab`, `close-tab`, `switch-tab`, `list-tabs`, `navigate`, `click`, `type`, `extract-text`, `screenshot`, `evaluate`, `select`, etc. |
| `site` / `siteId` | `string` | Conditionally | Required for `authenticate`. |
| `loginUrl` | `string` | No | Optional for custom-site authenticate. |
| `stealthLevel` | `string` | No | `standard` (headless) or `maximum` (visible browser). |
| `keepTabOpen` | `boolean` | No | For `authenticate` to retain tab. |

### Example invocations

```json
{"toolId":"web","operation":"search","query":"Open source automation","engine":"duckduckgo","maxResults":5}
```

```json
{"toolId":"web","operation":"interactive","stealthLevel":"maximum","actions":[{"type":"open-tab","name":"main","url":"https://example.com","nestedActions":[{"type":"extract-text","selector":"body"},{"type":"screenshot","format":"file","path":"example.png"}]}]}
```

### Output shape

- **Top-level:** `success`, `operation`, `toolUsed: "web"`, `data`.
- Flat convenience keys may be added: `error`, `suggestion`, `warning`, `title`, `text`, `url`, `results`, `resultsCount`, `httpStatus`, `stealthNotice`, `diagnostics`, `jsErrors`, `networkFailures`, `httpErrors`, `notice`.
- `search`/`fetch` payloads come inside `data` and are mirrored to top-level where possible.
- `interactive` returns `data.results` array with per-tab action summaries and `actionsExecuted`.

### Failure modes

- Schema/validation failures for missing required fields (`query` for search, `url` for fetch, `actions` for interactive, no site for authenticate).
- URL blocked by agent `allowedDomains`/`blockedDomains`.
- Browser access failures (navigation timeout, connection closed, target closed, stealth mismatch).
- CAPTCHAs or bot blocks (often suggest switching to `stealthLevel: "maximum"`).
- Missing credentials for authentication flow; tool returns `requiresCredentials` guidance.

## seek

Text search across project files with glob and plain path inputs.

### Parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `filePaths` | `array<string>` | Yes | Paths or glob patterns. |
| `searchTerms` | `array<string>` | Yes | Search strings/terms to match. |

### Example invocations

```json
{"toolId":"seek","filePaths":["src/**/*.js","src/**/*.ts"],"searchTerms":["taskmanager","createTask"]}
```

```json
{"toolId":"seek","filePaths":["README.md","src/main.js"],"searchTerms":["TODO","FIXME"]}
```

### Output shape

- **Success:** `success: true`, `filesSearched`, `filesNotFound`, `filesWithErrors`, `totalMatches`, `matchesByTerm`, `formattedResults`, `toolUsed: "seek"`, optional `guidance`.
- **`matchesByTerm`:** map from term to array of `{ filePath, lineNumber, lineContent }`.
- **Error:** `success: false`, `error`, optional counters like `filesResolved`, `filesNotFound`.

### Failure modes

- Missing required arguments or invalid type (non-array, empty, empty strings).
- Too many file paths or search terms (`MAX_FILE_PATHS`, `MAX_SEARCH_TERMS` enforced).
- File path traversal attempt (`..`) rejected.
- Too many files matched to search (hard cap per operation).
- File too large, unreadable, or inaccessible path.

## taskmanager

Maintains an agent-local TODO list and task state.

### Parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `actions` | `array<object>` | Yes | One action object, usually in `actions[0]`. |
| `actions[0].type` | `string` | Yes | `create`, `update`, `list`, `complete`, `cancel`, `clear`, plus runtime extras like `sync`, `depend`, `relate`, `subtask`, `prioritize`, `template`, `progress`, `analytics`. |
| `actions[0].title` | `string` | Conditionally | Required for `create`. |
| `actions[0].description` | `string` | No | Optional task detail text. |
| `actions[0].priority` | `string` | No | `urgent | high | medium | low`. |
| `actions[0].status` | `string` | No | `pending | in_progress | blocked | completed | cancelled` depending on action. |
| `actions[0].taskId` | `string` | Conditionally | Required for `update`, `complete`, `cancel` unless using `id`. |

### Example invocations

```json
{"toolId":"taskmanager","actions":[{"type":"create","title":"Run acceptance tests","description":"Execute npm test","priority":"high"}]}
```

```json
{"toolId":"taskmanager","actions":[{"type":"sync","tasks":[{"title":"Draft PR","status":"pending","priority":"medium"},{"title":"Run linters","status":"completed","priority":"low"}]}]}
```

### Output shape

- **Success:** `success: true`, `action`, `result`, `tasks` (full current task list), `summary`.
- **Failure:** `success: false`, `error`.
- Task list data is returned on every action, not just `list`.

### Failure modes

- Unknown action name.
- Missing required identifiers (`Agent ID is required`, `Task ID is required`, `Task not found: ...`).
- Invalid status/priority (`Invalid status`, `Invalid priority`).
- Unsupported action payload shape (`status/priority` not matching valid enums).
- Agent missing/inaccessible in pool (`Agent not found`).
