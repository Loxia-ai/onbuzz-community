/**
 * Skills Service
 *
 * Purpose:
 * - Provide persistent global skills library
 * - Support CRUD operations on skills (list, describe, read, create, update, delete, import)
 * - Each skill is a directory containing skill.md + optional supporting files
 * - Skills are global (not per-agent), assigned to agents via skills array
 *
 * Storage: userDataDir/state/skills/
 *   skills-index.json              ← metadata catalog
 *   {skill-name}/
 *     skill.md                     ← main instruction file
 *     ...                          ← optional supporting files
 */

import { promises as fs } from 'fs';
import path from 'path';
import { getUserDataPaths, ensureUserDataDirs } from '../utilities/userDataDir.js';

const SKILLS_VERSION = '1.0.0';
const SKILL_FILENAME = 'skill.md';
const INDEX_FILENAME = 'skills-index.json';
const MAX_SKILL_NAME_LENGTH = 50;
const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

class SkillsService {
  constructor(logger = null) {
    this.logger = logger;
    this.skillsDir = null;
    this.indexCache = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    try {
      await ensureUserDataDirs();
      const paths = getUserDataPaths();
      this.skillsDir = paths.skills;

      this.initialized = true;
      this.logger?.info('[SkillsService] Initialized', { skillsDir: this.skillsDir });
    } catch (error) {
      this.logger?.warn('[SkillsService] Initialization failed', { error: error.message });
      throw error;
    }
  }

  // --- Index Management ---

  _getIndexPath() {
    return path.join(this.skillsDir, INDEX_FILENAME);
  }

  _getSkillDir(skillName) {
    return path.join(this.skillsDir, skillName);
  }

  _getSkillFilePath(skillName) {
    return path.join(this.skillsDir, skillName, SKILL_FILENAME);
  }

  async _loadIndex() {
    if (this.indexCache) return this.indexCache;

    try {
      const data = await fs.readFile(this._getIndexPath(), 'utf8');
      this.indexCache = JSON.parse(data);
    } catch {
      this.indexCache = { version: SKILLS_VERSION, skills: {} };
    }
    return this.indexCache;
  }

  async _saveIndex(index) {
    index.lastUpdated = new Date().toISOString();
    await fs.writeFile(this._getIndexPath(), JSON.stringify(index, null, 2), 'utf8');
    this.indexCache = index;
  }

  // --- Validation ---

  _validateSkillName(name) {
    if (!name || typeof name !== 'string') {
      throw new Error('Skill name is required');
    }
    if (name.length > MAX_SKILL_NAME_LENGTH) {
      throw new Error(`Skill name must be ${MAX_SKILL_NAME_LENGTH} characters or fewer`);
    }
    if (!SKILL_NAME_PATTERN.test(name)) {
      throw new Error('Skill name must be kebab-case (lowercase letters, numbers, hyphens). Example: "code-review"');
    }
  }

  _validatePathSafe(skillName, filePath) {
    const skillDir = path.resolve(this._getSkillDir(skillName));
    const resolved = path.resolve(skillDir, filePath);
    if (!resolved.startsWith(skillDir + path.sep) && resolved !== skillDir) {
      throw new Error('File path must be within the skill directory');
    }
    return resolved;
  }

  // --- Content Analysis ---

