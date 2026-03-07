import { describe, it, expect } from 'vitest';
import {
  PROJECT_INIT_STEPS,
  getProjectInitSteps,
} from '../src/system/project-init.js';

describe('Project Init Steps', () => {
  it('should have 5 steps', () => {
    expect(PROJECT_INIT_STEPS).toHaveLength(5);
  });

  it('should have correct step IDs', () => {
    const ids = PROJECT_INIT_STEPS.map(s => s.id);
    expect(ids).toEqual(['preflight', 'identity', 'interview', 'seed-data', 'verify']);
  });

  it('each step should have id, name, and description', () => {
    for (const step of PROJECT_INIT_STEPS) {
      expect(step.id).toBeTruthy();
      expect(step.name).toBeTruthy();
      expect(step.description).toBeTruthy();
    }
  });

  it('getProjectInitSteps should return a copy', () => {
    const steps = getProjectInitSteps();
    expect(steps).toEqual(PROJECT_INIT_STEPS);
    expect(steps).not.toBe(PROJECT_INIT_STEPS); // different reference
  });
});
