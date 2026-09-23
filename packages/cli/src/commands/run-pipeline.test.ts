import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig, ExitCode, type AutoQAConfig } from '@autoqa/core';
import type { ScreenSnapshot } from '@autoqa/invariants';
import type { CrossCheckResult, DiffResult } from '@autoqa/diff';
import { executeRun, PIXEL_DIFF_RULE, type CapturedScreen } from './run-pipeline.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'autoqa-pipeline-'));
  mkdirSync(join(root, '.autoqa'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const config: AutoQAConfig = parseConfig({
  version: 1,
  run: { command: 'noop', url: 'http://localhost:3000' },
});

function snapshot(overrides: Partial<ScreenSnapshot> = {}): ScreenSnapshot {
  return {
    screenId: '/',
    viewport: { name: 'desktop', width: 1440, height: 900 },
    url: 'http://localhost:3000/',
    elements: [],
    document: { scrollWidth: 1440, clientWidth: 1440, scrollHeight: 900, clientHeight: 900, hasStylesheets: true },
    images: [],
    consoleErrors: [],
    ...overrides,
  };
}

function comparison(changedPixels: number, extra: Partial<DiffResult> = {}): CrossCheckResult {
  return {
    agreed: true,
    primary: {
      engine: 'odiff',
      identical: changedPixels === 0,
      changedPixels,
      changedFraction: changedPixels / 1_000_000,
      comparedPixels: 1_000_000,
      totalPixels: 1_000_000,
      maskedFraction: 0,
      maskedRegionCount: 0,
      regions: changedPixels > 0 ? [{ x: 10, y: 10, width: 50, height: 20 }] : [],
      durationMs: 1,
      ...extra,
    },
  };
}

function screen(overrides: Partial<CapturedScreen> = {}): CapturedScreen {
  return {
    screenId: '/',
    url: 'http://localhost:3000/',
    viewport: 'desktop',
    snapshot: snapshot(),
    baselineCreated: false,
    comparison: comparison(0),
    artifacts: { actual: '/tmp/a.png', baseline: '/tmp/b.png' },
    planReason: 'always-on',
    ...overrides,
  };
}

const base = {
  config,
  mode: 'changed-only' as const,
  trigger: 'manual' as const,
  commit: 'abc123',
  noModels: true,
  totalScreens: 1,
};

describe('executeRun', () => {
  it('passes cleanly when the capture matches its baseline', async () => {
    const result = await executeRun({ ...base, root, isFirstRun: false, screens: [screen()] });
    expect(result.exitCode).toBe(ExitCode.Clean);
    expect(result.findings).toHaveLength(0);
  });

  it('blocks on a pixel regression even with no decision layer', async () => {
    // --no-models must still gate. The decision layer classifies and
    // suppresses; it does not grant permission to block.
    const result = await executeRun({
      ...base,
      root,
      isFirstRun: false,
      screens: [screen({ comparison: comparison(2400) })],
    });
    expect(result.exitCode).toBe(ExitCode.Regression);
    const blocking = result.findings.filter((f) => f.route === 'check');
    expect(blocking).toHaveLength(1);
    expect(blocking[0]!.ruleId).toBe(PIXEL_DIFF_RULE);
  });

  it('never blocks on a run that just created the baseline', async () => {
    // Nothing can regress against a baseline it created moments ago.
    const result = await executeRun({
      ...base,
      root,
      isFirstRun: true,
      screens: [screen({ baselineCreated: true, comparison: undefined, artifacts: { actual: '/tmp/a.png' } })],
    });
    expect(result.exitCode).toBe(ExitCode.Clean);
    expect(result.notes.join(' ')).toContain('captured for the first time');
  });

  it('reports but does not block on the first run', async () => {
    const result = await executeRun({
      ...base,
      root,
      isFirstRun: true,
      screens: [screen({ comparison: comparison(9000) })],
    });
    expect(result.exitCode).toBe(ExitCode.Clean);
    expect(result.findings.some((f) => f.ruleId === PIXEL_DIFF_RULE)).toBe(true);
    expect(result.notes.join(' ')).toMatch(/reporting only|do not block/i);
  });

  it('flags a hollow test when most of the screen is masked', async () => {
    const result = await executeRun({
      ...base,
      root,
      isFirstRun: false,
      screens: [screen({ comparison: comparison(0, { maskedFraction: 0.7, maskedRegionCount: 3 }) })],
    });
    expect(result.findings.some((f) => f.ruleId === 'visual/hollow-test')).toBe(true);
  });

  it('says so when a screen has no baseline to verify against', async () => {
    const result = await executeRun({
      ...base,
      root,
      isFirstRun: false,
      screens: [screen({ comparison: undefined, artifacts: { actual: '/tmp/a.png' } })],
    });
    expect(result.findings.some((f) => f.ruleId === 'visual/baseline-missing')).toBe(true);
  });

  it('attaches before/after/diff evidence to a regression', async () => {
    const result = await executeRun({
      ...base,
      root,
      isFirstRun: false,
      screens: [
        screen({
          comparison: comparison(2400),
          artifacts: { actual: '/tmp/a.png', baseline: '/tmp/b.png', diff: '/tmp/d.png' },
        }),
      ],
    });
    const finding = result.findings.find((f) => f.ruleId === PIXEL_DIFF_RULE)!;
    expect(finding.evidence.before).toBe('/tmp/b.png');
    expect(finding.evidence.after).toBe('/tmp/a.png');
    expect(finding.evidence.diff).toBe('/tmp/d.png');
  });

  it('surfaces an engine disagreement as a capture problem, not a product one', async () => {
    const result = await executeRun({
      ...base,
      root,
      isFirstRun: false,
      screens: [screen({ comparison: { ...comparison(2400), agreed: false, crossCheck: comparison(50).primary } })],
    });
    const finding = result.findings.find((f) => f.ruleId === 'visual/engine-disagreement');
    expect(finding?.summary).toContain('capture');
  });

  it('writes every report surface', async () => {
    const result = await executeRun({
      ...base,
      root,
      isFirstRun: false,
      screens: [screen({ comparison: comparison(2400) })],
    });
    const { existsSync } = await import('node:fs');
    const dir = join(result.reportPath, '..');
    for (const file of ['report.html', 'junit.xml', 'results.sarif', 'run.json']) {
      expect(existsSync(join(dir, file))).toBe(true);
    }
  });

  it('reports coverage against the whole app, not just what it captured', async () => {
    const result = await executeRun({
      ...base,
      root,
      totalScreens: 40,
      isFirstRun: false,
      screens: [screen()],
    });
    expect(result.run.plan.coverage).toEqual({ screensSelected: 1, screensTotal: 40 });
  });
});

describe('finding identity', () => {
  it('gives two violations of one rule in the same grid cell distinct ids', async () => {
    // Two small tap targets side by side land in one 32px fingerprint cell.
    // Without the element in the fingerprint they shared an id.
    const tiny = (selector: string, x: number) => ({
      selector, box: { x, y: 0, width: 12, height: 12 }, visible: true, rendered: true,
      interactive: true, zIndex: 0, hitSelector: selector,
    });
    const result = await executeRun({
      ...base,
      root,
      isFirstRun: false,
      screens: [screen({ snapshot: snapshot({ elements: [tiny('#a', 0), tiny('#b', 14)] }) })],
    });
    const taps = result.findings.filter((f) => f.ruleId === 'usability/tap-target');
    expect(taps).toHaveLength(2);
    expect(new Set(taps.map((f) => f.id)).size).toBe(2);
  });
});
