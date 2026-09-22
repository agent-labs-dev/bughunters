# Open-Source Visual UI Testing: Competitive Landscape

**Research date:** 19-20 September 2026
**Question:** what already exists for an open-source tool that (1) runs in CI, (2) is fast and generic, (3) gives visual outputs as screenshots *or* videos, (4) has screenshot comparison built in to find regressions, and (5) produces nice reports.

All star counts, licenses, versions and dates in the tables below were independently verified against the public GitHub and npm APIs on 2026-09-19/20.

---

## 1. Executive summary

**No single open-source tool on the market today does all five things.** Every existing option covers one or two of the five, and the two halves of the problem - *capture* and *compare-and-review* - live in different projects that nobody has joined up.

The split is structural:

- **Capture is solved and commoditised.** Playwright, Puppeteer, Cypress, Selenium and Appium all capture screenshots and video, are fast, are generic, and are free. This half is not a differentiator; it is a dependency.
- **Comparison is solved as a library, not a product.** `pixelmatch`, `odiff`, `looks-same` and `Resemble.js` are mature, fast and free. What nobody gives away is the workflow on top of them.
- **The review-and-approve loop is where every project either dies or starts charging.** This is the consistent finding across all five research lanes: the diff engine is a commodity, the *report and approval workflow* is the business.

Three specific findings that should shape what gets built:

1. **The most-cited "open-source Percy alternative" is dead.** Lost Pixel (`lost-pixel/lost-pixel`, MIT, 1,683 stars) was **archived on 2026-04-22** with the message "Lost Pixel is joining Figma. We are sunsetting the product." It is still the top search result for the category and still recommended in blog posts. That leaves a genuine vacancy.
2. **The only fully-free, complete, self-hosted stack is one project.** Visual Regression Tracker (Apache-2.0, 714 stars, v5.8.0 on 2026-09-01) is the only tool that ships diffing *plus* a self-hosted web review UI *plus* agent runners with no cloud dependency. It is also small, niche, and has documented operational sharp edges.
3. **Nobody in open source treats video as a first-class comparison artifact.** Every OSS visual-regression tool compares still images. Video capture lives in the browser frameworks, and video *comparison* exists essentially nowhere in open source. That is an open lane, and the user explicitly asked for it.

The single most valuable differentiator is also the least glamorous: **determinism**. Every lane's pain-point evidence converges on the same root cause - font rendering, anti-aliasing, sub-pixel differences and host environment drift produce false positives that destroy developer trust. A tool that ships opinionated, reproducible baselines would undercut the number-one real-world complaint in this space.

---

## 2. The landscape in five layers

The market is not a flat list of competitors. It is a stack, and each layer plays a different role.

| Layer | What it is | Who is in it | Do you compete with it? |
|---|---|---|---|
| **1. Frameworks with built-in comparison** | E2E/browser frameworks that ship a comparator | Playwright, WebdriverIO (+official visual service), Nightwatch VRT, Vitest browser mode | **No** - integrate. This is your capture layer. |
| **2. Frameworks with capture only** | Frameworks that take screenshots but cannot compare | Cypress, Puppeteer, Selenium 4, TestCafe, CodeceptJS, Robot Framework Browser | **No** - integrate. These are your users. |
| **3. Dedicated visual-regression tools** | Products whose whole job is snap-and-compare-and-report | Argos, Visual Regression Tracker, reg-suit, BackstopJS, Loki, Vizzly, Lost Pixel (dead) | **Yes** - this is the direct competition. |
| **4. Diff engines** | Image comparison libraries | pixelmatch, odiff, looks-same, Resemble.js, SSIM, ImageMagick | **No** - depend on one, or beat it. |
| **5. AI/agent-driven testing** | LLM/vision agents that drive interfaces | Skyvern, Browser Use, Stagehand, Midscene.js, Playwright MCP, Healenium, LaVague, Agent-E | **Adjacent** - complementary, and a plausible future feature. |

Plus two cross-cutting areas: **mobile** (a separate technology stack with its own tools) and **reporting/baselines** (not a layer but a competitive dimension that cuts across all of them).

