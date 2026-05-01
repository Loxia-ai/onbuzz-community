import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import ProjectDetector, { getProjectDetector, PROJECT_TYPES } from '../projectDetector.js';

describe('ProjectDetector', () => {
  test('constructor creates instance', () => {
    const detector = new ProjectDetector();
    expect(detector).toBeInstanceOf(ProjectDetector);
  });

  test('getProjectDetector returns a ProjectDetector instance (singleton)', () => {
    const detector1 = getProjectDetector();
    const detector2 = getProjectDetector();
    expect(detector1).toBeInstanceOf(ProjectDetector);
    expect(detector1).toBe(detector2);
  });

  test('PROJECT_TYPES has expected values', () => {
    expect(PROJECT_TYPES.REACT_CRA).toBe('react-cra');
    expect(PROJECT_TYPES.NEXTJS).toBe('nextjs');
    expect(PROJECT_TYPES.STATIC_HTML).toBe('static-html');
    expect(PROJECT_TYPES.UNKNOWN).toBe('unknown');
    expect(PROJECT_TYPES.ANGULAR).toBe('angular');
    expect(PROJECT_TYPES.VUE_VITE).toBe('vue-vite');
  });

  test('detect returns object with projectType property', async () => {
    const detector = new ProjectDetector();
    const result = await detector.detect(process.cwd());
    expect(result).toHaveProperty('projectType');
    expect(result).toHaveProperty('projectDir');
    expect(result).toHaveProperty('entryPoints');
    expect(typeof result.projectType).toBe('string');
  });
});
