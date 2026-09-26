import { z } from 'zod';

const secretRefString = z
  .string()
  .describe('A ${ENV_VAR} reference. Never a literal credential (spec 11.4).');

export const viewportSchema = z.object({
  name: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  deviceScaleFactor: z.number().positive().default(1),
});

export const actionSchema: z.ZodType<Record<string, unknown>> = z.record(z.unknown());

export const runSchema = z.object({
  command: z.string(),
  url: z.string().url(),
  ready: z
    .object({
      selectors: z.array(z.string()).default([]),
      forbidConsoleErrors: z.boolean().default(true),
      timeoutMs: z.number().int().positive().default(60_000),
    })
    .default({}),
  seeds: z.array(z.string()).default([]),
});

export const authSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({
    kind: z.literal('form'),
    loginUrl: z.string(),
    credentials: secretRefString.optional(),
    steps: z.array(actionSchema).default([]),
  }),
  z.object({ kind: z.literal('storageState'), path: z.string(), expiresAt: z.string().optional() }),
  z.object({
    kind: z.literal('seededUser'),
    seedCommand: z.string(),
    credentials: secretRefString.optional(),
  }),
  z.object({
    kind: z.literal('ssoBypass'),
    header: z.string().optional(),
    token: secretRefString.optional(),
  }),
  z.object({ kind: z.literal('manual'), path: z.string() }),
]);

export const maskSchema = z.object({
  selector: z.string(),
  screen: z.string().optional(),
  reason: z.string().optional(),
});

/**
 * Tolerance defaults to exact. Every existing tool in this category exposes a
 * global threshold knob and every one of them has a user who turned it up until
 * the build went green and it stopped catching anything (spec 7.6).
 */
export const toleranceSchema = z
  .object({
    default: z.literal('exact').default('exact'),
    regions: z
      .array(
        z.object({
          screen: z.string(),
          selector: z.string(),
          mode: z.enum(['exact', 'perceptual']).default('perceptual'),
          threshold: z.number().min(0).max(1).default(0.02),
          reason: z.string().optional(),
        }),
      )
      .default([]),
  })
  .default({});

export const decisionsSchema = z
  .object({
    decider: z.enum(['jev', 'model', 'local', 'heuristic']).default('jev'),
    jev: z.object({ via: z.enum(['auto', 'typesafe', 'openrouter', 'vercel']).default('auto') }).default({}),
    model: z.object({
      via: z.enum(['auto', 'openrouter', 'vercel', 'openai', 'anthropic', 'custom']).default('auto'),
      name: z.string().default(''),
    }).default({}),
    confidence: z
      .object({ high: z.number().min(0).max(1).default(0.85), low: z.number().min(0).max(1).default(0.55) })
      .default({}),
    budget: z
      .object({
        perRunUsd: z.number().nonnegative().default(0.5),
        visionSampleRate: z.number().min(0).max(1).default(0.05),
        allowFrontier: z.boolean().default(true),
      })
      .default({}),
  })
  .default({});

export const crawlSchema = z
  .object({
    maxScreens: z.number().int().positive().default(500),
    maxDepth: z.number().int().positive().default(6),
    maxActionsPerScreen: z.number().int().positive().default(15),
    maxWallClockMs: z.number().int().positive().default(60 * 60 * 1000),
    allowDestructive: z.boolean().default(false),
    /** Synthetic data only. */
    safeMode: z.boolean().default(true),
    /** The crawler may not leave the configured origin (spec 11.1). */
    confineToOrigin: z.boolean().default(true),
  })
  .default({});

export const surfacesSchema = z
  .object({
    checks: z.boolean().default(true),
    prComment: z.boolean().default(true),
    issues: z.boolean().default(true),
    questions: z.boolean().default(true),
    /** Opt-in. Requires contents:write on the GitHub App (spec 10.1). */
    fixPRs: z.boolean().default(false),
  })
  .default({});

export const productionSchema = z
  .object({
    detect: z.boolean().default(true),
    /** There is no flag that silently overrides this (spec 1.2). */
    allowMutations: z.boolean().default(false),
  })
  .default({});