---

## 3. Verified metadata (GitHub + npm, 2026-09-19/20)

### Layer 1 - frameworks with built-in comparison

| Tool | Repo | License | Stars | Latest release | Released | Status |
|---|---|---|---|---|---|---|
| Playwright | microsoft/playwright | Apache-2.0 | 96,379 | 1.63.0 | 2026-09-04 | Very active |
| Vitest (browser mode) | vitest-dev/vitest | MIT | 17,128 | 5.0.1 | 2026-09-15 | Very active |
| WebdriverIO | webdriverio/webdriverio | MIT | 9,835 | 9.31.9 | 2026-09-13 | Active |
| - its visual service | @wdio/visual-service | MIT | - | 10.1.0 | 2026-07-11 | Active |
| Nightwatch (VRT plugin) | nightwatchjs/nightwatch | MIT | 11,953 | (last push) | 2026-05-25 | **Stale ~4 months** |

### Layer 2 - capture-only frameworks

| Tool | Repo | License | Stars | Latest release | Released | Status |
|---|---|---|---|---|---|---|
| Puppeteer | puppeteer/puppeteer | Apache-2.0 | 95,591 | 25.11.0 | 2026-09-14 | Very active |
| Cypress | cypress-io/cypress | MIT | 51,018 | 16.1.0 | 2026-09-15 | Very active |
| Selenium 4 | SeleniumHQ/selenium | Apache-2.0 | 34,502 | 4.49.0 | 2026-09-09 | Very active |
| TestCafe | DevExpress/testcafe | MIT | 9,905 | - | - | Active |
| CodeceptJS | codeceptjs/CodeceptJS | MIT | 4,240 | - | - | Active |

### Layer 3 - dedicated visual-regression tools

| Tool | Repo | License | Stars | Latest release | Released | Status |
|---|---|---|---|---|---|---|
| Visual Regression Tracker | Visual-Regression-Tracker/... | Apache-2.0 | 714 | 5.8.0 | 2026-09-01 | Active |
| Argos | argos-ci/argos | MIT | 629 | cli 6.9.4 | 2026-09-13 | Active |
| reg-suit | reg-viz/reg-suit | MIT | 1,295 | 0.14.5 | 2025-08-26 | Active, slow |
| BackstopJS | garris/BackstopJS | MIT | 7,181 | 6.3.25 | 2024-09-07 | **Inactive, 577 open issues** |
| Loki | oblador/loki | MIT | 1,910 | 0.35.1 | 2024-08-27 | **Inactive since Oct 2024** |
| Vizzly | vizzly-testing/cli | MIT | 34 | - | - | Active, tiny |
| ~~Lost Pixel~~ | lost-pixel/lost-pixel | MIT | 1,683 | 3.22.0 | 2024-11-14 | **ARCHIVED 2026-04-22** |
| ~~Wraith~~ (BBC) | - | Apache-2.0 | - | - | - | **Archived - dead** |
| ~~PhantomCSS~~ | HuddleEng/PhantomCSS | MIT | 4,680 | - | 2018-12-10 | **ARCHIVED** |
| ~~Gemini~~ | gemini-testing/gemini | MIT | 1,505 | - | - | **ARCHIVED** (superseded by Testplane) |

### Layer 4 - diff engines

| Engine | License | Stars | Latest | Released | Algorithm | Speed |
|---|---|---|---|---|---|---|
| pixelmatch | ISC | 6,955 | 7.2.0 | 2026-04-29 | Pixel-level YIQ distance | Baseline |
| odiff | MIT | 3,201 | 4.5.0 | 2026-07-23 | SIMD-first, C++/N-API | **5-6x faster** |
| looks-same | MIT | 827 | - | - | Perceptual CIEDE2000 | Mid |
| Resemble.js | MIT | ~4,600 | - | - | Pixel + AA/color ignore | Mid |
| SSIM (ssim.js) | MIT | 317 | - | - | SSIM / MS-SSIM | Fast, **archived 2023** |
| ImageMagick compare | Apache-2.0-based | - | - | - | CLI, AE/RMSE metrics | Slow |

