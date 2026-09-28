# fixture-app

Bugpatrol's own test subject. Two screens, one nav edge, one destructive action, and every source of non-determinism a real app has — a clock, `Math.random`, a sticky footer, relative timestamps.

```bash
pnpm dev                    # clean
BREAK=color pnpm dev        # pixel diff only
BREAK=occlusion pnpm dev    # layout/occlusion
BREAK=contrast pnpm dev     # usability/contrast
BREAK=tiny pnpm dev         # usability/tap-target
BREAK=clipped pnpm dev      # layout/overflow
```

Each `BREAK` value is designed to trip one *named* detector, which is what makes
this a scoring corpus rather than a demo: `BREAK=contrast` must produce a
`usability/contrast` finding, `BREAK=occlusion` a `layout/occlusion` finding,
and so on.

Every break also trips `visual/pixel-diff`, because every one of them changes
pixels. That is correct rather than noise — `BREAK=color` changes *only* pixels,
and it exists to prove the pixel diff catches what no invariant can describe.

`Delete account` carries no `data-bugpatrol-safe` attribute, so the crawler must classify it as destructive and skip it.
