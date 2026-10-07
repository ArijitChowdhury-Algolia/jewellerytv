# Graduation G1-G13 acceptance lane

The [canonical 13-beat story](../../../docs/workspace/concierge-phases-1-3-build-2026-10-05/DEMO-STORIES.md) and [local acceptance plan](../../../docs/workspace/graduation-journey-2026-10-07/PLAN.md) define the shopper inputs and gates. Illustrative Concierge lines are never asserted or sent as runtime answers. This package does not edit the shared Stage 7 manifest or runner, Agent Studio, the customer index, or application behavior.

`graduationOracle.ts` evaluates exact read-only product records for sterling material, no gold-coloured finish, no cap motif, first quality, stock, prior ownership, active price, green detail, explicit earring type and stone creation classification. It deliberately leaves missing source fields unknown. A `Set` word in a product title does not prove an official necklace-plus-earrings set.

The connected runner makes one intentional UI-timing adaptation to the authored Beat 6: it saves the first necklace before G5 refreshes Discover, then saves the quieter necklace after G5. G5 says the first was saved; G6 says both are saved and asks to see more. This keeps the exact earlier ID accessible through the real UI when Discover replaces its cards, while preserving the story's shopper choice and Saved-continuity test. The canonical storyboard itself is unchanged.

The zero-chat fixture uses synthetic restored state to click the real Saved, Compare and Combination controls. It proves those UI actions and nothing about real catalogue facts or generated dialogue:

```sh
npx playwright test --config evaluation/graduation-journey/graduation-fixture.config.ts
```

The connected G1-G13 runner is opt-in, uses one fresh browser mission, and skips without an Agent Studio call by default:

```sh
npx playwright test --config evaluation/graduation-journey/graduation-full.config.ts
```

Only after Controller freezes the repaired app and published agent and releases a paid window, run from `storefront/` with a fresh exact readback:

```sh
JTV_RUN_GRADUATION_FULL=1 JTV_MAX_COMPLETION_REQUESTS=65 \
JTV_EXPECTED_AGENT_ID=<controller-reviewed-agent-id> \
JTV_AGENT_SNAPSHOT=evidence/<exact-agent-readback>.json \
  npx playwright test --config evaluation/graduation-journey/graduation-full.config.ts
```

The 65-request cap is 13 shopper turns times up to five completions including continuations. Do not raise it without a measured budget review. The test writes per-turn screenshots, session state, network/tool request and response receipts, exact `/api/products/<id>` reads, source/hash checks, UI action evidence and an assertion ledger to a unique `.checkpoint/runs/graduation-full-<UTC>/` folder. Playwright traces also go to a unique `.checkpoint/runs/graduation-playwright-<UTC>/` folder. A mechanical error or missing hard product/source fact stops the run. Tone, understated style, comfort, official-set interpretation and educational claims remain review-pending unknowns, so a mechanically complete trace is not accepted automatically. `/api/health` omits the live agent ID; the expected ID and saved snapshot require an independent Controller route/readback check before acceptance.

The connected Playwright result intentionally stays red while any semantic/source judgment is `unknown`. After the run, an independent reviewer may write a separate JSON file with `reviewer`, `runtimeAgentIdentityVerified: true`, `summarySha256` for that run's immutable `summary.json`, and `judgments` keyed like `G1:semantic`, each `{ "status": "pass" | "fail", "evidence": "specific receipt and finding" }`. Repeated unknowns for different products use `#2`, `#3` and so on after the key, and need separate evidence. Resolve every unknown with evidence. Then run:

```sh
npx tsx evaluation/graduation-journey/graduation-review.ts \
  ../.checkpoint/runs/graduation-full-<UTC>/summary.json \
  ../.checkpoint/runs/graduation-full-<UTC>/independent-review.json
```

The review command writes a separate `acceptance-review.json` and refuses a mismatched summary hash or a second overwrite. A fixture, missing turn, mechanical failure, unverified runtime agent or unsupported claim cannot be turned into acceptance by a prose score alone.

## Handoff to Claude 2's Stage 7 owner

The dedicated package covers G1 to G13 only. Keep its connected result separate from the required Stage 4 anniversary gate and the Father F1-F12 package. Before adding graduation to the shared Stage 7 scenario manifest, reconcile the manifest owner, its current request budget and accounting contract. The integration handoff is the unique connected run's `summary.json`, its independent semantic/source review, exact agent/app identity proof, and the first-failure location. A fixture pass or skipped opt-in test must never increment connected-journey coverage.
