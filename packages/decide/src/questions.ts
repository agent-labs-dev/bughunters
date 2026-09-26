import type { Question } from '@bughunters/core';

/**
 * The full per-screen question set. All of these are evaluated against the same
 * state in ONE call -- adding questions adds almost no latency and almost no
 * cost, which is why the analysis is exhaustive rather than staged.
 */
export const SCREEN_QUESTIONS: Record<string, Question> = {
  is_anomalous: {
    type: 'noul',
    instructions:
      'Does any evidence here indicate behaviour that differs from the modelled product behaviour?',
  },
  classification: {
    type: 'choice',
    instructions: 'Classify the primary issue.',
    criteria: {
      regression: 'A working behaviour stopped working',
      'visual-noise': 'Rendering variance with no user-visible impact',
      'functional-bug': 'The feature is broken or errors',
      a11y: 'Accessibility violation',
      content: 'Copy, spelling, or terminology problem',
      flow: 'The interaction or navigation is illogical',
      improvement: 'Works, but could be better',
      clean: 'No issue',
    },
  },
  route: {
    type: 'choice',
    instructions: 'Where should this surface?',
    criteria: {
      check: 'Block the merge',
      issue: 'File a GitHub issue',
      question: 'Ask a human whether this is intended',
      intent: 'Matches a known intended behaviour; suppress',
      ignore: 'Not worth anyone’s attention',
    },
  },
  severity: {
    type: 'score',
    instructions: 'Grade user impact.',
    legend: ['cosmetic', 'minor', 'major', 'critical'],
  },
  matches_intent: {
    type: 'noul',
    instructions: 'Does this match any documented intended behaviour?',
  },
  needs_frontier: {
    type: 'noul',
    instructions: 'Is this too ambiguous for a confident automated decision?',
  },
};

/** Clustering: resolves the residual pairs the deterministic pass could not group. */
export const SAME_ROOT_CAUSE: Question = {
  type: 'noul',
  instructions: 'Do these two findings share one root cause?',
};

/**
 * Crawl safety. Getting this wrong is the worst possible bug in the product,
 * so ambiguous cases are treated as destructive by the caller regardless of
 * what comes back.
 */
export const IS_DESTRUCTIVE: Question = {
  type: 'noul',
  instructions: 'Would clicking this plausibly destroy or permanently alter user data?',
};

/** Spelling: the dictionary finds candidates, the decider filters them. */
export const IS_MISSPELLING: Question = {
  type: 'noul',
  instructions:
    'Is this a likely misspelling of a real word in this product’s context, rather than a brand name, identifier, or intentional coinage?',
};
