/**
 * Skills Tool - Global skills library for agents
 *
 * Purpose:
 * - Allow agents to discover, browse, and read reusable skill instructions
 * - Support progressive disclosure: list → describe → read-section → read
 * - Support CRUD operations and importing skills from disk
 * - Skills are global (shared across agents) and persist across package updates
 *
 * Actions:
 * - list: List all skills with descriptions, section headings, and sizes
 * - describe: Get full metadata for a skill without loading content
 * - read: Read a skill's full content
 * - read-section: Read only a specific section of a skill
 * - read-file: Read a supporting file from a skill directory
 * - create: Create a new skill
 * - update: Update an existing skill
 * - delete: Remove a skill
 * - import: Import a skill from an external file or directory
 */

import { BaseTool } from './baseTool.js';
import { getSkillsService } from '../services/skillsService.js';
import { SKILLS_ACTIONS } from '../utilities/toolConstants.js';

class SkillsTool extends BaseTool {
  constructor(config = {}, logger = null) {
    super(config, logger);

    this.skillsService = null;
    this.requiresProject = false;
    this.isAsync = false;
    this.timeout = 30000;
  }

  async _ensureSkillsService() {
    if (!this.skillsService) {
      this.skillsService = getSkillsService(this.logger);
      await this.skillsService.initialize();
    }
    return this.skillsService;
  }

  getDescription() {
    return `Skills Tool: Browse and manage a global library of reusable skill instructions.

Skills are structured knowledge packages containing instructions, checklists, templates, and reference files.
Each skill is a directory with a skill.md file and optional supporting files.
Always check for relevant skills when tackeling new tasks/changing task-focus.

PROGRESSIVE DISCLOSURE — Use this flow to minimize context usage:
1. "list" → See all skills with section headings and sizes
2. "describe" → Inspect a specific skill's structure in detail
3. "read-section" → Load only the section you need
4. "read" → Load full content only when necessary

ACTIONS:

1. LIST all skills:
\`\`\`json
{ "toolId": "skills", "action": "list" }
\`\`\`
Returns: name, description, section headings, line count, file count for each skill.

2. DESCRIBE a skill (metadata only, no content):
\`\`\`json
{ "toolId": "skills", "action": "describe", "name": "code-review" }
\`\`\`
Returns: description, sections with line ranges, file list, size.

3. READ full skill content:
\`\`\`json
{ "toolId": "skills", "action": "read", "name": "code-review" }
\`\`\`
Returns: full skill.md content + list of files in the skill directory.

4. READ a specific SECTION:
\`\`\`json
{ "toolId": "skills", "action": "read-section", "name": "code-review", "section": "Checklist" }
\`\`\`
Returns: only the content under the specified ## heading.

5. READ a supporting FILE:
\`\`\`json
{ "toolId": "skills", "action": "read-file", "name": "email-templates", "file": "templates/welcome.html" }
\`\`\`
Returns: content of a specific file within the skill directory.

6. CREATE a new skill:
\`\`\`json
{ "toolId": "skills", "action": "create", "name": "my-skill", "content": "# My Skill\\n\\nInstructions here...\\n\\n## Section One\\n..." }
\`\`\`
Optional: "files" array of { "path": "relative/path.ext", "content": "..." } for supporting files.

7. UPDATE an existing skill:
\`\`\`json
{ "toolId": "skills", "action": "update", "name": "my-skill", "content": "# Updated content..." }
\`\`\`
Optional: "files" array to add/update supporting files.

8. DELETE a skill:
\`\`\`json
{ "toolId": "skills", "action": "delete", "name": "my-skill" }
\`\`\`

9. IMPORT a skill from disk:
\`\`\`json
{ "toolId": "skills", "action": "import", "source": "/path/to/skill-dir-or-file" }
\`\`\`
Optional: "name" to override the derived skill name. If source is a directory, it must contain a skill.md file.

SKILL NAMING: Names must be kebab-case (lowercase, hyphens). Example: "code-review", "email-templates".`;
  }

  parseParameters(content) {
    return content;
  }

  getRequiredParameters() {
    return ['action'];
  }

  getSupportedActions() {
    return Object.values(SKILLS_ACTIONS);
  }

