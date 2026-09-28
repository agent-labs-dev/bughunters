// Pure layout for the agent app map. Coordinates are SVG user units.
export function layoutGraph(screens, edges, entryId) {
  const w = 190,
    h = 150,
    xGap = 130,
    yGap = 55,
    pad = 45;
  const xStep = w + xGap,
    yStep = h + yGap;
  const ids = new Set(screens.map((screen) => screen.id));
  const virtual = new Set(screens.filter((screen) => screen.virtual).map((screen) => screen.id));
  const valid = edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to);
  const neighbors = new Map([...ids].map((id) => [id, []]));
  const outgoing = new Map([...ids].map((id) => [id, []]));
  const incoming = new Map([...ids].map((id) => [id, 0]));
  for (const edge of valid) {
    neighbors.get(edge.from).push(edge.to);
    neighbors.get(edge.to).push(edge.from);
    if (edge.kind !== 'back') {
      outgoing.get(edge.from).push(edge.to);
      incoming.set(edge.to, incoming.get(edge.to) + 1);
    }
  }

  const isolated = [...ids].filter((id) => neighbors.get(id).length === 0).sort();
  const seen = new Set();
  const components = [];
  for (const id of [...ids].sort()) {
    if (seen.has(id) || neighbors.get(id).length === 0) continue;
    const members = [];
    const queue = [id];
    seen.add(id);
    for (const current of queue) {
      members.push(current);
      for (const next of neighbors.get(current))
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
    }
    components.push(members.sort());
  }
  components.sort((a, b) => Number(b.includes(entryId)) - Number(a.includes(entryId)) || a[0].localeCompare(b[0]));

  const blocks = [];
  for (const members of components) {
    const memberSet = new Set(members);
    const reachedFromEntry = new Set();
    if (memberSet.has(entryId)) {
      const queue = [entryId];
      reachedFromEntry.add(entryId);
      for (const id of queue)
        for (const to of outgoing.get(id))
          if (!reachedFromEntry.has(to)) {
            reachedFromEntry.add(to);
            queue.push(to);
          }
    }
    const roots = [
      ...(memberSet.has(entryId) ? [entryId] : []),
      ...members.filter((id) => id !== entryId && incoming.get(id) === 0 && !reachedFromEntry.has(id)),
    ];
    const layer = new Map(roots.map((id) => [id, 0]));
    const queue = [...roots];
    const visit = () => {
      for (let index = 0; index < queue.length; index++) {
        const id = queue[index];
        for (const to of outgoing.get(id))
          if (memberSet.has(to) && !layer.has(to)) {
            layer.set(to, layer.get(id) + 1);
            queue.push(to);
          }
      }
    };
    visit();
    // A directed cycle can have no zero-incoming root.
    for (const id of members)
      if (!layer.has(id)) {
        layer.set(id, 0);
        queue.push(id);
        visit();
      }

    const columns = Array.from({ length: Math.max(...layer.values()) + 1 }, () => []);
    for (const id of members) columns[layer.get(id)].push(id);
    const order = new Map();
    for (const list of columns) for (const [index, id] of list.entries()) order.set(id, index);
    const sweep = (column, neighbor) => {
      const list = columns[column];
      const center = (id) => {
        const positions = valid
          .filter(
            (edge) =>
              edge.kind !== 'back' &&
              ((edge.from === id && layer.get(edge.to) === neighbor) ||
                (edge.to === id && layer.get(edge.from) === neighbor)),
          )
          .map((edge) => order.get(edge.from === id ? edge.to : edge.from))
          .filter((value) => value !== undefined);
        return positions.length ? positions.reduce((sum, value) => sum + value, 0) / positions.length : order.get(id);
      };
      list.sort((a, b) => center(a) - center(b) || a.localeCompare(b));
      for (const [index, id] of list.entries()) order.set(id, index);
    };
    for (let pass = 0; pass < 4; pass++) {
      for (let col = 1; col < columns.length; col++) sweep(col, col - 1);
      for (let col = columns.length - 2; col >= 0; col--) sweep(col, col + 1);
    }

    const nodes = [];
    let xColumn = 0;
    for (const list of columns) {
      list.forEach((id, index) => {
        const x = (xColumn + Math.floor(index / 10)) * xStep,
          y = (index % 10) * yStep;
        nodes.push(virtual.has(id) ? { id, x: x + 35, y: y + 53, w: 120, h: 44 } : { id, x, y, w, h });
      });
      xColumn += Math.ceil(list.length / 10);
    }
    blocks.push({
      nodes,
      width: xColumn * xStep - xGap,
      height: Math.max(...nodes.map((node) => node.y + node.h)),
      isolated: false,
    });
  }

  if (isolated.length) {
    blocks.push({
      nodes: isolated.map((id, index) => {
        const x = Math.floor(index / 6) * xStep,
          y = 35 + (index % 6) * yStep;
        return virtual.has(id) ? { id, x: x + 35, y: y + 53, w: 120, h: 44 } : { id, x, y, w, h };
      }),
      width: Math.ceil(isolated.length / 6) * xStep - xGap,
      height: 35 + (Math.min(6, isolated.length) - 1) * yStep + h,
      isolated: true,
    });
  }

  const gap = 100;
  const widths = new Set();
  for (let start = 0; start < blocks.length; start++) {
    let width = 0;
    for (let end = start; end < blocks.length; end++) {
      width += blocks[end].width + (end === start ? 0 : gap);
      widths.add(width);
    }
  }
  let targetWidth = 0,
    bestScore = Infinity;
  for (const width of widths) {
    let rowWidth = 0,
      rowHeight = 0,
      usedWidth = 0,
      usedHeight = 0;
    for (const block of blocks) {
      if (rowWidth && rowWidth + gap + block.width > width) {
        usedHeight += rowHeight + gap;
        rowWidth = 0;
        rowHeight = 0;
      }
      rowWidth += block.width + (rowWidth ? gap : 0);
      rowHeight = Math.max(rowHeight, block.height);
      usedWidth = Math.max(usedWidth, rowWidth);
    }
    const ratio = (usedWidth + pad * 2) / (usedHeight + rowHeight + pad * 2);
    const score = Math.abs(Math.log(ratio / 1.6));
    if (score < bestScore) {
      bestScore = score;
      targetWidth = width;
    }
  }
  const nodes = [];
  let x = pad,
    y = pad,
    rowHeight = 0,
    maxRight = 0,
    maxBottom = 0;
  let unlinkedX = null,
    unlinkedY = null;
  for (const block of blocks) {
    if (x > pad && x - pad + block.width > targetWidth) {
      x = pad;
      y += rowHeight + gap;
      rowHeight = 0;
    }
    nodes.push(...block.nodes.map((node) => ({ ...node, x: node.x + x, y: node.y + y })));
    if (block.isolated) {
      unlinkedX = x;
      unlinkedY = y;
    }
    maxRight = Math.max(maxRight, x + block.width);
    maxBottom = Math.max(maxBottom, y + block.height);
    rowHeight = Math.max(rowHeight, block.height);
    x += block.width + gap;
  }

  const positions = new Map(nodes.map((node) => [node.id, node]));
  const paths = valid.map((edge, index) => {
    const from = positions.get(edge.from),
      to = positions.get(edge.to);
    if (to.x > from.x) {
      const x1 = from.x + from.w,
        x2 = to.x,
        y1 = from.y + from.h / 2,
        y2 = to.y + to.h / 2;
      const bend = Math.max(65, (x2 - x1) / 2);
      return { ...edge, path: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}` };
    }
    const y = Math.min(from.y, to.y) - 25 - (index % 5) * 12;
    const x1 = from.x + from.w / 2,
      x2 = to.x + to.w / 2;
    return { ...edge, path: `M ${x1} ${from.y} C ${x1} ${y}, ${x2} ${y}, ${x2} ${to.y}` };
  });
  return {
    nodes,
    edges: paths,
    width: Math.max(320, maxRight + pad),
    height: Math.max(320, maxBottom + pad),
    unlinkedX,
    unlinkedY,
  };
}
