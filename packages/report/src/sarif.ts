import type { Finding } from '@bugpatrol/core';

/** SARIF so findings land on GitHub's code-scanning surface (spec 5.4). */
export function toSarif(findings: Finding[], version = '0.0.0'): string {
  const rules = [...new Set(findings.map((f) => f.ruleId))].map((ruleId) => ({
    id: ruleId,
    shortDescription: { text: ruleId },
    defaultConfiguration: { level: 'warning' },
  }));

  const results = findings.map((f) => ({
    ruleId: f.ruleId,
    level: sarifLevel(f),
    message: { text: f.summary },
    locations: (f.suspectedFiles.length > 0 ? f.suspectedFiles : ['']).map((file) => ({
      physicalLocation: {
        artifactLocation: { uri: String(file) || 'unknown' },
        region: { startLine: 1 },
      },
    })),
    partialFingerprints: { bugpatrolFingerprint: f.fingerprint },
  }));

  return `${JSON.stringify(
    {
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: { driver: { name: 'Bugpatrol', version, informationUri: 'https://github.com/agent-labs-dev/bugpatrol', rules } },
          results,
        },
      ],
    },
    null,
    2,
  )}\n`;
}

function sarifLevel(finding: Finding): 'error' | 'warning' | 'note' {
  // Only a blocking finding is an error. Everything the decision layer produces
  // is advisory, and SARIF consumers should see that distinction.
  if (finding.route === 'check') return 'error';
  if (finding.severity === 'critical' || finding.severity === 'major') return 'warning';
  return 'note';
}
