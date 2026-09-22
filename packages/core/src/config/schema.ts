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

export const autoqaConfigSchema = z.object({
  version: z.literal(1),
  run: runSchema,
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
});

export type AutoQAConfig = z.infer<typeof autoqaConfigSchema>;
export type ViewportConfig = z.infer<typeof viewportSchema>;
export type MaskConfig = z.infer<typeof maskSchema>;
export type ToleranceConfig = z.infer<typeof toleranceSchema>;
export type DecisionsConfig = z.infer<typeof decisionsSchema>;
export type DeterminismConfig = z.infer<typeof determinismSchema>;
