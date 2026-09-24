import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '@autoqa/core';
import { AgentSession } from './session.js';
import { Vars } from './vars.js';
import { Workspace } from './workspace.js';
import { FakeDriver, type FakeScreen } from './testing/fake-driver.js';
import { evaluateScreen, groupViolations } from './evaluate.js';
import { judgeTools } from './tools/judge.js';

const config = parseConfig({ version: 1, app: { connect: { url: 'fake://home' } }, decisions: { decider: 'heuristic' } });

// Three 12px buttons: each breaks the tap-target rule on its own.
const tiny = (ref: string, x: number) => ({
  ref, role: 'button', name: `Tiny ${ref}`, box: { x, y: 100, width: 12, height: 12 }, interactive: true, enabled: true,
});
const screens: Record<string, FakeScreen> = {
  home: { elements: [tiny('e1', 10), tiny('e2', 60), tiny('e3', 110)], color: 30 },
};

async function capture(root: string) {
  const workspace = new Workspace(root);
  const record = await workspace.startSession('explorer');
  const driver = new FakeDriver(screens);
  await driver.connect();
  const session = new AgentSession(root, config, new Vars(), record.id, 'explorer', driver);
  const observation = await driver.observe();
  const snapshot = driver.snapshot(observation, 'home');
  const candidates = await evaluateScreen(session, { screenId: 'home', observation, snapshot });
  return { workspace, session, candidates };
}

describe('evaluateScreen', () => {
  it('runs the absolute checks on first sight and groups one rule into one candidate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'autoqa-eval-'));
    try {
      const { candidates } = await capture(root);
      const taps = candidates.filter((item) => item.ruleId === 'usability/tap-target');
      expect(taps).toHaveLength(1);
      expect(taps[0]!.summary).toMatch(/^3 elements/);
      expect(taps[0]!.evidence.baseline).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not raise a fingerprint the judge dismissed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'autoqa-eval-'));
    try {
      const first = await capture(root);
      const record = await first.workspace.startSession('judge');
      const judge = new AgentSession(root, config, new Vars(), record.id, 'judge');
      const dismiss = judgeTools(judge, [first.session.sessionId], 'test').find((tool) => tool.name === 'dismiss')!;
      await dismiss.run({ candidate_ids: first.candidates.map((item) => item.id), reason: 'Icon buttons by design' });

      const second = await capture(root);
      expect(second.candidates.filter((item) => item.ruleId === 'usability/tap-target')).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('adds an occurrence to a filed issue instead of a new candidate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'autoqa-eval-'));
    try {
      const first = await capture(root);
      const record = await first.workspace.startSession('judge');
      const judge = new AgentSession(root, config, new Vars(), record.id, 'judge');
      const file = judgeTools(judge, [first.session.sessionId], 'test').find((tool) => tool.name === 'file_issue')!;
      await file.run({
        candidate_ids: first.candidates.map((item) => item.id),
        title: 'Buttons are too small to tap',
        body: '**What happened** ...',
        severity: 'minor',
        reason: 'Three controls are 12px.',
      });
      const [issue] = await first.workspace.listIssues();

      const second = await capture(root);
      expect(second.candidates.filter((item) => item.ruleId === 'usability/tap-target')).toHaveLength(0);
      expect((await first.workspace.readIssue(issue!.id))!.occurrences).toBe(issue!.occurrences + 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('file_issue with issue_id', () => {
  it('adds a new session\'s candidates to the named open issue', async () => {
    const root = await mkdtemp(join(tmpdir(), 'autoqa-eval-'));
    try {
      const first = await capture(root);
      const judgeOnce = async (sessionId: string, input: Record<string, unknown>) => {
        const record = await first.workspace.startSession('judge');
        const judge = new AgentSession(root, config, new Vars(), record.id, 'judge');
        const tool = judgeTools(judge, [sessionId], 'test').find((item) => item.name === 'file_issue')!;
        return tool.run(input);
      };
      await judgeOnce(first.session.sessionId, {
        candidate_ids: first.candidates.map((item) => item.id),
        title: 'Buttons are too small to tap', body: 'x', severity: 'minor', reason: 'Three 12px controls.',
      });
      const [issue] = await first.workspace.listIssues();

      // A later session raises the same problem under another fingerprint.
      const other = await first.workspace.startSession('explorer');
      const candidate = { ...first.candidates[0]!, id: 'can_other', sessionId: other.id, fingerprint: 'different' };
      await first.workspace.appendCandidate(other.id, candidate);
      const result = await judgeOnce(other.id, { candidate_ids: ['can_other'], issue_id: issue!.id, reason: 'Same.' });

      expect(result.isError).toBeFalsy();
      expect(await first.workspace.listIssues()).toHaveLength(1);
      const updated = await first.workspace.readIssue(issue!.id);
      expect(updated).toMatchObject({ occurrences: 2 });
      expect(updated!.candidateIds).toContain('can_other');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('groupViolations', () => {
  it('keeps the worst severity of the group', () => {
    const entries = groupViolations([
      { ruleId: 'layout/overlap', message: 'a overlaps b', severity: 'minor', selector: '#a' },
      { ruleId: 'layout/overlap', message: 'c overlaps d', severity: 'major', selector: '#c' },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ severity: 'major', signature: '#a|#c' });
  });
});