export const determinismSchema = z
  .object({
    /** Pinned by digest. A digest change invalidates baselines (spec 7.1). */
    image: z.string().default(''),
    freezeClockAt: z.string().default('2026-01-01T00:00:00.000Z'),
    timezone: z.string().default('UTC'),
    locale: z.string().default('en-US'),
    randomSeed: z.number().int().default(1),
    /** Capture only once two consecutive frames are byte-identical (spec 7.3). */
    stabilityGate: z
      .object({
        consecutiveIdenticalFrames: z.number().int().min(2).default(2),
        intervalMs: z.number().int().positive().default(120),
        timeoutMs: z.number().int().positive().default(10_000),
      })
      .default({}),
    /** A glyph falling back to an unbundled family fails the run loudly. */
    failOnFontFallback: z.boolean().default(true),
    blockThirdPartyRequests: z.boolean().default(true),
  })
  .default({});

/**
 * One setup or teardown command (ADR 0005). `capture` pulls values out of the
 * command's output by regex, first group; later commands, `connect`, and the
 * explorer's `{{NAME}}` placeholders can use them. Captured values are treated
 * as secrets: they are redacted from every log and never sent to a model.
 */
export const appCommandSchema = z.object({
  run: z.string(),
  cwd: z.string().optional(),
  capture: z.record(z.string()).default({}),
  /** Keep the process alive for the session instead of waiting for it to exit. */
  background: z.boolean().default(false),
  /** Background only: wait until this regex matches the output. */
  readyWhen: z.string().optional(),
  timeoutMs: z.number().int().positive().default(10 * 60 * 1000),
});

export const appSchema = z
  .object({
    platform: z.enum(['web', 'electron', 'ios', 'android']).default('web'),
    /** The source repository the fixer edits. Relative to the config file. */
    source: z.string().default('.'),
    setup: z.array(appCommandSchema).default([]),
    teardown: z.array(appCommandSchema).default([]),
    connect: z
      .object({
        /** Web: defaults to run.url. May use ${NAME} from env or captures. */
        url: z.string().optional(),
        /** Electron: the CDP endpoint, e.g. http://127.0.0.1:${CDP_PORT}. */
        cdp: z.string().optional(),
        /** Mobile: the bundle id or package name. */
        appId: z.string().optional(),
        /** Mobile: the simulator UDID or emulator serial. Default: the booted one. */
        device: z.string().optional(),
      })
      .default({}),
    /** Plain-English guide for the explorer: login, onboarding, never-do list. */
    instructions: z.string().optional(),
    /** Names of env vars the explorer may use as {{NAME}} placeholders. */
    secrets: z.array(z.string()).default([]),
  })
  .default({});

const modelRuntimeSchema = z.object({
  runtime: z.literal('model'),
  via: z.enum(['openrouter', 'vercel', 'openai', 'anthropic', 'custom']).default('openrouter'),
  model: z.string().default('z-ai/glm-5.3-flash'),
  /** Custom route only: an OpenAI-compatible chat-completions URL. */
  endpoint: z.string().optional(),
});

const cliRuntimeSchema = z.object({
  runtime: z.literal('cli'),
  /**
   * A shell command. Placeholders: {prompt} (a file holding the prompt),
   * {mcp} (an MCP config file for the Bughunters tools), {mcpUrl}, {workdir}.
   * The prompt also goes to stdin.
   */
  command: z.string(),
});

const runtimeSchema = z.discriminatedUnion('runtime', [modelRuntimeSchema, cliRuntimeSchema]);

const roleBase = {
  enabled: z.boolean().default(true),
  maxSteps: z.number().int().positive().default(60),
  budgetUsd: z.number().nonnegative().default(0.5),
  timeoutMs: z.number().int().positive().default(20 * 60 * 1000),
};

