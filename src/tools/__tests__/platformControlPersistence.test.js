/**
 * Persistence round-trip tests for platformcontrol's createdBy field.
 *
 * Pin that the field we stamp on agent and team records ACTUALLY survives
 * save → load. Without these tests, a future refactor that strips
 * "unknown" fields during normalization (or adds a JSON schema with a
 * fixed allow-list) could silently drop createdBy and every "self-created"
 * permission check would quietly pass through to "all" mode.
 *
 * Strategy: redirect userDataDir to a tmpdir, instantiate the real
 * StateManager + AgentPool stubs, exercise the actual save/load paths,
 * read the on-disk JSON back, assert the field is present.
 */

import { jest, describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

let tmpRoot;

// IMPORTANT: this mock redirects every userDataDir read into a tmpdir.
// Done with unstable_mockModule so it applies before StateManager is imported.
jest.unstable_mockModule('../../utilities/userDataDir.js', () => ({
  getUserDataDir: () => tmpRoot,
  getUserDataPaths: () => ({
    base:            tmpRoot,
    state:           path.join(tmpRoot, 'state'),
    agents:          path.join(tmpRoot, 'state', 'agents'),
    settings:        path.join(tmpRoot, 'settings'),
    attachments:     path.join(tmpRoot, 'attachments'),
    logs:            path.join(tmpRoot, 'logs'),
    cache:           path.join(tmpRoot, 'cache'),
    operations:      path.join(tmpRoot, 'state', 'operations'),
    models:          path.join(tmpRoot, 'state', 'models'),
    runtime:         path.join(tmpRoot, 'runtime'),
    skills:          path.join(tmpRoot, 'state', 'skills'),
    gallery:         path.join(tmpRoot, 'gallery'),
    galleryImages:   path.join(tmpRoot, 'gallery', 'images'),
    galleryVideos:   path.join(tmpRoot, 'gallery', 'videos'),
  }),
  ensureUserDataDirs: async () => {},
}));

const { default: StateManager } = await import('../../core/stateManager.js');

const LOGGER = { info() {}, warn() {}, error() {}, debug() {} };

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pc-persistence-'));
  await fs.mkdir(path.join(tmpRoot, 'state', 'agents'),     { recursive: true });
  await fs.mkdir(path.join(tmpRoot, 'state', 'operations'), { recursive: true });
});
afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
});

describe('team — createdBy survives save → load', () => {
  let sm;
  beforeEach(async () => {
    sm = new StateManager({}, LOGGER);
    // Fresh team index for each test
    const teamIndexPath = path.join(tmpRoot, 'state', 'team-index.json');
    await fs.writeFile(teamIndexPath, '{}');
  });

  test('createdBy persists through createTeam → getAllTeams', async () => {
    const team = await sm.createTeam({ name: 'Squad', createdBy: 'agent-7' });
    expect(team.createdBy).toBe('agent-7');
    // Round-trip: read fresh through getAllTeams
    const fresh = await sm.getAllTeams();
    const found = fresh.find(t => t.id === team.id);
    expect(found).toBeDefined();
    expect(found.createdBy).toBe('agent-7');
  });

  test('createdBy is also visible on disk (raw JSON read)', async () => {
    const team = await sm.createTeam({ name: 'Disk-check', createdBy: 'agent-7' });
    const raw = JSON.parse(await fs.readFile(path.join(tmpRoot, 'state', 'team-index.json'), 'utf8'));
    expect(raw[team.id].createdBy).toBe('agent-7');
  });

  test('createdBy survives an updateTeam call (not stripped by allowed-fields filter)', async () => {
    const team = await sm.createTeam({ name: 'Original', createdBy: 'agent-7' });
    await sm.updateTeam(team.id, { name: 'Renamed', description: 'updated' });
    const fresh = await sm.getTeam(team.id);
    expect(fresh.createdBy).toBe('agent-7');
    expect(fresh.name).toBe('Renamed');
  });

  test('null createdBy (UI-created team) round-trips as null', async () => {
    const team = await sm.createTeam({ name: 'UI-team' });
    expect(team.createdBy).toBeNull();
    const fresh = await sm.getTeam(team.id);
    expect(fresh.createdBy).toBeNull();
  });
});

describe('agent — createdBy survives persist → reload', () => {
  // The full agentPool is too heavy to construct in a unit test; we exercise
  // the persistence layer directly. agentPool.createAgent already sets
  // createdBy on the agent object (covered separately by the tool tests),
  // so the only thing we need to pin here is that StateManager's
  // persistAgentState writes the field through saveJSON intact.
  let sm;
  beforeEach(() => { sm = new StateManager({}, LOGGER); });

  test('createdBy is included in the persisted agent JSON state', async () => {
    const agent = {
      id: 'agent-test-1',
      name: 'Persistence test',
      createdBy: 'parent-agent',
      conversations: {},   // separated by persistAgentState
      otherField: 42,
    };
    await sm.persistAgentState(agent, tmpRoot);
    const stateFile = path.join(tmpRoot, 'state', 'agents', `agent-${agent.id}-state.json`);
    const raw = JSON.parse(await fs.readFile(stateFile, 'utf8'));
    expect(raw.state.createdBy).toBe('parent-agent');
    expect(raw.state.id).toBe('agent-test-1');
    // Other fields still present too
    expect(raw.state.otherField).toBe(42);
  });

  test('null createdBy (UI-created agent) round-trips as null', async () => {
    const agent = {
      id: 'agent-test-2', name: 'UI', createdBy: null, conversations: {},
    };
    await sm.persistAgentState(agent, tmpRoot);
    const stateFile = path.join(tmpRoot, 'state', 'agents', `agent-${agent.id}-state.json`);
    const raw = JSON.parse(await fs.readFile(stateFile, 'utf8'));
    expect(raw.state).toHaveProperty('createdBy', null);
  });
});
