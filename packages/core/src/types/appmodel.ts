import type { ArtifactRef, EdgeId, FileRef, FlowId, ModelId, ProjectId, ScreenId } from './ids.js';
import type { Action } from './project.js';

export type ElementRef = {
  selector: string;
  role?: string;
  name?: string;
  testId?: string;
};

/** Rendered geometry, captured per viewport. Feeds the layout invariant engine. */
export type ElementGeometry = {
  selector: string;
  box: { x: number; y: number; width: number; height: number };
  visible: boolean;
  /**
   * Takes part in rendering at all. False for display:none on the element or an
   * ancestor, and for visibility:hidden. Absent on snapshots from older probes.
   */
  rendered?: boolean;
  interactive: boolean;
  zIndex: number;
  /** Result of document.elementFromPoint at the box centre -- drives occlusion. */
  hitSelector?: string;
  color?: string;
  backgroundColor?: string;
  /**
   * Contrast measured on the screenshot, set only when the DOM-computed ratio
   * failed. The rendered pixels are the authority when the two disagree.
   */
  pixelContrast?: number;
  fontSize?: number;
  overflowHidden?: boolean;
  scrollWidth?: number;
  clientWidth?: number;
};

export type BaselineRef = {
  viewport: string;
  /** hash(content) + imageDigest -- see spec 12.1. */
  key: string;
  artifact: ArtifactRef;
  imageDigest: string;
  capturedAt: string;
};

export type Screen = {
  id: ScreenId;
  /** Normalised: dynamic segments collapsed, known-dynamic query params stripped. */
  urlPattern: string;
  title: string;
  /** Semantic, model-written at Recon. */
  description: string;
  purpose?: string;
  primaryAction?: string;
  /** Product vocabulary present on this screen. */
  entities: string[];
  /** Structural DOM digest; half of the crawl dedup key. */
  semanticHash: string;
  elements: ElementRef[];
  geometry: ElementGeometry[];
  sourceFiles: FileRef[];
  mappingConfidence: number;
  baselineRefs: BaselineRef[];
  state: 'active' | 'quarantined' | 'excluded';
};

export type Edge = {
  id: EdgeId;
  from: ScreenId;
  to: ScreenId;
  action: Action;
  kind: 'nav' | 'action';
};

export type Flow = {
  id: FlowId;
  name: string;
  goal: string;
  /** REPLAYABLE. This is the frozen deterministic artifact the agent produces. */
  steps: Action[];
  screens: ScreenId[];
  criticality: 'entry' | 'core' | 'edge';
};

export type AppModel = {
  id: ModelId;
  projectId: ProjectId;
  version: number;
  summary: {
    purpose: string;
    audience: string;
    domainVocabulary: string[];
    coreEntities: string[];
  };
  screens: Screen[];
  flows: Flow[];
  edges: Edge[];
  /** THE INVERSE MAP. Change mapping (Phase 2) runs entirely on this. */
  fileIndex: Record<string, ScreenId[]>;
  approvedBy?: string;
  approvedAt?: Date;
  generatedBy: { model: string; version: string; ranAt: Date; costUsd: number };
};
