import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    environment: 'node',
    // No test may reach a real model or Jev, whatever keys the shell holds.
    env: Object.fromEntries([
      'TYPESAFE_API_KEY', 'OPENROUTER_API_KEY', 'AI_GATEWAY_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
      'BUGHUNTERS_MODEL_ENDPOINT', 'BUGHUNTERS_MODEL_API_KEY', 'BUGHUNTERS_MODEL_NAME',
    ].map((key) => [key, ''])),
  },
});