  _extractDescription(content) {
    if (!content) return '';
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('#')) continue;
      // First non-empty, non-heading line is the description
      return trimmed.length > 200 ? trimmed.slice(0, 197) + '...' : trimmed;
    }
    return '';
  }

  _extractSections(content) {
    if (!content) return [];
    const lines = content.split('\n');
    const sections = [];
    let currentSection = null;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('## ')) {
        if (currentSection) {
          currentSection.endLine = i - 1;
          sections.push(currentSection);
        }
        currentSection = {
          heading: trimmed,
          startLine: i + 1,
          endLine: lines.length - 1
        };
      }
    }
    if (currentSection) {
      currentSection.endLine = lines.length - 1;
      sections.push(currentSection);
    }
    return sections;
  }

  _computeSize(content) {
    const sizeBytes = Buffer.byteLength(content || '', 'utf8');
    const lineCount = content ? content.split('\n').length : 0;
    return { sizeBytes, lineCount };
  }

  async _listSkillFiles(skillName) {
    const skillDir = this._getSkillDir(skillName);
    try {
      const entries = await fs.readdir(skillDir, { withFileTypes: true, recursive: true });
      const files = [];
      for (const entry of entries) {
        if (entry.isFile()) {
          // Build relative path from skill dir
          const relativePath = entry.parentPath
            ? path.relative(skillDir, path.join(entry.parentPath, entry.name))
            : entry.name;
          files.push(relativePath);
        }
      }
      return files;
    } catch {
      return [SKILL_FILENAME];
    }
  }

  async _buildIndexEntry(skillName, content, explicitDescription = null) {
    const now = new Date().toISOString();
    const sections = this._extractSections(content);
    const { sizeBytes, lineCount } = this._computeSize(content);
    const files = await this._listSkillFiles(skillName);

    return {
      name: skillName,
      description: explicitDescription || this._extractDescription(content),
      sections: sections.map(s => s.heading),
      sizeBytes,
      lineCount,
      files,
      createdAt: now,
      updatedAt: now
    };
  }

  // --- Public Methods ---

  async listSkills() {
    await this.initialize();
    const index = await this._loadIndex();
    return Object.values(index.skills).map(s => ({
      name: s.name,
      description: s.description,
      sections: s.sections || [],
      sizeBytes: s.sizeBytes || 0,
      lineCount: s.lineCount || 0,
      fileCount: (s.files || []).length,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt
    }));
  }

  async describeSkill(skillName) {
    await this.initialize();
    this._validateSkillName(skillName);
    const index = await this._loadIndex();
    const entry = index.skills[skillName];
    if (!entry) {
      throw new Error(`Skill not found: ${skillName}`);
    }

    // Re-read content to get section line ranges (index only stores headings)
    let sections = (entry.sections || []).map(h => ({ heading: h }));
    try {
      const content = await fs.readFile(this._getSkillFilePath(skillName), 'utf8');
      sections = this._extractSections(content);
    } catch {
      // Fall back to index-only data
    }

    return {
      name: entry.name,
      description: entry.description,
      sections,
      sizeBytes: entry.sizeBytes || 0,
      lineCount: entry.lineCount || 0,
      files: entry.files || [],
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt
    };
  }

  async readSkill(skillName) {
    await this.initialize();
    this._validateSkillName(skillName);
    const index = await this._loadIndex();
    if (!index.skills[skillName]) {
      throw new Error(`Skill not found: ${skillName}`);
    }

    const content = await fs.readFile(this._getSkillFilePath(skillName), 'utf8');
    const files = await this._listSkillFiles(skillName);

    return {
      name: skillName,
      content,
      files,
      description: index.skills[skillName].description
    };
  }

  async readSkillSection(skillName, sectionHeading) {
    await this.initialize();
    this._validateSkillName(skillName);
    const index = await this._loadIndex();
    if (!index.skills[skillName]) {
      throw new Error(`Skill not found: ${skillName}`);
    }

    const content = await fs.readFile(this._getSkillFilePath(skillName), 'utf8');
    const sections = this._extractSections(content);
    const lines = content.split('\n');

    // Find matching section (case-insensitive, with or without ## prefix)
    const needle = sectionHeading.replace(/^#+\s*/, '').toLowerCase();
    const match = sections.find(s =>
      s.heading.replace(/^#+\s*/, '').toLowerCase() === needle
    );

    if (!match) {
      const available = sections.map(s => s.heading).join(', ');
      throw new Error(`Section not found: "${sectionHeading}". Available sections: ${available}`);
    }

    const sectionContent = lines.slice(match.startLine - 1, match.endLine + 1).join('\n');
    return {
      name: skillName,
      section: match.heading,
      content: sectionContent,
      lineRange: { start: match.startLine, end: match.endLine }
    };
  }

  async readSkillFile(skillName, filePath) {
    await this.initialize();
    this._validateSkillName(skillName);
    const resolvedPath = this._validatePathSafe(skillName, filePath);

    try {
      const content = await fs.readFile(resolvedPath, 'utf8');
      return { name: skillName, file: filePath, content };
    } catch {
      throw new Error(`File not found: ${filePath} in skill ${skillName}`);
    }
  }

  async createSkill(skillName, content, additionalFiles = [], description = null) {
    await this.initialize();
    this._validateSkillName(skillName);

    const index = await this._loadIndex();
    if (index.skills[skillName]) {
      throw new Error(`Skill already exists: ${skillName}. Use "update" to modify it.`);
    }

    const skillDir = this._getSkillDir(skillName);
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(this._getSkillFilePath(skillName), content, 'utf8');

    // Write additional files
    for (const file of additionalFiles) {
      if (file.path && file.content) {
        const filePath = this._validatePathSafe(skillName, file.path);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, file.content, 'utf8');
      }
    }

    const entry = await this._buildIndexEntry(skillName, content, description || null);
    index.skills[skillName] = entry;
    await this._saveIndex(index);

    this.logger?.info('[SkillsService] Created skill', { name: skillName });
    return entry;
  }

  async updateSkill(skillName, content = null, additionalFiles = [], description = null) {
    await this.initialize();
    this._validateSkillName(skillName);

    const index = await this._loadIndex();
    if (!index.skills[skillName]) {
      throw new Error(`Skill not found: ${skillName}`);
    }

    if (content !== null) {
      await fs.writeFile(this._getSkillFilePath(skillName), content, 'utf8');
    } else {
      // Read existing content for re-indexing
      content = await fs.readFile(this._getSkillFilePath(skillName), 'utf8');
    }

    // Write additional files
    for (const file of additionalFiles) {
      if (file.path && file.content) {
        const filePath = this._validatePathSafe(skillName, file.path);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, file.content, 'utf8');
      }
    }

    // Use explicit description, or preserve existing one if not provided, or auto-extract
    const effectiveDescription = description || index.skills[skillName].description || null;
    const entry = await this._buildIndexEntry(skillName, content, effectiveDescription);
    entry.createdAt = index.skills[skillName].createdAt; // Preserve original creation time
    index.skills[skillName] = entry;
    await this._saveIndex(index);

    this.logger?.info('[SkillsService] Updated skill', { name: skillName });
    return entry;
  }

  async deleteSkill(skillName) {
    await this.initialize();
    this._validateSkillName(skillName);

    const index = await this._loadIndex();
    if (!index.skills[skillName]) {
      throw new Error(`Skill not found: ${skillName}`);
    }

    const skillDir = this._getSkillDir(skillName);
    await fs.rm(skillDir, { recursive: true, force: true });

    delete index.skills[skillName];
    await this._saveIndex(index);

    this.logger?.info('[SkillsService] Deleted skill', { name: skillName });
  }

  async importSkill(sourcePath, skillName = null, description = null) {
    await this.initialize();

    const resolvedSource = path.resolve(sourcePath);
    let stat;
    try {
      stat = await fs.stat(resolvedSource);
    } catch {
      throw new Error(`Source path not found: ${sourcePath}`);
    }

    // Derive skill name from source if not provided
    if (!skillName) {
      skillName = path.basename(resolvedSource, path.extname(resolvedSource))
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    }
    this._validateSkillName(skillName);

    const index = await this._loadIndex();
    if (index.skills[skillName]) {
      throw new Error(`Skill already exists: ${skillName}. Delete it first or choose a different name.`);
    }

    const skillDir = this._getSkillDir(skillName);
    await fs.mkdir(skillDir, { recursive: true });

    if (stat.isDirectory()) {
      // Copy entire directory
      await this._copyDir(resolvedSource, skillDir);
    } else {
      // Single file → becomes skill.md
      const content = await fs.readFile(resolvedSource, 'utf8');
      await fs.writeFile(this._getSkillFilePath(skillName), content, 'utf8');
    }

    // Verify skill.md exists
    try {
      await fs.access(this._getSkillFilePath(skillName));
    } catch {
      await fs.rm(skillDir, { recursive: true, force: true });
      throw new Error('Imported directory must contain a skill.md file');
    }

    const content = await fs.readFile(this._getSkillFilePath(skillName), 'utf8');
    const entry = await this._buildIndexEntry(skillName, content, description || null);
    index.skills[skillName] = entry;
    await this._saveIndex(index);

    this.logger?.info('[SkillsService] Imported skill', { name: skillName, source: sourcePath });
    return entry;
  }

  async _copyDir(src, dest) {
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await fs.mkdir(destPath, { recursive: true });
        await this._copyDir(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  async getSkillSummaries(skillNames) {
    await this.initialize();
    const index = await this._loadIndex();
    const summaries = [];

    for (const name of skillNames) {
      const entry = index.skills[name];
      if (entry) {
        summaries.push({
          name: entry.name,
          description: entry.description,
          sections: entry.sections || [],
          lineCount: entry.lineCount || 0
        });
      }
    }
    return summaries;
  }
}

// Singleton
let instance = null;

export function getSkillsService(logger = null) {
  if (!instance) {
    instance = new SkillsService(logger);
  }
  return instance;
}

export { SkillsService };
export default SkillsService;