export const agentsSchema = z
  .object({
    memory: z.object({
      enabled: z.boolean().default(true),
      maxPerSession: z.number().int().positive().default(5),
      reflectMaxSteps: z.number().int().positive().default(10),
      reflectBudgetUsd: z.number().nonnegative().default(0.05),
    }).default({}),
    explorer: z
      .object({ ...roleBase, use: runtimeSchema.default({ runtime: 'model' }) })
      .default({}),
    judge: z
      .object({
        ...roleBase,
        use: runtimeSchema.default({ runtime: 'model' }),
      })
      .default({}),
    fixer: z
      .object({
        ...roleBase,
        use: runtimeSchema.default({ runtime: 'cli', command: 'claude -p --permission-mode acceptEdits' }),
        /** Off until a team opts in: a fixer writes code. */
        enabled: z.boolean().default(false),
        /** Run after the change; a non-zero exit marks the fix failed. */
        verify: z.string().optional(),
        /** After a fix, start the app from the fix worktree and repeat the issue's flow. */
        retest: z.object({
          enabled: z.boolean().default(true),
          /** Shell command run in the worktree before the app starts, e.g. `bun install`. */
          prepare: z.string().optional(),
          /** Fix attempts in total; each attempt after the first gets the last verdict as feedback. */
          attempts: z.number().int().positive().default(2),
          maxSteps: z.number().int().positive().default(30),
          budgetUsd: z.number().nonnegative().default(0.2),
        }).default({}),
        minSeverity: z.enum(['cosmetic', 'minor', 'major', 'critical']).default('minor'),
        /**
         * The local commit on the fix branch. {title} is the issue title. Set a
         * scope when the repo's commit hook requires one, e.g. 'fix(app): {title}'.
         */
        commitMessage: z.string().default('fix: {title}'),
        /** At most this many fixes per patrol cycle, worst issues first. */
        maxPerCycle: z.number().int().positive().default(2),
      })
      .default({}),
    github: z.object({
      enabled: z.boolean().default(false),
      repo: z.string().optional(),
      pullRequests: z.enum(['draft', 'ready']).default('draft'),
      issueMinSeverity: z.enum(['cosmetic', 'minor', 'major', 'critical']).default('major'),
      assetsBranch: z.string().default('bughunters-assets'),
      labels: z.array(z.string()).default(['bughunters']),
  /** The scope in PR titles, e.g. 'app'. Default: the scope in fixer.commitMessage. */
  prScope: z.string().optional(),
    }).default({}),
    patrol: z
      .object({
        intervalMinutes: z.number().positive().default(30),
        /** Stop after this many cycles; 0 means run until stopped. */
        cycles: z.number().int().nonnegative().default(0),
      })
      .default({}),
  })
  .default({});

export const bughuntersConfigSchema = z.object({
  version: z.literal(1),
  /** Web only: how to start and reach the app. Other platforms use `app`. */
  run: runSchema.optional(),
  app: appSchema,
  agents: agentsSchema,
  auth: authSchema.default({ kind: 'none' }),
  viewports: z
    .array(viewportSchema)
    .min(1)
    .default([
      { name: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1 },
      { name: 'mobile', width: 390, height: 844, deviceScaleFactor: 1 },
    ]),
  scope: z
    .object({
      include: z.array(z.string()).default(['src/**', 'app/**']),
      ignore: z.array(z.string()).default(['**/*.stories.tsx', '**/*.test.ts', '**/generated/**']),
    })
    .default({}),
  crawl: crawlSchema,
  mask: z.array(maskSchema).default([]),
  tolerance: toleranceSchema,
  decisions: decisionsSchema,
  determinism: determinismSchema,
  surfaces: surfacesSchema,
  production: productionSchema,
}).superRefine((config, ctx) => {
  if (config.app.platform === 'web' && !config.run && !config.app.connect.url) {
    ctx.addIssue({ code: 'custom', path: ['run'], message: 'A web app needs `run` (command and url) or `app.connect.url`.' });
  }
});

export type BughuntersConfig = z.infer<typeof bughuntersConfigSchema>;
export type AppConfig = z.infer<typeof appSchema>;
export type AppCommand = z.infer<typeof appCommandSchema>;
export type AgentsConfig = z.infer<typeof agentsSchema>;
export type RoleRuntime = z.infer<typeof runtimeSchema>;
export type ViewportConfig = z.infer<typeof viewportSchema>;
export type MaskConfig = z.infer<typeof maskSchema>;
export type ToleranceConfig = z.infer<typeof toleranceSchema>;
export type DecisionsConfig = z.infer<typeof decisionsSchema>;
export type DeterminismConfig = z.infer<typeof determinismSchema>;