Published benchmark (odiff README, `hyperfine`, on cypress.io screenshots): odiff **1.168s** vs pixelmatch **7.712s** vs ImageMagick **8.881s** - roughly 6.6x faster than pixelmatch. On 4K images: 1.951s vs 10.614s vs 9.326s. The tradeoff is accuracy: pixelmatch is pixel-exact and trips on anti-aliasing; perceptual engines produce fewer false positives but can miss small real changes.

### Layer 5 - AI / agent-driven

| Tool | License | Stars | Last push | Approach | Maturity |
|---|---|---|---|---|---|
| Browser Use | MIT | 115,370 | 2026-09-18 | Hybrid DOM+vision agent | High |
| Playwright MCP | Apache-2.0 | 37,363 | 2026-09-18 | Accessibility tree | High (Microsoft) |
| Stagehand | MIT | 24,561 | 2026-09-20 | A11y-tree first | High |
| Skyvern | **AGPL-3.0** | 23,039 | 2026-09-20 | Hybrid DOM+CV | High |
| Midscene.js | MIT | 14,944 | 2026-09-20 | Vision (VLM) | High (ByteDance) |
| LaVague | Apache-2.0 | 6,388 | 2025-01-21 | Hybrid | **Dormant** |
| Agent-E | MIT | 1,251 | 2026-05-04 | Distilled DOM | Research |
| Healenium | Apache-2.0 | 167 | 2026-03-31 | Self-healing selectors | Niche |

### Mobile + reporting

| Tool | License | Stars | Latest | Released | Role |
|---|---|---|---|---|---|
| Appium | Apache-2.0 | 21,991 | - | - | Cross-platform mobile automation |
| Maestro | Apache-2.0 | 15,685 | - | - | Mobile/web YAML flows + `assertScreenshot` |
| Detox | MIT | 12,026 | - | - | React Native gray-box E2E |
| swift-snapshot-testing | MIT | 4,338 | 1.19.5 | 2026-09-15 | iOS host-rendered snapshots |
| Paparazzi | Apache-2.0 | 2,627 | 2.0.0-alpha05 | 2026-05-20 | Android JVM rendering, no emulator |
| Roborazzi | Apache-2.0 | 1,043 | 1.74.0 | 2026-09-08 | Android JVM via Robolectric |
| Allure 2 | Apache-2.0 | 5,540 | 2.46.1 | 2026-09-03 | Test reporting/trends engine |

**Two anomalies worth flagging:** `BBC-News/wraith` returned 0 stars - that is a placeholder repo, not the original Wraith; the real archived Wraith could not be resolved this run, so treat its figure as unverified. `replayio/replay` returned "Not Found" - the deterministic-replay project has moved or been renamed.

---

## 4. Openness matrix - genuinely open vs open-core vs dead

This is the most decision-relevant table in the report, because "open source" in this category routinely means *an MIT CLI attached to a paid cloud that does the actual reviewing*.

| Tool | Engine is OSS | Review UI is OSS | Runs fully self-hosted/offline | Verdict |
|---|---|---|---|---|
| **Visual Regression Tracker** | Yes | **Yes** | **Yes - complete** | **Only truly free full stack** |
| BackstopJS | Yes | Yes (HTML report) | Yes | Free and complete, but **inactive** |
| Loki | Yes | CLI + local UI | Yes (Docker for Chrome) | Free, Storybook-only, **inactive** |
| reg-suit | Yes | Static HTML report | Yes, but official publishers need S3/GCS | Free CLI, thin review |
| Playwright / Vitest / jest-image-snapshot | Yes | **No** - PNGs in CI artifacts | Yes | Free, but no approval workflow |
| **Argos** | Yes (all MIT) | Yes (hosted web app) | **"Not officially supported"** | Open-core in practice: Pro from ~$100/mo for 35k screenshots |
| **Vizzly** | CLI yes | Dashboard is theirs | Partial (query-engine Docker) | Open-core; free only for public OSS |
| **Lost Pixel** | CLI yes | UI was closed | No | **Dead** |
| Chromatic / Percy | SDK only | No | No | Commercial |

