import type { InvariantRule, InvariantViolation } from '../types.js';
import { contrastRatio, parseColor, visibleInteractive } from './geometry.js';

/** WCAG 2.2 Success Criterion 2.5.8 (AA). */
const MIN_TAP_TARGET_PX = 24;

export const tapTarget: InvariantRule = {
  id: 'usability/tap-target',
  title: 'Tap target below the minimum size',
  catches: 'Mobile usability defects',
  defaultSeverity: 'minor',
  changeAware: false,
  evaluate(snapshot) {
    return visibleInteractive(snapshot.elements)
      .filter((e) => e.box.width > 0 && e.box.height > 0)
      .filter((e) => e.box.width < MIN_TAP_TARGET_PX || e.box.height < MIN_TAP_TARGET_PX)
      .map((e) => ({
        ruleId: tapTarget.id,
        message: `"${e.selector}" is ${Math.round(e.box.width)}x${Math.round(e.box.height)}px, below the ${MIN_TAP_TARGET_PX}px minimum, so it is hard to hit on a touch device.`,
        severity: 'minor' as const,
        selector: e.selector,
        region: e.box,
      }));
  },
};

export const contrast: InvariantRule = {
  id: 'usability/contrast',
  title: 'Text contrast below WCAG AA',
  catches: 'Unreadable text, grey-on-grey',
  defaultSeverity: 'minor',
  changeAware: false,
  evaluate(snapshot) {
    const out: InvariantViolation[] = [];
    for (const e of snapshot.elements) {
      if (!e.visible) continue;
      const fg = parseColor(e.color);
      const bg = parseColor(e.backgroundColor);
      if (!fg || !bg) continue;
      const size = e.fontSize ?? 16;
      // WCAG treats >=24px, or >=18.66px bold, as "large text".
      const required = size >= 24 ? 3 : 4.5;
      const ratio = contrastRatio(fg, bg);
      if (ratio >= required) continue;
      out.push({
        ruleId: contrast.id,
        message: `Text in "${e.selector}" has a contrast ratio of ${ratio.toFixed(2)}:1 against its background, below the ${required}:1 minimum, so it is hard to read.`,
        severity: 'minor',
        selector: e.selector,
        region: e.box,
        detail: { ratio, required, fontSize: size },
      });
    }
    return out;
  },
};

export const brokenImagery: InvariantRule = {
  id: 'rendering/broken-imagery',
  title: 'Image failed to render',
  catches: 'Missing assets, placeholder image leaks',
  defaultSeverity: 'major',
  changeAware: false,
  evaluate(snapshot) {
    return snapshot.images
      .filter((img) => !img.complete || img.naturalWidth === 0 || img.naturalHeight === 0)
      .map((img) => ({
        ruleId: brokenImagery.id,
        message: `The image at "${img.selector}" did not load, so a broken-image placeholder is showing instead.`,
        severity: 'major' as const,
        selector: img.selector,
      }));
  },
};

export const unstyledContent: InvariantRule = {
  id: 'rendering/unstyled-content',
  title: 'Page rendered without its stylesheet',
  catches: 'A stylesheet failed to load',
  defaultSeverity: 'critical',
  changeAware: false,
  evaluate(snapshot) {
    if (snapshot.document.hasStylesheets) return [];
    return [
      {
        ruleId: unstyledContent.id,
        message: 'No stylesheet applied to this page, so it is rendering with default browser styling.',
        severity: 'critical',
      },
    ];
  },
};

export const consoleErrors: InvariantRule = {
  id: 'runtime/console-errors',
  title: 'Console errors and unhandled rejections',
  catches: 'JavaScript failures that leave the UI half-working',
  defaultSeverity: 'major',
  changeAware: true,
  evaluate(snapshot, baseline) {
    // Report NEW errors only. An app with 40 pre-existing console errors should
    // not produce 40 findings on its first run (the same discipline spec 8.2
    // applies to axe-core violations).
    const known = new Set(baseline?.consoleErrors ?? []);
    return snapshot.consoleErrors
      .filter((e) => !known.has(e))
      .map((e) => ({
        ruleId: consoleErrors.id,
        message: `A new console error appeared on this screen: ${e.slice(0, 200)}`,
        severity: 'major' as const,
        detail: { error: e },
      }));
  },
};
