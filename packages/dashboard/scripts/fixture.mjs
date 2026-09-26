// Run: pnpm build && node packages/dashboard/scripts/fixture.mjs /tmp/bughunters-fixture
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeAgentFixture } from '../dist/fixtures/agent-workspace.js';

const root = resolve(process.argv[2] || '/tmp/bughunters-fixture');
mkdirSync(root, { recursive: true });
writeAgentFixture(root);
console.log(`Fixture written to ${root}. Run bughunters dashboard there.`);