**The pattern:** the diff engine is given away, the review loop is monetised. Argos is the notable case - the entire platform is MIT including the diff service, but self-hosting requires AWS, PostgreSQL, RabbitMQ, Redis, S3, DynamoDB, a GitHub App and Stripe, and the docs say self-hosting is not officially supported. So the code is open and the product is effectively not.

---

## 5. What "nice reports" actually means, and the three universal gaps

A complete visual-review report needs, in rough order of how often tools ship it:

| Feature | Provided by |
|---|---|
| Side-by-side expected/actual/diff | Playwright HTML + trace viewer, Allure, BackstopJS, Paparazzi HTML |
| Onion-skin / overlay slider | Playwright trace viewer |
| Diff heat map | pixelmatch (used by Playwright + jest-image-snapshot), odiff, Paparazzi |
| Per-browser/device/viewport grouping | Playwright projects, BackstopJS scenarios, Allure environments |
| Video tied to failures | Playwright, Cypress, Detox, XCUITest |
| Trace/timeline replay with DOM snapshots | Playwright trace viewer |
| Step annotations, failure categories | Allure, Playwright |
| Cross-run history and trend charts | **Allure only** in OSS (needs external storage) |
| Flake/stability tracking | Allure, and the dedicated flake tools |
| **In-report "accept baseline" button** | **Nowhere in OSS - CLI re-run only** |
| **PR-inline visual review + approval** | **Hosted services only** |

**The three gaps that are universal in free/self-hosted tooling:**

1. **No in-report baseline acceptance.** Every OSS tool makes updating a baseline a CLI re-run (`--update-snapshots`, `flutter test --update-goldens`, `recordPaparazzi`). Approval buttons exist only on hosted products.
2. **No cross-run history or flake analytics without a hosted backend.** Allure is the sole exception, and it needs somewhere to persist `history.jsonl`.
3. **No PR-inline visual review.** Bolting this on is exactly what Argos/Percy/Chromatic sell.

There is a fourth, subtler point: **reviewing diffs at scale is a bigger bottleneck than detecting them.** One cited team resorted to "we strategically run Percy actions only when pull requests are marked 'Ready for Release', and we skip select Storybook scenarios" purely to stay inside a quota. Another concluded that teams "spend more time triaging diffs than fixing real regressions." Automated triage/classification is unclaimed.

---

## 6. Determinism is the number-one pain point

Every research lane independently produced the same complaint. This is the highest-signal finding in the entire study.

Concrete, cited evidence:

- **BackstopJS #1564:** "Anything from 50-95% of tests fail. The fails are random. Every time we run the tests, the result is different."
- **BackstopJS #1603:** roughly 25% of pages never load properly; after 15 runs there was never "a clean report while creating a reference of a page, then comparing that same page, unchanged."
- **BackstopJS #1298:** rerun with nothing changed and "the test will fail", with different pages failing each run.
- **Loki #501:** "the fonts seem to move 1 or 2 pixels... It fails randomly, we run the pipeline again, it succeeds."
- **Loki #407:** the Docker Chrome target "will fail 9/10"; the only fix was injecting an artificial delay into stories.
- **pixelmatch #74 / #2:** its anti-aliasing heuristic needs at least three neighbours of equal colour, so 1px-wide shapes generate diff noise.
- **Playwright's own docs warn** rendering "can vary based on the host OS, version, settings, hardware, power source, headless mode."
- **Paparazzi's default tolerance is deliberately loose at 0.1%** *because* layoutlib renders differently across Linux, Windows and macOS.
- **Vitest's docs** explicitly say references generated on one machine can fail elsewhere and route teams to Docker or cloud services.

The named root causes, in order: cross-OS font rendering (macOS CoreText vs Windows DirectWrite vs Linux FreeType), font loading races, anti-aliasing and sub-pixel rendering, GPU-vs-CPU (SwiftShader) rasterisation, animations and timing, dynamic content, scrollbar differences, and device-pixel-ratio mismatches.

