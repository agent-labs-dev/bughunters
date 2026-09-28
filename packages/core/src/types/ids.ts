/**
 * Branded id types. These are structurally strings, but the brand stops a
 * ScreenId being passed where a FlowId is expected -- which matters because
 * almost every entity in the data model is keyed by one of these.
 */
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type ProjectId = Brand<string, 'ProjectId'>;
export type ModelId = Brand<string, 'ModelId'>;
export type ScreenId = Brand<string, 'ScreenId'>;
export type EdgeId = Brand<string, 'EdgeId'>;
export type FlowId = Brand<string, 'FlowId'>;
export type RunId = Brand<string, 'RunId'>;
export type FindingId = Brand<string, 'FindingId'>;
export type GroupId = Brand<string, 'GroupId'>;
export type IntentId = Brand<string, 'IntentId'>;
export type DecisionId = Brand<string, 'DecisionId'>;

/** A repo-relative source path. */
export type FileRef = Brand<string, 'FileRef'>;

/** A content-addressed pointer into the artifact store. Never a local path. */
export type ArtifactRef = Brand<string, 'ArtifactRef'>;

/**
 * A reference to a secret in the user's own secret store. Bugpatrol stores these;
 * it never stores the credential itself, in the repo, in artifacts, or in the
 * AppModel (spec 1.2, 11.4).
 */
export type SecretRef = Brand<string, 'SecretRef'>;

export const id = {
  project: (v: string) => v as ProjectId,
  model: (v: string) => v as ModelId,
  screen: (v: string) => v as ScreenId,
  edge: (v: string) => v as EdgeId,
  flow: (v: string) => v as FlowId,
  run: (v: string) => v as RunId,
  finding: (v: string) => v as FindingId,
  group: (v: string) => v as GroupId,
  intent: (v: string) => v as IntentId,
  decision: (v: string) => v as DecisionId,
  file: (v: string) => v as FileRef,
  artifact: (v: string) => v as ArtifactRef,
  secret: (v: string) => v as SecretRef,
} as const;
