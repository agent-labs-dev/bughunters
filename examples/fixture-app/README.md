# fixture-app

AutoQA's own test subject. Two screens, one nav edge, one destructive action, and every source of non-determinism a real app has — a clock, `Math.random`, a sticky footer, relative timestamps.

```bash
pnpm dev                    # clean
BREAK=color pnpm dev        # pixel diff only
BREAK=occlusion pnpm dev    # layout/occlusion
BREAK=contrast pnpm dev     # usability/contrast
BREAK=tiny pnpm dev         # usability/tap-target
BREAK=clipped pnpm dev      # layout/overflow
```

Each `BREAK` value maps to exactly one detector. That is what makes this a scoring corpus rather than a demo: a run against `BREAK=contrast` should produce exactly one finding, from exactly one rule, and the acceptance criterion is checkable.

`Delete account` carries no `data-autoqa-safe` attribute, so the crawler must classify it as destructive and skip it.
