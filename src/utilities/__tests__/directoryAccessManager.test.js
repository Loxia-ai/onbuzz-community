import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import path from 'path';
import os from 'os';
import DirectoryAccessManager from '../directoryAccessManager.js';
import { createMockLogger } from '../../__test-utils__/mockFactories.js';

describe('DirectoryAccessManager', () => {
  let dam;
  let logger;
  const projectDir = path.resolve('/tmp/test-project');

  beforeEach(() => {
    logger = createMockLogger();
    dam = new DirectoryAccessManager({}, logger);
  });

  test('createDirectoryAccess returns config with working directory', () => {
    const access = dam.createDirectoryAccess({
      workingDirectory: projectDir
    });
    expect(access).toHaveProperty('workingDirectory');
    expect(access.workingDirectory).toBe(projectDir);
    expect(access).toHaveProperty('readOnlyDirectories');
    expect(access).toHaveProperty('writeEnabledDirectories');
    expect(access).toHaveProperty('restrictToProject');
    expect(access).toHaveProperty('version', '1.0');
    expect(access).toHaveProperty('createdAt');
  });

  test('createDirectoryAccess includes workingDir in readOnly when restrictToProject', () => {
    const access = dam.createDirectoryAccess({
      workingDirectory: projectDir,
      restrictToProject: true
    });
    expect(access.readOnlyDirectories).toContain(projectDir);
  });

  test('createDirectoryAccess filters writeEnabled dirs outside project when restricted', () => {
    const access = dam.createDirectoryAccess({
      workingDirectory: projectDir,
      restrictToProject: true,
      writeEnabledDirectories: ['/tmp/other-project']
    });
    // /tmp/other-project is outside projectDir, should be filtered
    expect(access.writeEnabledDirectories).not.toContain(path.resolve('/tmp/other-project'));
  });

  test('createDirectoryAccess resolves custom restrictions to absolute paths', () => {
    const access = dam.createDirectoryAccess({
      workingDirectory: projectDir,
      customRestrictions: ['sensitive']
    });
    expect(access.customRestrictions[0]).toBe(path.resolve('sensitive'));
  });

  // ─── validateReadAccess ────────────────────────────────────────

  test('validateReadAccess allows path within project', () => {
    const access = dam.createDirectoryAccess({
      workingDirectory: projectDir
    });
    const filePath = path.join(projectDir, 'src', 'index.js');
    const result = dam.validateReadAccess(filePath, access);
    expect(result.allowed).toBe(true);
    expect(result.category).toBe('allowed');
  });

  test('validateReadAccess denies system paths', () => {
    const access = dam.createDirectoryAccess({
      workingDirectory: projectDir
    });
    const systemPath = process.platform === 'win32'
      ? 'C:\\Windows\\System32\\config'
      : '/etc/passwd';
    const result = dam.validateReadAccess(systemPath, access);
    expect(result.allowed).toBe(false);
    expect(result.category).toBe('system_restricted');
  });

  test('validateReadAccess allows system paths when allowSystemAccess is true', () => {
    const sshPath = path.join(os.homedir(), '.ssh', 'known_hosts');
    const access = dam.createDirectoryAccess({
      workingDirectory: projectDir,
      allowSystemAccess: true,
      restrictToProject: false,
      readOnlyDirectories: [os.homedir()]
    });
    const result = dam.validateReadAccess(sshPath, access);
    expect(result.allowed).toBe(true);
  });

  test('validateReadAccess denies custom restricted paths', () => {
    const restrictedDir = path.join(projectDir, 'secrets');
    const access = dam.createDirectoryAccess({
      workingDirectory: projectDir,
      customRestrictions: [restrictedDir]
    });
    const result = dam.validateReadAccess(path.join(restrictedDir, 'key.pem'), access);
    expect(result.allowed).toBe(false);
    expect(result.category).toBe('custom_restricted');
  });

  test('validateReadAccess denies path outside project scope', () => {
    const access = dam.createDirectoryAccess({
      workingDirectory: projectDir,
      restrictToProject: true
    });
    const result = dam.validateReadAccess('/tmp/other-project/file.js', access);
    expect(result.allowed).toBe(false);
    expect(result.category).toBe('project_restricted');
  });

  test('validateReadAccess handles validation errors gracefully', () => {
    const access = dam.createDirectoryAccess({
      workingDirectory: projectDir
    });
    // Pass an object instead of string to trigger error
    const result = dam.validateReadAccess(null, access);
    expect(result.allowed).toBe(false);
    expect(result.category).toBe('validation_error');
  });

  // ─── validateWriteAccess ───────────────────────────────────────

  test('validateWriteAccess allows within write-enabled directory', () => {
    const access = dam.createDirectoryAccess({
      workingDirectory: projectDir,
      writeEnabledDirectories: [projectDir]
    });
    const filePath = path.join(projectDir, 'output.txt');
    const result = dam.validateWriteAccess(filePath, access);
    expect(result.allowed).toBe(true);
    expect(result.writeAllowed).toBe(true);
    expect(result.category).toBe('write_allowed');
  });

  test('validateWriteAccess denies write to read-only directory', () => {
    const readOnlyDir = path.join(projectDir, 'readonly');
    const access = dam.createDirectoryAccess({
      workingDirectory: projectDir,
      readOnlyDirectories: [readOnlyDir],
      writeEnabledDirectories: [path.join(projectDir, 'writable')],
      restrictToProject: false
    });
    const result = dam.validateWriteAccess(path.join(readOnlyDir, 'file.txt'), access);
    expect(result.allowed).toBe(false);
    expect(result.writeAllowed).toBe(false);
    expect(result.category).toBe('read_only_restricted');
  });

  test('validateWriteAccess denies write outside write-enabled directories', () => {
    const writeDir = path.join(projectDir, 'output');
    const access = dam.createDirectoryAccess({
      workingDirectory: projectDir,
      writeEnabledDirectories: [writeDir],
      restrictToProject: false
    });
    const otherPath = path.join(projectDir, 'src', 'file.js');
    const result = dam.validateWriteAccess(otherPath, access);
    expect(result.allowed).toBe(false);
    expect(result.writeAllowed).toBe(false);
    expect(result.category).toBe('write_restricted');
  });

  test('validateWriteAccess falls back to workingDirectory when no writeEnabled dirs', () => {
    const access = dam.createDirectoryAccess({
      workingDirectory: projectDir,
      writeEnabledDirectories: [],
      restrictToProject: true
    });
    // Manually clear writeEnabledDirectories that createDirectoryAccess may have filtered
    access.writeEnabledDirectories = [];
    const filePath = path.join(projectDir, 'output.txt');
    const result = dam.validateWriteAccess(filePath, access);
    expect(result.allowed).toBe(true);
    expect(result.writeAllowed).toBe(true);
  });

  test('validateWriteAccess propagates read-access denial', () => {
    const access = dam.createDirectoryAccess({
      workingDirectory: projectDir
    });
    const systemPath = process.platform === 'win32'
      ? 'C:\\Windows\\System32\\config\\test.txt'
      : '/etc/shadow';
    const result = dam.validateWriteAccess(systemPath, access);
    expect(result.allowed).toBe(false);
    expect(result.writeAllowed).toBe(false);
  });

  // ─── getWorkingDirectory ───────────────────────────────────────

  test('getWorkingDirectory returns workingDirectory from config', () => {
    const access = dam.createDirectoryAccess({ workingDirectory: projectDir });
    expect(dam.getWorkingDirectory(access)).toBe(projectDir);
  });

  test('getWorkingDirectory falls back to cwd when no workingDirectory', () => {
    expect(dam.getWorkingDirectory({})).toBe(process.cwd());
  });

  // ─── getAccessibleDirectories ──────────────────────────────────

  test('getAccessibleDirectories returns directory listing', () => {
    const access = dam.createDirectoryAccess({
      workingDirectory: projectDir,
      readOnlyDirectories: [path.join(projectDir, 'docs')],
      writeEnabledDirectories: [path.join(projectDir, 'src')]
    });
    const result = dam.getAccessibleDirectories(access);
    expect(result.workingDirectory).toBe(projectDir);
    expect(result.readOnly).toContain(projectDir); // workingDir added
    expect(result.projectRestricted).toBe(true);
    expect(result.systemAccessAllowed).toBe(false);
    expect(typeof result.totalDirectories).toBe('number');
  });

  // ─── updateDirectoryAccess ─────────────────────────────────────

  test('updateDirectoryAccess updates working directory', () => {
    const access = dam.createDirectoryAccess({ workingDirectory: projectDir });
    const updated = dam.updateDirectoryAccess(access, {
      workingDirectory: '/tmp/new-project'
    });
    expect(updated.workingDirectory).toBe(path.resolve('/tmp/new-project'));
    expect(updated.updatedAt).toBeDefined();
  });

  test('updateDirectoryAccess updates readOnlyDirectories', () => {
    const access = dam.createDirectoryAccess({ workingDirectory: projectDir });
    const updated = dam.updateDirectoryAccess(access, {
      readOnlyDirectories: ['/tmp/docs']
    });
    // The stored path may be normalized differently per platform
    const hasDocsPath = updated.readOnlyDirectories.some(d => d.includes('tmp') && d.includes('docs'));
    expect(hasDocsPath).toBe(true);
  });

  test('updateDirectoryAccess updates writeEnabledDirectories', () => {
    const access = dam.createDirectoryAccess({ workingDirectory: projectDir });
    const updated = dam.updateDirectoryAccess(access, {
      writeEnabledDirectories: [projectDir]
    });
    expect(updated.writeEnabledDirectories).toContain(projectDir);
  });

  test('updateDirectoryAccess updates boolean flags', () => {
    const access = dam.createDirectoryAccess({ workingDirectory: projectDir });
    const updated = dam.updateDirectoryAccess(access, {
      restrictToProject: false,
      allowSystemAccess: true
    });
    expect(updated.restrictToProject).toBe(false);
    expect(updated.allowSystemAccess).toBe(true);
  });

  test('updateDirectoryAccess updates customRestrictions', () => {
    const access = dam.createDirectoryAccess({ workingDirectory: projectDir });
    const updated = dam.updateDirectoryAccess(access, {
      customRestrictions: ['/tmp/restricted']
    });
    expect(updated.customRestrictions).toContain(path.resolve('/tmp/restricted'));
  });

  test('updateDirectoryAccess preserves version', () => {
    const access = dam.createDirectoryAccess({ workingDirectory: projectDir });
    const updated = dam.updateDirectoryAccess(access, {});
    expect(updated.version).toBe('1.0');
  });

  // ─── validateAccessConfiguration ──────────────────────────────

  test('validateAccessConfiguration validates valid config', () => {
    const access = dam.createDirectoryAccess({
      workingDirectory: projectDir,
      writeEnabledDirectories: [projectDir]
    });
    const result = dam.validateAccessConfiguration(access);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.summary).toBeDefined();
  });

  test('validateAccessConfiguration errors on missing workingDirectory', () => {
    const config = {
      readOnlyDirectories: [],
      writeEnabledDirectories: []
    };
    const result = dam.validateAccessConfiguration(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Working directory'))).toBe(true);
  });

  test('validateAccessConfiguration errors on non-array directories', () => {
    const result = dam.validateAccessConfiguration({
      workingDirectory: projectDir,
      readOnlyDirectories: 'not-array',
      writeEnabledDirectories: 'not-array'
    });
    expect(result.errors.some(e => e.includes('readOnlyDirectories must be an array'))).toBe(true);
    expect(result.errors.some(e => e.includes('writeEnabledDirectories must be an array'))).toBe(true);
  });

  test('validateAccessConfiguration warns on overlapping directories', () => {
    const result = dam.validateAccessConfiguration({
      workingDirectory: projectDir,
      readOnlyDirectories: [projectDir],
      writeEnabledDirectories: [projectDir],
      allowSystemAccess: false,
      restrictToProject: true
    });
    expect(result.warnings.some(w => w.includes('Overlapping'))).toBe(true);
  });

  test('validateAccessConfiguration warns on system access enabled', () => {
    const result = dam.validateAccessConfiguration({
      workingDirectory: projectDir,
      readOnlyDirectories: [],
      writeEnabledDirectories: [],
      allowSystemAccess: true
    });
    expect(result.warnings.some(w => w.includes('System path access'))).toBe(true);
  });

  // ─── createRelativePath ────────────────────────────────────────

  test('createRelativePath converts absolute to relative', () => {
    const access = dam.createDirectoryAccess({
      workingDirectory: projectDir,
      writeEnabledDirectories: [projectDir]
    });
    const absPath = path.join(projectDir, 'src', 'index.js');
    const result = dam.createRelativePath(absPath, access);
    expect(result).toBe(path.join('src', 'index.js'));
  });

  test('createRelativePath returns original when not within any directory', () => {
    const access = dam.createDirectoryAccess({
      workingDirectory: projectDir,
      readOnlyDirectories: [],
      writeEnabledDirectories: []
    });
    // Clear auto-added dirs
    access.readOnlyDirectories = [];
    access.writeEnabledDirectories = [];
    access.workingDirectory = '/nonexistent';
    const absPath = '/completely/different/path.js';
    const result = dam.createRelativePath(absPath, access);
    expect(result).toBe(absPath);
  });

  // ─── getAccessSummary ──────────────────────────────────────────

  test('getAccessSummary returns summary object', () => {
    const access = dam.createDirectoryAccess({
      workingDirectory: projectDir,
      writeEnabledDirectories: [projectDir]
    });
    const summary = dam.getAccessSummary(access);
    expect(summary.workingDirectory).toBe(projectDir);
    expect(typeof summary.readOnlyCount).toBe('number');
    expect(typeof summary.writeEnabledCount).toBe('number');
    expect(typeof summary.projectRestricted).toBe('boolean');
    expect(typeof summary.systemAccessAllowed).toBe('boolean');
    expect(typeof summary.customRestrictionsCount).toBe('number');
    expect(summary.configVersion).toBe('1.0');
    expect(summary.lastUpdated).toBeDefined();
  });

  // ─── Static methods ───────────────────────────────────────────

  test('createProjectDefaults returns config for given directory', () => {
    const defaults = DirectoryAccessManager.createProjectDefaults(projectDir);
    expect(defaults.workingDirectory).toBe(projectDir);
    expect(defaults.readOnlyDirectories).toContain(projectDir);
    expect(defaults.writeEnabledDirectories).toContain(projectDir);
    expect(defaults.restrictToProject).toBe(true);
    expect(defaults.allowSystemAccess).toBe(false);
  });

  test('createPermissiveDefaults returns permissive config', () => {
    const defaults = DirectoryAccessManager.createPermissiveDefaults(projectDir);
    expect(defaults.workingDirectory).toBe(projectDir);
    expect(defaults.restrictToProject).toBe(false);
    expect(defaults.allowSystemAccess).toBe(false);
    expect(defaults.writeEnabledDirectories).toContain(projectDir);
  });
});
