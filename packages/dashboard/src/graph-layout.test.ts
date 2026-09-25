import { describe, expect, it } from 'vitest';
import { layoutGraph, type GraphNode } from './ui/graph-layout.js';

function noOverlaps(nodes: GraphNode[]) {
  for (const first of nodes) for (const second of nodes) if (first !== second) {
    expect(first.x + first.w <= second.x || second.x + second.w <= first.x ||
      first.y + first.h <= second.y || second.y + second.h <= first.y).toBe(true);
  }
}

describe('screen graph layout', () => {
  it('places disconnected components and isolated screens without overlap', () => {
    const screens = ['a', 'b', 'c', 'd', 'orphan'].map((id) => ({ id }));
    const edges = [
      { from: 'a', to: 'b', kind: 'tap' }, { from: 'c', to: 'd', kind: 'route' },
      { from: 'b', to: 'a', kind: 'back' },
    ];
    const graph = layoutGraph(screens, edges, 'a');
    expect(graph).toEqual(layoutGraph(screens, edges, 'a'));
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    expect(byId.get('a')!.x).toBeLessThan(byId.get('b')!.x);
    expect(byId.get('c')!.x !== byId.get('a')!.x || byId.get('c')!.y !== byId.get('a')!.y).toBe(true);
    expect(graph.unlinkedY).not.toBeNull();
    expect(graph.edges.every((edge) => edge.path.includes(' C '))).toBe(true);
    noOverlaps(graph.nodes);
  });

  it('wraps six disconnected components toward a wide canvas', () => {
    const screens = Array.from({ length: 6 }, (_, index) => [`root-${index}`, `child-${index}`])
      .flat().map((id) => ({ id }));
    const edges = Array.from({ length: 6 }, (_, index) => ({ from: `root-${index}`,
      to: `child-${index}`, kind: 'route' }));
    const graph = layoutGraph(screens, edges, 'root-0');
    expect(graph.width / graph.height).toBeGreaterThan(1.3);
    expect(graph.width / graph.height).toBeLessThan(2);
    noOverlaps(graph.nodes);
  });

  it('gives the virtual entry a small first-layer pill', () => {
    const graph = layoutGraph([{ id: '__start', virtual: true }, { id: 'home' }],
      [{ from: '__start', to: 'home', kind: 'route' }], '__start');
    const start = graph.nodes.find((node) => node.id === '__start')!;
    const home = graph.nodes.find((node) => node.id === 'home')!;
    expect([start.w, start.h]).toEqual([120, 44]);
    expect(start.x).toBeLessThan(home.x);
    noOverlaps(graph.nodes);
  });

  it('wraps 20 isolated screens into columns of at most six', () => {
    const graph = layoutGraph(Array.from({ length: 20 }, (_, index) => ({ id: `s${index}` })), [], 's0');
    expect(new Set(graph.nodes.map((node) => node.x)).size).toBe(4);
    for (const x of new Set(graph.nodes.map((node) => node.x))) {
      expect(graph.nodes.filter((node) => node.x === x).length).toBeLessThanOrEqual(6);
    }
    noOverlaps(graph.nodes);
  });

  it('wraps a layer taller than ten and lays out cycles without roots', () => {
    const leaves = Array.from({ length: 12 }, (_, index) => `leaf-${index}`);
    const screens = ['entry', ...leaves, 'cycle-a', 'cycle-b'].map((id) => ({ id }));
    const edges = [...leaves.map((to) => ({ from: 'entry', to, kind: 'tap' })),
      { from: 'cycle-a', to: 'cycle-b', kind: 'route' },
      { from: 'cycle-b', to: 'cycle-a', kind: 'route' }];
    const graph = layoutGraph(screens, edges, 'entry');
    expect(new Set(graph.nodes.filter((node) => leaves.includes(node.id)).map((node) => node.x)).size).toBe(2);
    expect(graph.nodes).toHaveLength(screens.length);
    noOverlaps(graph.nodes);
  });
});