  validateParameterTypes(params) {
    const errors = [];
    if (params.action && typeof params.action !== 'string') {
      errors.push('action must be a string');
    }
    if (params.name !== undefined && typeof params.name !== 'string') {
      errors.push('name must be a string');
    }
    if (params.content !== undefined && typeof params.content !== 'string') {
      errors.push('content must be a string');
    }
    if (params.section !== undefined && typeof params.section !== 'string') {
      errors.push('section must be a string');
    }
    if (params.file !== undefined && typeof params.file !== 'string') {
      errors.push('file must be a string');
    }
    if (params.source !== undefined && typeof params.source !== 'string') {
      errors.push('source must be a string');
    }
    return errors;
  }

  customValidateParameters(params) {
    const errors = [];
    const { action, name, content, section, file, source } = params;

    const validActions = this.getSupportedActions();
    if (!validActions.includes(action)) {
      errors.push(`Invalid action: "${action}". Valid actions: ${validActions.join(', ')}`);
      return errors;
    }

    // Action-specific required params
    const needsName = [SKILLS_ACTIONS.DESCRIBE, SKILLS_ACTIONS.READ, SKILLS_ACTIONS.READ_SECTION, SKILLS_ACTIONS.READ_FILE, SKILLS_ACTIONS.CREATE, SKILLS_ACTIONS.UPDATE, SKILLS_ACTIONS.DELETE];
    if (needsName.includes(action) && !name) {
      errors.push(`"name" is required for action "${action}"`);
    }
    if (action === SKILLS_ACTIONS.CREATE && !content) {
      errors.push('"content" is required for action "create"');
    }
    if (action === SKILLS_ACTIONS.READ_SECTION && !section) {
      errors.push('"section" is required for action "read-section"');
    }
    if (action === SKILLS_ACTIONS.READ_FILE && !file) {
      errors.push('"file" is required for action "read-file"');
    }
    if (action === SKILLS_ACTIONS.IMPORT && !source) {
      errors.push('"source" is required for action "import"');
    }

    return errors;
  }

  async execute(params, context = {}) {
    const service = await this._ensureSkillsService();
    const { action } = params;

    try {
      switch (action) {
        case SKILLS_ACTIONS.LIST:
          return this._formatResult(await service.listSkills(), 'Skills listed');

        case SKILLS_ACTIONS.DESCRIBE:
          return this._formatResult(await service.describeSkill(params.name), `Skill described: ${params.name}`);

        case SKILLS_ACTIONS.READ:
          return this._formatResult(await service.readSkill(params.name), `Skill read: ${params.name}`);

        case SKILLS_ACTIONS.READ_SECTION:
          return this._formatResult(await service.readSkillSection(params.name, params.section), `Section read: ${params.section}`);

        case SKILLS_ACTIONS.READ_FILE:
          return this._formatResult(await service.readSkillFile(params.name, params.file), `File read: ${params.file}`);

        case SKILLS_ACTIONS.CREATE:
          return this._formatResult(await service.createSkill(params.name, params.content, params.files || [], params.description || null), `Skill created: ${params.name}`);

        case SKILLS_ACTIONS.UPDATE:
          return this._formatResult(await service.updateSkill(params.name, params.content || null, params.files || [], params.description || null), `Skill updated: ${params.name}`);

        case SKILLS_ACTIONS.DELETE:
          await service.deleteSkill(params.name);
          return this._formatResult({ deleted: params.name }, `Skill deleted: ${params.name}`);

        case SKILLS_ACTIONS.IMPORT:
          return this._formatResult(await service.importSkill(params.source, params.name || null, params.description || null), `Skill imported: ${params.name || params.source}`);

        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  _formatResult(data, message) {
    return {
      success: true,
      result: data,
      message
    };
  }

  getParameterSchema() {
    return {
      type: 'object',
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: Object.values(SKILLS_ACTIONS),
          description: 'The skill action to perform'
        },
        name: {
          type: 'string',
          description: 'Skill name (kebab-case)'
        },
        content: {
          type: 'string',
          description: 'Skill content (markdown)'
        },
        section: {
          type: 'string',
          description: 'Section heading to read (for read-section action)'
        },
        file: {
          type: 'string',
          description: 'Relative file path within skill directory (for read-file action)'
        },
        source: {
          type: 'string',
          description: 'Source file or directory path (for import action)'
        },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' }
            }
          },
          description: 'Additional supporting files (for create/update actions)'
        }
      }
    };
  }
}

export default SkillsTool;
