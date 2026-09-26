import type { Finding, Run } from '@bughunters/core';
import { escapeXml } from './junit.js';

export type ReportInput = {
  run: Run;
  findings: Finding[];
  suppressed: number;
  quarantined: number;
  notes: string[];
};

/**
 * Self-contained, static, no server. Published as a CI artifact, which means no
 * retention limit to negotiate and no hosted dependency for the open-source
 * path (spec 5.5).
 *
 * The test plan is rendered FIRST, with the reason each item was selected. A QA
 * tool that hides what it tested cannot be trusted, and "what did you not test"
 * is the question a reviewer actually has.
 */
export function renderHtml(input: ReportInput): string {
  const { run, findings } = input;
  const blocking = findings.filter((f) => f.route === 'check');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bughunters run ${escapeXml(run.id)}</title>
<style>${STYLES}</style>
</head>
<body>
<header>
  <h1>Bughunters</h1>
  <p class="meta">
    <span class="badge ${blocking.length > 0 ? 'bad' : 'good'}">${blocking.length > 0 ? 'regression' : 'clean'}</span>
    commit <code>${escapeXml(run.commit.slice(0, 8))}</code> &middot; mode ${escapeXml(run.mode)} &middot;
    exit ${run.exitCode} &middot; ${run.plan.coverage.screensSelected}/${run.plan.coverage.screensTotal} screens
  </p>
</header>

<section>
  <h2>Test plan</h2>
  <p class="note">Mapping confidence ${(run.plan.mappingConfidence * 100).toFixed(0)}%. Every item below lists why it was selected.</p>
  <table>
    <thead><tr><th>Target</th><th>Why it was tested</th><th>Via</th></tr></thead>
    <tbody>
    ${run.plan.items
      .map(
        (item) => `<tr>
      <td><code>${escapeXml(String(item.target.screenId ?? item.target.flowId ?? item.target.invariant ?? '-'))}</code></td>
      <td>${escapeXml(item.reason)}</td>
      <td>${item.viaFile ? `<code>${escapeXml(String(item.viaFile))}</code>` : '-'}</td>
    </tr>`,
      )
      .join('\n')}
    </tbody>
  </table>
</section>

<section>
  <h2>Findings <span class="count">${findings.length}</span></h2>
  ${findings.length === 0 ? '<p class="note">Nothing to report.</p>' : findings.map(renderFinding).join('\n')}
</section>

<section>
  <h2>What was hidden</h2>
  <ul>
    <li><strong>${input.suppressed}</strong> finding(s) suppressed by the Intent Ledger</li>
    <li><strong>${input.quarantined}</strong> finding(s) quarantined as flaky &mdash; reported, never blocking</li>
    ${input.notes.map((n) => `<li>${escapeXml(n)}</li>`).join('\n')}
  </ul>
  <p class="note">Suppression is always counted. A tool that hides findings silently is a mute button.</p>
</section>

<section>
  <h2>Cost</h2>
  <table>
    <tbody>
      <tr><td>Decision layer</td><td>$${run.cost.decisionUsd.toFixed(5)}</td></tr>
      <tr><td>Vision</td><td>$${run.cost.visionUsd.toFixed(5)}</td></tr>
      <tr><td>Frontier</td><td>$${run.cost.frontierUsd.toFixed(5)}</td></tr>
      <tr><td>Tokens</td><td>${run.cost.tokens.toLocaleString('en-US')}</td></tr>
    </tbody>
  </table>
</section>
</body>
</html>
`;
}

function renderFinding(finding: Finding): string {
  return `<article class="finding sev-${finding.severity}">
  <h3>${escapeXml(finding.summary)}</h3>
  <p class="meta">
    <code>${escapeXml(finding.ruleId)}</code> &middot; ${finding.tier} &middot; ${finding.classification} &middot;
    severity ${finding.severity} &middot; confidence ${(finding.confidence * 100).toFixed(0)}% &middot;
    route <strong>${finding.route}</strong> &middot; <code>${escapeXml(finding.fingerprint)}</code>
  </p>
  ${
    finding.evidence.before && finding.evidence.after
      ? `<div class="triptych">
    <figure><img src="${escapeXml(String(finding.evidence.before))}" alt="baseline"><figcaption>expected</figcaption></figure>
    <figure><img src="${escapeXml(String(finding.evidence.after))}" alt="actual"><figcaption>actual</figcaption></figure>
    <figure><img src="${escapeXml(String(finding.evidence.diff ?? ''))}" alt="diff"><figcaption>diff</figcaption></figure>
  </div>`
      : ''
  }
  ${
    finding.suspectedFiles.length > 0
      ? `<p class="note">Suspected files: ${finding.suspectedFiles.map((f) => `<code>${escapeXml(String(f))}</code>`).join(', ')}</p>`
      : ''
  }
</article>`;
}

const STYLES = `
:root { color-scheme: light dark; --fg: #16181d; --muted: #5b6270; --line: #d8dce5; --bad: #b3261e; --good: #1f7a3d; }
@media (prefers-color-scheme: dark) { :root { --fg: #e6e8ee; --muted: #9aa3b2; --line: #2b303b; } }
* { box-sizing: border-box; }
body { margin: 0 auto; padding: 2rem 1.5rem 4rem; max-width: 62rem; font: 15px/1.6 ui-sans-serif, system-ui, sans-serif; color: var(--fg); }
h1 { font-size: 1.4rem; margin: 0 0 .25rem; }
h2 { font-size: 1.05rem; margin: 2.5rem 0 .75rem; padding-bottom: .4rem; border-bottom: 1px solid var(--line); }
h3 { font-size: .95rem; margin: 0 0 .35rem; }
.meta, .note { color: var(--muted); font-size: .85rem; }
.count { color: var(--muted); font-weight: 400; }
.badge { display: inline-block; padding: .1rem .5rem; border-radius: 999px; font-size: .75rem; font-weight: 600; color: #fff; }
.badge.bad { background: var(--bad); } .badge.good { background: var(--good); }
table { width: 100%; border-collapse: collapse; font-size: .85rem; }
th, td { text-align: left; padding: .4rem .5rem; border-bottom: 1px solid var(--line); vertical-align: top; }
code { font: 12px/1.4 ui-monospace, monospace; background: color-mix(in srgb, var(--line) 50%, transparent); padding: .1rem .3rem; border-radius: 3px; }
.finding { border: 1px solid var(--line); border-left-width: 3px; border-radius: 6px; padding: .9rem 1rem; margin-bottom: .75rem; }
.finding.sev-critical { border-left-color: var(--bad); }
.finding.sev-major { border-left-color: #d97706; }
.triptych { display: grid; grid-template-columns: repeat(3, 1fr); gap: .5rem; margin-top: .75rem; }
.triptych img { width: 100%; border: 1px solid var(--line); border-radius: 4px; }
figcaption { color: var(--muted); font-size: .75rem; text-align: center; }
`;