**A second-order consequence is worse than the flake itself: teams stop trusting the tests.** One cited team reported "the failure rate stayed at 40%, and our developers stopped trusting E2E tests: 68% of surveyed engineers said they ignored failing E2E tests because they assumed they were false positives."

**The counter-intuitive failure mode:** tools that try to suppress anti-aliasing noise can end up *hiding real regressions*. Playwright issue #39742 (March 2026) documents AA suppression masking genuine changes, and BackstopJS #1607 documents a completely missing "Send feedback" button still reporting **PASSING** with `misMatchThreshold` set to zero. Determinism is not the same as strictness.

---

## 7. The AI/agent layer does not do what this tool needs to do

There is a real and often-claimed gap here, and it is worth being precise about it, because "smart testing" is the phrase in the brief.

**Finding: no open-source project combines LLM-driven test authoring with deterministic visual regression and CI reports.** But that framing slightly oversells the opportunity, because the two halves are in tension rather than being two missing pieces of one thing.

Why accuracy is the blocker:

| Benchmark | Human baseline | Best agent |
|---|---|---|
| WebArena | 78.24% | 74.3% (WebTactix, Feb 2026) |
| WebVoyager (643 tasks) | - | 89.1% (Browser Use, self-reported); 85.85% (Skyvern, vendor-run) |
| OSWorld | 72.36% | 86.1% (OSWorld-Verified top); version variance is enormous |

Best-in-class agents land around 74-86% task success. A CI gate that blocks a merge needs effectively 100% correctness on the paths it asserts. At ~80% single-run success, an agent-driven test would be wrong roughly one run in five - **worse than the flakiness it is meant to remove.** This is why the field has converged on the same architecture: use the agent to *author and heal*, commit the generated deterministic test, and run **that** in CI with zero LLM calls.

Cost reinforces it: naive Playwright MCP usage runs about **$45 per 10-step test run** versus under $0.50 for the Playwright CLI. Browser Use's own eval repo documents ~$250 for one pass of WebVoyager's 643 tasks (~$0.39/task). The cheapest credible option is H Company's Surfer-H + Holo1-7B at **$0.13/task at 92.2% WebVoyager** - the best accuracy-per-dollar in the field.

**Critically: none of these tools do deterministic pixel-diff regression.** Midscene.js is the closest to a complete package - vision-driven authoring in JS/YAML/Gherkin, runs inside Playwright/Puppeteer, and produces the richest HTML report in the whole study (screenshots, element locations, AI decision trail, per-step replay video, JSON/Markdown export). But its visual checking is `aiAssert`, a *model-judged* assertion, which its own docs warn needs standard JS assertions to avoid false positives. That is perceptual judgement, not a baseline-pixel gate. Different thing.

Also note **Skyvern is AGPL-3.0**, not MIT - relevant if you ever want to reuse its code.

**Practical takeaway:** treat this layer as a complementary integration (authoring and self-healing), not as the core of the tool, and note that a cluster of tiny unproven OSS projects (`las-team/lastest`, `dacheson/spotter`, `jstuart0/visiontest-ai-oss`, `zzhiyuann/ui-snap`) do attempt the full combination and all sit at 1-200 stars. They confirm the combination is an unmet need, not that it has been solved.

---

## 8. Mobile visual testing - a separate stack with one clear hole

Mobile is not a variant of web visual testing; it is a different toolchain, and it has no cross-platform answer at all.

