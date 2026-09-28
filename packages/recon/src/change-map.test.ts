import type { AppModel, Screen } from '@bugpatrol/core';
import { id } from '@bugpatrol/core';
import { describe, expect, it } from 'vitest';
import { buildFileIndex, buildTestPlan, smokeSet } from './change-map.js';

function screen(path: string, files: string[]): Screen {
  return {
    id: id.screen(path),
    urlPattern: path,
    title: path,
    description: '',
    entities: [],
    semanticHash: '',
    elements: [],
    geometry: [],
    sourceFiles: files.map(id.file),
    mappingConfidence: 0.9,
    baselineRefs: [],
    state: 'active',
  };
}

const screens = [
  screen('/dashboard', ['src/Dashboard.tsx', 'src/Button.tsx']),
  screen('/settings', ['src/Settings.tsx', 'src/Button.tsx']),
  screen('/billing', ['src/Billing.tsx', 'src/Button.tsx']),
  screen('/about', ['src/About.tsx']),
];

const model: AppModel = {
  id: id.model('m1'),
  projectId: id.project('p1'),
  version: 1,
  summary: { purpose: '', audience: '', domainVocabulary: [], coreEntities: [] },
  screens,
  flows: [
    {
      id: id.flow('signup'),
      name: 'sign up',
      goal: '',
      steps: [],
      screens: [id.screen('/dashboard')],
      criticality: 'entry',
    },
  ],
  edges: [],
  fileIndex: buildFileIndex({ screens }),
  generatedBy: { model: 'test', version: '1', ranAt: new Date(), costUsd: 0 },
};

describe('buildTestPlan', () => {
  it('selects every screen that renders a changed shared component', () => {
    // The most valuable and most easily missed step: a design-system change
    // touches everything.
    const plan = buildTestPlan({ model, changedFiles: [id.file('src/Button.tsx')] });
    const selected = plan.items.filter((i) => i.target.screenId).map((i) => String(i.target.screenId));
    expect(selected).toEqual(expect.arrayContaining(['/dashboard', '/settings', '/billing']));
  });

  it('labels a shared component differently from a direct change', () => {
    const shared = buildTestPlan({ model, changedFiles: [id.file('src/Button.tsx')] });
    expect(shared.items.some((i) => i.reason === 'shared-component')).toBe(true);

    const direct = buildTestPlan({ model, changedFiles: [id.file('src/About.tsx')] });
    expect(direct.items.find((i) => String(i.target.screenId) === '/about')?.reason).toBe('direct-change');
  });

  it('expands to flows containing an affected screen', () => {
    const plan = buildTestPlan({ model, changedFiles: [id.file('src/Dashboard.tsx')] });
    expect(plan.items.some((i) => String(i.target.flowId) === 'signup')).toBe(true);
  });

  it('falls back to a smoke set and reports low confidence rather than under-testing', () => {
    const plan = buildTestPlan({ model, changedFiles: [id.file('vite.config.ts')] });
    expect(plan.mappingConfidence).toBe(0);
    expect(plan.items.some((i) => i.reason === 'smoke-fallback')).toBe(true);
  });

  it('always includes the always-on invariants', () => {
    const plan = buildTestPlan({ model, changedFiles: [] });
    expect(plan.items.filter((i) => i.reason === 'always-on').length).toBeGreaterThan(0);
  });

  it('reports coverage honestly', () => {
    const plan = buildTestPlan({ model, changedFiles: [id.file('src/About.tsx')] });
    expect(plan.coverage).toEqual({ screensSelected: 1, screensTotal: 4 });
  });
});

describe('smokeSet', () => {
  it('always includes flow entry points', () => {
    expect(smokeSet(model)).toContain(id.screen('/dashboard'));
  });
});
