/**
 * The in-page probe. Serialized and evaluated inside the browser to produce a
 * ScreenSnapshot, so every geometric invariant runs against real computed
 * layout rather than an inference from the DOM.
 *
 * It is written as a string rather than a function because it must not close
 * over anything in the Node scope, and because it is injected into a page that
 * is, by definition, untrusted content (spec 11.1).
 */
export const PROBE_SOURCE = String.raw`
(() => {
  const INTERACTIVE = 'a,button,input,select,textarea,summary,[role=button],[role=link],[role=tab],[onclick],[tabindex]:not([tabindex="-1"])';
  const MAX_ELEMENTS = 1500;

  function selectorFor(el) {
    if (el.dataset && el.dataset.testid) return '[data-testid="' + el.dataset.testid + '"]';
    if (el.id) return '#' + el.id;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 4) {
      let part = node.tagName.toLowerCase();
      if (node.classList && node.classList.length > 0) part += '.' + [...node.classList].slice(0, 2).join('.');
      const parent = node.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function hasText(el) {
    for (const child of el.childNodes) {
      if (child.nodeType === 3 && child.textContent.trim().length > 0) return true;
    }
    return false;
  }

  const seen = new Set();
  const elements = [];
  const candidates = [...document.querySelectorAll(INTERACTIVE), ...document.querySelectorAll('*')];

  for (const el of candidates) {
    if (elements.length >= MAX_ELEMENTS) break;
    if (seen.has(el)) continue;
    const interactive = el.matches(INTERACTIVE);
    const style = getComputedStyle(el);
    // A container that clips its content is, by definition, one whose own
    // direct children are elements rather than text -- so collecting only
    // interactive-or-has-text elements makes the overflow detector structurally
    // unable to fire on the very elements it exists to catch.
    const clipping =
      (style.overflow === 'hidden' || style.overflowX === 'hidden') && el.scrollWidth > el.clientWidth + 1;
    if (!interactive && !clipping && !hasText(el)) continue;
    seen.add(el);

    const rect = el.getBoundingClientRect();
    const visible =
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      Number(style.opacity) > 0.01 &&
      rect.width > 0 &&
      rect.height > 0;

    let hitSelector;
    if (visible && interactive) {
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      if (cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight) {
        const hit = document.elementFromPoint(cx, cy);
        // Walking up from the hit target means a click landing on a child of the
        // element still counts as reaching it.
        hitSelector = hit && (hit === el || el.contains(hit)) ? selectorFor(el) : hit ? selectorFor(hit) : undefined;
      }
    }

    elements.push({
      selector: selectorFor(el),
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      visible,
      interactive,
      zIndex: Number(style.zIndex) || 0,
      hitSelector,
      color: style.color,
      backgroundColor: effectiveBackground(el),
      fontSize: parseFloat(style.fontSize) || 16,
      overflowHidden: style.overflow === 'hidden' || style.overflowX === 'hidden',
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    });
  }

  function effectiveBackground(el) {
    // Walk up until a non-transparent background is found, because contrast is
    // computed against what is actually rendered behind the text.
    let node = el;
    while (node && node.nodeType === 1) {
      const bg = getComputedStyle(node).backgroundColor;
      if (bg && bg !== 'transparent' && !bg.startsWith('rgba(0, 0, 0, 0)')) return bg;
      node = node.parentElement;
    }
    return 'rgb(255, 255, 255)';
  }

  // Outgoing links. These are what the app-graph is drawn from: every one is a
  // candidate edge from this screen to another. Collected here rather than
  // per-element because the graph cares about destinations, not geometry.
  const links = [];
  const seenHrefs = new Set();
  for (const anchor of [...document.querySelectorAll('a[href]')].slice(0, 400)) {
    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;
    let resolved;
    try {
      resolved = new URL(href, location.href).toString();
    } catch {
      continue;
    }
    if (seenHrefs.has(resolved)) continue;
    seenHrefs.add(resolved);
    const rect = anchor.getBoundingClientRect();
    links.push({
      href: resolved,
      text: (anchor.textContent || '').trim().slice(0, 120),
      external: new URL(resolved).origin !== location.origin,
      selector: selectorFor(anchor),
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    });
  }

  const images = [...document.images].slice(0, 300).map((img) => ({
    selector: selectorFor(img),
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
    complete: img.complete,
    alt: img.alt,
  }));

  return {
    url: location.href,
    title: document.title,
    elements,
    links,
    images,
    document: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
      hasStylesheets: document.styleSheets.length > 0,
    },
  };
})()
`;
