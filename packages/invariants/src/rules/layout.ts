import type { InvariantRule, InvariantViolation } from '../types.js';
import { area, centre, intersectionArea, intersects, visibleInteractive } from './geometry.js';

/** Overlap below this fraction of the smaller element is treated as incidental. */
const OVERLAP_TOLERANCE = 0.1;

export const overlap: InvariantRule = {
  id: 'layout/overlap',
  title: 'Unexpected overlap',
  catches: 'Broken navigation bars, colliding tooltips, stacked buttons',
  defaultSeverity: 'major',
  changeAware: false,
  evaluate(snapshot) {
    const out: InvariantViolation[] = [];
    const candidates = visibleInteractive(snapshot.elements);
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i]!;
        const b = candidates[j]!;
        if (!intersects(a.box, b.box)) continue;
        // Nesting is normal -- a link inside a card is not an overlap bug.
        if (a.hitSelector === b.selector || b.hitSelector === a.selector) continue;
        const overlapArea = intersectionArea(a.box, b.box);
        const smaller = Math.min(area(a.box), area(b.box));
        if (smaller === 0 || overlapArea / smaller < OVERLAP_TOLERANCE) continue;
        out.push({
          ruleId: overlap.id,
          message: `"${a.selector}" and "${b.selector}" overlap by ${Math.round((overlapArea / smaller) * 100)}%, so one of them is partly unclickable.`,
          severity: 'major',
          selector: a.selector,
          region: a.box,
          detail: { other: b.selector, overlapFraction: overlapArea / smaller },
        });
      }
    }
    return out;
  },
};

export const overflow: InvariantRule = {
  id: 'layout/overflow',
  title: 'Content clipped or overflowing',
  catches: 'Truncated labels, text running out of a card',
  defaultSeverity: 'minor',
  changeAware: false,
  evaluate(snapshot) {
    return snapshot.elements
      .filter((e) => e.visible && e.overflowHidden && (e.scrollWidth ?? 0) > (e.clientWidth ?? 0) + 1)
      .map((e) => ({
        ruleId: overflow.id,
        message: `Content inside "${e.selector}" is ${(e.scrollWidth ?? 0) - (e.clientWidth ?? 0)}px wider than its container and is being clipped, so part of the text is unreadable.`,
        severity: 'minor' as const,
        selector: e.selector,
        region: e.box,
        detail: { scrollWidth: e.scrollWidth ?? 0, clientWidth: e.clientWidth ?? 0 },
      }));
  },
};

export const zeroSizeInteractive: InvariantRule = {
  id: 'layout/zero-size-interactive',
  title: 'Interactive element with no rendered box',
  catches: 'Invisible buttons, unclickable links',
  defaultSeverity: 'major',
  changeAware: false,
  evaluate(snapshot) {
    return snapshot.elements
      // Only elements that are actually rendered. A display:none responsive
      // variant is 0x0 on purpose and unreachable by design, not broken.
      .filter((e) => e.interactive && e.rendered !== false && (e.box.width < 1 || e.box.height < 1))
      .map((e) => ({
        ruleId: zeroSizeInteractive.id,
        message: `"${e.selector}" is interactive but renders at ${Math.round(e.box.width)}x${Math.round(e.box.height)}px, so nobody can click it.`,
        severity: 'major' as const,
        selector: e.selector,
        region: e.box,
      }));
  },
};

export const occlusion: InvariantRule = {
  id: 'layout/occlusion',
  title: 'Interactive element covered by another element',
  catches: 'The "the button does nothing" class of bug',
  defaultSeverity: 'critical',
  changeAware: false,
  evaluate(snapshot) {
    return visibleInteractive(snapshot.elements)
      .filter((e) => e.hitSelector !== undefined && e.hitSelector !== e.selector)
      .map((e) => {
        const point = centre(e.box);
        return {
          ruleId: occlusion.id,
          message: `"${e.selector}" is covered by "${e.hitSelector}" at its centre point, so clicking it hits the wrong element.`,
          severity: 'critical' as const,
          selector: e.selector,
          region: e.box,
          detail: { coveredBy: e.hitSelector ?? '', pointX: point.x, pointY: point.y },
        };
      });
  },
};

export const horizontalScroll: InvariantRule = {
  id: 'layout/horizontal-scroll',
  title: 'Unexpected horizontal scroll',
  catches: 'Layout breakage from fixed widths, most often on mobile viewports',
  defaultSeverity: 'minor',
  changeAware: true,
  evaluate(snapshot, baseline) {
    const now = snapshot.document.scrollWidth > snapshot.document.clientWidth + 1;
    const before = baseline
      ? baseline.document.scrollWidth > baseline.document.clientWidth + 1
      : false;
    if (!now || (baseline && before)) return [];
    return [
      {
        ruleId: horizontalScroll.id,
        message: `The page now scrolls horizontally at ${snapshot.viewport.width}px (content is ${snapshot.document.scrollWidth}px wide), which it did not before.`,
        severity: 'minor',
        detail: { scrollWidth: snapshot.document.scrollWidth, clientWidth: snapshot.document.clientWidth },
      },
    ];
  },
};

export const offViewport: InvariantRule = {
  id: 'layout/off-viewport',
  title: 'Element left the viewport',
  catches: 'Regressions from layout shifts pushing controls out of reach',
  defaultSeverity: 'major',
  changeAware: true,
  evaluate(snapshot, baseline) {
    if (!baseline) return [];
    const wasVisible = new Map(baseline.elements.filter((e) => e.visible).map((e) => [e.selector, e]));
    const out: InvariantViolation[] = [];
    for (const e of snapshot.elements) {
      const before = wasVisible.get(e.selector);
      if (!before) continue;
      const outside = e.box.x + e.box.width < 0 || e.box.x > snapshot.viewport.width;
      if (!outside) continue;
      out.push({
        ruleId: offViewport.id,
        message: `"${e.selector}" was visible in the baseline but now sits outside the ${snapshot.viewport.name} viewport, so it can no longer be reached.`,
        severity: 'major',
        selector: e.selector,
        region: e.box,
      });
    }
    return out;
  },
};

export const layoutShift: InvariantRule = {
  id: 'layout/shift-versus-baseline',
  title: 'Element moved without a content change',
  catches: 'Grid and alignment regressions',
  defaultSeverity: 'minor',
  changeAware: true,
  evaluate(snapshot, baseline) {
    if (!baseline) return [];
    const SHIFT_PX = 8;
    const before = new Map(baseline.elements.map((e) => [e.selector, e]));
    const out: InvariantViolation[] = [];
    for (const e of snapshot.elements) {
      const b = before.get(e.selector);
      if (!b) continue;
      const dx = Math.abs(e.box.x - b.box.x);
      const dy = Math.abs(e.box.y - b.box.y);
      if (dx < SHIFT_PX && dy < SHIFT_PX) continue;
      out.push({
        ruleId: layoutShift.id,
        message: `"${e.selector}" moved ${Math.round(dx)}px horizontally and ${Math.round(dy)}px vertically with no change to its content.`,
        severity: 'minor',
        selector: e.selector,
        region: e.box,
        detail: { dx, dy },
      });
    }
    return out;
  },
};