| Tool | Platform | License | Stars | Screenshot | Built-in diff | Video | Biggest limitation |
|---|---|---|---|---|---|---|---|
| Maestro | Android, iOS, web | Apache-2.0 | 15,685 | Yes | **Yes** (`assertScreenshot`, threshold, crop) | Cloud/Studio only | CLI needs a live device; thin report artifacts |
| Detox | iOS, Android (RN) | MIT | 12,026 | Yes | **No** | Yes (`--record-videos`) | Maintainers closed image-compare as "low priority" (#1362) |
| Appium | iOS, Android, Win, macOS | Apache-2.0 | 21,991 | Yes | Plugin only (images/OpenCV) | No | No baseline store, no CI comparison workflow |
| swift-snapshot-testing | iOS, tvOS, macOS | MIT | 4,338 | Yes (host-rendered) | Yes (`precision`, `perceptualPrecision`) | No | Reference must match simulator OS/gamut/scale |
| Paparazzi | Android (JVM) | Apache-2.0 | 2,627 | Yes | Yes (default tolerance 0.1%) | No | layoutlib renders differently per OS; still alpha |
| Roborazzi | Android (JVM) | Apache-2.0 | 1,043 | Yes | Yes (configurable) | No | Robolectric fakes the SDK; can diverge from device |
| Flutter goldens | Flutter | BSD-3 | SDK | Yes | Yes, pixel-exact | No | No tolerance knob; fragile across hosts |

**The hole:** there is no single open-source tool that does cross-platform app visual regression without devices. It is achieved today by host-side renderers, one per platform - Paparazzi/Roborazzi (Android), swift-snapshot-testing (iOS), Flutter goldens. For React Native the only route is Detox screenshots plus `jest-image-snapshot`.

Where devices are unavoidable, cost and flakiness follow: Firebase Test Lab runs ~$5/device-hour (Blaze 15c/min); BrowserStack App Automate starts ~$199/month for one parallel with reported peak-hour session flakiness. Emulators on hosted Linux runners are free but slow and flaky.

**A device-free, cross-platform, screenshot-plus-video-plus-diff-plus-report binary is the single clearest unclaimed position in the whole landscape.**

A cautionary precedent for anyone attempting it: Thumbtack migrated 1,500 Android screenshot tests *off* Firebase Test Lab onto Roborazzi because Firebase was "slow, tedious, and error-prone" - and Roborazzi's own docs admit Robolectric output can diverge from a real device. There is no free lunch here, only a choice of which inaccuracy to accept.

---

## 9. Commercial incumbents - what they charge and where they are weak

All prices fetched 2026-09-19 from vendor pricing pages where possible.

| Product | Model | Public entry price | Free tier | Self-host | Diff approach |
|---|---|---|---|---|---|
| Percy (BrowserStack) | per screenshot | **$199/mo** (10k shots); $599/mo mobile | 5,000/mo | No | Pixel + AI review |
| Applitools | "Test Unit" | **Not public**; est. ~$200-500/mo at scale, $5k+/mo enterprise | 50/mo | Yes (enterprise only) | **Visual AI** (layout/content) |
| Chromatic | per snapshot | **$179/mo** (35k); $399/mo (85k) | 5,000/mo | No | Pixel + change-aware |
| Sauce Labs Visual | per session + snapshots | $149-199/mo incl. **only 500 snapshots** | No | No | Snapshot diff |
| LambdaTest / TestMu SmartUI | per screenshot | $199/mo (15k) | 2,000 **lifetime** | No | Pixel/layout/AI |
| Katalon | per seat | $84-150/seat/mo | Free Studio edition | No | Functional + basic visual |
| testRigor | AI agents/parallelism | $300/mo (Linux Chrome only); $900/mo usable | Public plan (tests are public) | No | Generative AI |
| Functionize | credits + users | $20-200/mo self-serve; **$80k-84k/yr** enterprise | Free tier | Private cloud (ent.) | NLP/ML |
| QA Wolf | usage + managed | 1c/AI credit + 15c/runner-min; ~$40-44/test/mo managed | Trial | No | Playwright + human triage |
| mabl | credits | **Not public**; est. $499/mo to $40k/yr | 14-day trial | No | AI auto-healing |
| Meticulous | custom | **Not public** | Demo | No | Deterministic replay |
| Autonoma | credits | Free self-host; $499/mo cloud | 100k credits | **Yes, free** (BSL 1.1) | Agentic/vision |
| Momentic | credits | $125/mo (~1,000 runs) | 2,000 credits/mo | No | AI/vision |
| ~~Waldo~~ | - | Acquired by Tricentis (2023), development stalled | - | No | - |

### The pricing wedge, with arithmetic

Unit definitions matter. BrowserStack's own docs define one snapshot as page x viewport width x browser, so **200 pages x 3 viewports x 3 browsers = 1,800 chargeable screenshots per run.**

At **39,600 screenshots/month** (one full run per working day):

| Tool | Arithmetic | Monthly |
|---|---|---|
| Percy Desktop | $199 (10k incl.) + 29,600 x $0.036 | **$1,265** |
| Percy Desktop & Mobile | $599 (25k incl.) + 14,600 x $0.048 | **$1,300** |
| Chromatic Starter | $179 (35k incl.) + 4,600 x $0.008 | **$216** |
| Playwright built-in | baselines in git | **$0** |

At 5,000 screenshots/month everything is free. At 50,000, Percy costs ~$1,639/mo while Chromatic's Pro plan covers it for $399. **The squeezed segment is the 15k-85k/month band** - a mid-size team with enough coverage to matter and not enough leverage for an enterprise discount. That is the customer a new open-source tool would win.

### Cited pain points that define the opening

The five most load-bearing, each with its source:

1. **Screenshot-count pricing explodes at scale.** "Test 20 pages across 3 viewports, and you consume 60 snapshots per run. With 3 pull requests per day... the 5,000 snapshots evaporate in less than two weeks."
2. **Teams ration coverage to stay in budget.** One design-systems team cut snapshots to fit the free tier: "we strategically run Percy actions only when pull requests are marked 'Ready for Release,' and we skip select Storybook scenarios."
3. **Applitools' opacity is itself the complaint.** "The pricing model based on 'checkpoints' means the more you test, the more you pay - creating a perverse incentive to limit your testing."
4. **Cloud upload blocks regulated teams outright.** "Some IT departments simply forbid sending data to non-approved external services. If your visual testing tool is cloud-based, it's blocked." Reinforced by PCI-DSS/HIPAA procurement write-ups.
5. **Vendor lock-in is real and expensive.** "Migrating means rebuilding workflows and re-establishing baselines." One (vendor-authored, uncorroborated) migration story claims six months of work that "cost more than two years of BrowserStack subscription fees."

**Where the incumbents actually win:** not diff quality (only Applitools has genuinely differentiated matching) and not CI integrations (a thin, replicable moat). They win on **procurement inertia, a polished review UI, and sales**. Applitools, Testim, Functionize, mabl, QA Wolf, Meticulous and Rainforest all hide price behind a demo. That opacity is the switching wedge.

**Commodity warning:** the flake/reporting lane - Currents, BuildPulse, Trunk, Datadog Test Optimization - has already been priced down to $0-99/month. Do not expect to charge for flake analytics.

---

## 10. Baseline and artifact storage

The decision that generates the most follow-on operational pain.

| Approach | Pros | Cons |
|---|---|---|
| Git-committed baselines | Simple, reviewable in PR, versioned | Binaries bloat history; a font change touching 100 commits is painful |
| Git LFS | Keeps binaries out of the tree | Grows metadata, incurs bandwidth bills, every CI clone pulls them |
| Object storage + hash manifest | Repo stays lean; download only differing baselines (often zero) | Extra CI steps; loses git-native review |
| Hosted store (Chromatic/Argos/Percy) | Best review UX, history, approval buttons | Cost and lock-in |
| GitHub Actions artifacts | - | **Does not work as a baseline store:** 90-day default retention, 500MB-2GB quota, billed beyond |

Practical default the research supports: commit small suites (LFS or plain git), switch to S3-plus-manifest above roughly 500MB of snapshots, and reach for a hosted store only when multiple reviewers must formally approve.

---

## 11. Positioning recommendation

The five gaps worth attacking, in order of how defensible each is:

1. **Determinism as the headline feature.** Ship reproducible baselines - pinned fonts, `fontconfig`, a pinned browser build, containerised capture - and make "same output on every machine" a guarantee rather than a user-configuration burden. Every other free tool leaves this to the user, and it is the number-one complaint in the space. This is the strongest wedge because it is engineering work, not marketing.
2. **No per-screenshot meter, ever.** A self-hosted tool has a $0 marginal cost per screenshot, which inverts the exact pricing mechanic that repels the 15k-85k/month team. Say it plainly in the README.
3. **Video as a first-class artifact.** This is genuinely unclaimed in open source - nobody compares or reports on video. Even shipping video *capture tied to failures* with the diff report would be distinctive today; video comparison would be novel.
4. **The missing review workflow, self-hosted.** An in-report accept/reject button that writes the baseline back, plus cross-run history, is unshipped in every free tool. This is precisely the layer incumbents monetise, so building it free is both the hardest and the most valuable part.
5. **Portable, lock-in-free baselines.** A documented, versioned baseline format any tool can read.

Two things to avoid:

- **Do not compete with Playwright.** It already captures screenshots and video, compares with pixelmatch, and ships an HTML report and trace viewer - at 96k stars, Apache-2.0, released days ago. Integrate with it as the capture layer and be the comparison/review layer on top. The same applies to Cypress, Selenium, Puppeteer and WebdriverIO, which are users to be served, not rivals.
- **Do not lead with an LLM.** Agent task success sits at 74-86%; a merge gate needs ~100%. Use AI for authoring and self-healing (the field's own convergence), and keep the CI path deterministic with zero LLM calls and zero per-run cost.

**Honest competitive read:** the direct competition in Layer 3 is thin and weakening. Lost Pixel is archived, Loki and BackstopJS are inactive, Vizzly has 34 stars, and the only healthy entrants are Argos (open-core in practice) and Visual Regression Tracker (small, niche, Apache-2.0, with documented operational bugs around DB sessions, filename collisions and replica handling). The category's leader-by-citation is dead and its leader-by-quality gates the review workflow behind a paid cloud. That is an unusually clean opening - but note the graveyard: PhantomCSS, Gemini, Wraith, Lost Pixel. The reason this market has empty seats is that the review workflow is genuinely hard to build well and hard to sustain for free.

---

## 12. What could not be verified

Stated explicitly rather than papered over:

- **`BBC-News/wraith` returns 0 stars** - a placeholder repo, not the original. The real Wraith's archived star count is unconfirmed.
- **`replayio/replay` returned "Not Found"** - the deterministic-replay project has moved or been renamed; its current repo and license status are unknown.
- **Argos publishes no GitHub releases or tags** (the API returned an empty tag list); its version is reported from the npm CLI package (6.9.4) instead. Its star count also read inconsistently across fetches (603 vs 629).
- **BackstopJS's GitHub release tag (v3.8.8, 2019) is stale** relative to npm (6.3.25, 2024-09-07); the npm figure is the accurate "what is shipping" number, but the repo has had pushes as recently as 2026-09-08, so "inactive" is a judgement call based on release cadence, Snyk's maintenance rating and its 577 open issues rather than a hard fact.
- **Not-quotable pricing:** Applitools, mabl, Testim, Meticulous, Rainforest QA and Sauce Labs overage rates publish no per-unit price. Figures given for those are explicitly second-hand or modelled, and flagged as such.
- **Vendor-authored sources** (`delta-qa.com`, `getautonoma.com`, `bugbug.io` and similar) write about competitors' pain while selling an alternative. They were used for framing only; the underlying user voice is drawn from GitHub issues, PeerSpot and TrustRadius.
- **Benchmark comparability is poor.** `steel.dev` and `pass.io` leaderboards mix self-reported and independently-run results under inconsistent protocols and include some implausibly high tail scores (99.19% on WebVoyager). Only the original papers are strictly comparable, and OSWorld shows ~31% vs ~86% top scores depending on the board version.
- **Skyvern's license had one conflicting read** (one extraction returned MIT, the repo page and a second read returned AGPL-3.0). Treated as AGPL-3.0; verify before reusing code.
- **fastlane and the Flutter SDK** release figures were not re-verified; golden_toolkit's GitHub repo 404s, so its location is unconfirmed (its pub.dev page is live). The Storybook test-runner star count (278) looks mis-extracted and is unverified.
- **Wall-clock CI run durations** are not documented by any of these projects, so no comparative speed claims beyond the odiff/pixelmatch/ImageMagick microbenchmark are made.

