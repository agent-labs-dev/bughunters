export type GraphNode = { id: string; x: number; y: number; w: number; h: number };
export type GraphEdge = { from: string; to: string; kind: string; path: string; via?: string; count?: number };
export function layoutGraph(
  screens: { id: string; virtual?: boolean }[],
  edges: Omit<GraphEdge, 'path'>[],
  entryId?: string,
): {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
  unlinkedX: number | null;
  unlinkedY: number | null;
};
