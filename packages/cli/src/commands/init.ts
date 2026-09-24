import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { paths, type StackProfile } from '@autoqa/core';
import { detectStack, detectBringUp } from '@autoqa/recon';

export type InitResult = { configPath: string; workflowPath: string; stack: StackProfile; notes: string[] };

/**
 * Writes autoqa.yml with detected defaults and a TODO marker on anything it
 * could not determine. Detection is a first guess, never a silent decision --
 * everything is written to the file with its provenance so a human can see WHY
 * a value was chosen and correct it (spec, Phase 0).
 */
export function writeInitialConfig(root: string): InitResult {
  const stack = detectStack(root);
  const candidates = detectBringUp(root);
  const best = candidates[0];
  const notes: string[] = [];

  if (!best) notes.push('Could not detect a bring-up command. `run.command` is marked TODO.');
  if (!stack.framework) notes.push('Could not detect a framework. Source mapping will be weaker until this is set.');

  const config = `version: 1

# Written by \`autoqa init\` on ${new Date().toISOString().slice(0, 10)}.
# Every value below is a DETECTED GUESS with its provenance in a comment.
# Correct anything that is wrong; AutoQA will not overwrite your edits.

run:
  ${best ? `command: ${best.command}   # detected from ${best.source} (rung: ${best.rung})` : 'command: TODO   # could not detect - set this'}
  url: http://localhost:3000   # TODO confirm the port
  ready:
    # "The port is open" is not sufficient - plenty of apps serve a 200 error page.
    selectors: []              # TODO add a selector that only exists once the app booted
    forbidConsoleErrors: true
    timeoutMs: 60000
  seeds: []

auth:
  kind: none                   # none | form | storageState | seededUser | ssoBypass | manual

viewports:
  - { name: desktop, width: 1440, height: 900 }
  - { name: mobile,  width: 390,  height: 844 }

scope:
  include: ["src/**", "app/**"]
  ignore:  ["**/*.stories.tsx", "**/*.test.ts", "**/generated/**"]

crawl:
  maxScreens: 500
  maxDepth: 6
  maxActionsPerScreen: 15
  allowDestructive: false
  safeMode: true

mask: []

tolerance:
  # Exact by default, per-region overrides only. There is deliberately no
  # global threshold knob: every tool that ships one has a user who turned it
  # up until the build went green and it stopped catching anything.
  default: exact
  regions: []

determinism:
  image: ""                    # TODO pin by digest, e.g. ghcr.io/autoqa/runner@sha256:...
  freezeClockAt: "2026-01-01T00:00:00.000Z"
  timezone: UTC
  locale: en-US
  failOnFontFallback: true
  blockThirdPartyRequests: true

decisions:
  decider: jev                 # jev | model | local | heuristic
  jev:
    via: auto                  # auto | typesafe | openrouter | vercel
  model:
    via: auto                  # auto | openrouter | vercel | openai | anthropic | custom
    name: ""                   # optional model id override
  confidence: { high: 0.85, low: 0.55 }
  budget:
    perRunUsd: 0.50
    visionSampleRate: 0.05
    allowFrontier: true

surfaces:
  checks: true
  prComment: true
  issues: true
  questions: true
  fixPRs: false                # opt-in; this is the only thing that needs contents:write

production:
  detect: true
  allowMutations: false        # never enable against a production system
`;

  const configPath = paths.config(root);
  if (!existsSync(configPath)) writeFileSync(configPath, config);
  else notes.push('autoqa.yml already exists and was left untouched.');

  const workflowDir = join(root, '.github', 'workflows');
  mkdirSync(workflowDir, { recursive: true });
  const workflowPath = join(workflowDir, 'autoqa.yml');
  if (!existsSync(workflowPath)) writeFileSync(workflowPath, WORKFLOW);

  mkdirSync(paths.dir(root), { recursive: true });

  return { configPath, workflowPath, stack, notes };
}

/** Note the explicit least-privilege permissions block (spec 10.4). */
export const WORKFLOW = `name: AutoQA
on:
  pull_request:
  push:
    branches: [main]
  schedule:
    - cron: '0 6 * * *'   # nightly full sweep

jobs:
  autoqa:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      checks: write
      issues: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0    # the compare API needs history
      - uses: autoqa/run@v1
        with:
          mode: \${{ github.event_name == 'schedule' && 'all' || 'changed-only' }}
`;
