# Father's Day watch connected journey

This directory is owned by the Demo Stories task. The [canonical Father script](../../../docs/workspace/concierge-phases-1-3-build-2026-10-05/DEMO-STORIES.md) and [dedicated acceptance plan](../../../docs/workspace/fathers-day-journey-2026-10-07/PLAN.md) define the behavior. The local links point to ignored project documentation in the shared checkout; the tracked harness does not hardcode a Concierge reply or product ID.

`father-opening.spec.ts` is the first three-turn gate, F1 through F3. It is opt-in and skips by default:

The first live attempt stopped after F1 (two completion requests, no products). It did **not** pass: person-first quality was weak and one continuation stream ended `net::ERR_ABORTED` after HTTP 200. F2/F3 and the full 12-beat journey remain unrun. Preserve [the assessment](../../../.checkpoint/runs/fathers-day-opening-2026-10-07T08-29-43-833Z/ASSESSMENT.md); do not repeat the paid run until the abort and prompt behavior are reviewed with Controller/Dev2.

A second user-authorized parallel-browser diagnostic reproduced the same F1 pattern without changing shared code or configuration. Its [separate assessment](../../../.checkpoint/runs/fathers-day-opening-2026-10-07T08-37-03-851Z/ASSESSMENT.md) retains the `net::ERR_ABORTED` trace and generated reply. Both are failures, not two passes or a completed journey.

Controller has approved a **diagnostic-only** F1-F3 run to inspect later beats while the F1 transport observation is unresolved. Set `JTV_FATHER_DIAGNOSTIC_CONTINUE=1` alongside the two opt-in variables above. The runner may classify only an HTTP-200 `net::ERR_ABORTED` with a visible completed reply and no notice as `transport-observation-unknown`; it still halts for any other first failure and deliberately fails the Playwright result even if F2/F3 render. The prior F1 failures remain intact, and this run cannot accept the Father story.

After that diagnostic reached F2 and stopped on a curation concern, Controller approved one **F3-only resumed diagnostic** from the exact F2 session snapshot, avoiding another paid F1/F2. It is a new browser context restoring the same recorded mission, so it tests continuity but is not the uninterrupted 12-beat acceptance run. Use only the approved saved file and a five-completion stop:

```sh
JTV_RUN_FATHER_OPENING=1 JTV_MAX_COMPLETION_REQUESTS=5 \
JTV_FATHER_RESUME_SESSION=../.checkpoint/runs/fathers-day-diagnostic-2026-10-07T08-45-22-594Z/F2-session.json \
  npx playwright test --config evaluation/fathers-day-journey/father-opening.config.ts
```

The harness validates that the mission ID and earlier assistant turns restore, preserves the new F3 evidence, and deliberately reports diagnostic-only rather than acceptance even if the turn works.

After the 09:00 prompt after-probe showed one Father answer twice inside a single assistant message, the Father harness gained a narrow integrity check. It fails the current turn if an identical answer of at least 80 characters appears again after a tool part. It does not compare replies across missions or reject distinct pre-tool and final language. The saved `father.json` receipt at `.checkpoint/runs/person-first-v2-2026-10-07T09-14-46-643Z/` reproduces the detection with a 283-character repeated text part. This is test-only; it does not rewrite the Concierge's message or repair the stream.

```sh
npx playwright test --config evaluation/fathers-day-journey/father-opening.config.ts
```

After coordinating a frozen app/agent version with Controller and Dev2, a single bounded connected run uses:

```sh
JTV_RUN_FATHER_OPENING=1 JTV_MAX_COMPLETION_REQUESTS=15 \
  npx playwright test --config evaluation/fathers-day-journey/father-opening.config.ts
```

The 15-request cap covers three shopper turns at up to five completion requests each, including continuations and failures. The runner aborts requests beyond the cap, stops further turns on an observable first failure, saves every captured response and screenshot under `.checkpoint/runs/fathers-day-opening-<UTC timestamp>/`, and records semantic/source checks as unknown pending independent review. It cannot produce a green acceptance verdict while those checks remain unknown. A skipped dry run or a visually attractive card is not a journey pass.

The remaining F4 through F12 full-journey run is prepared only after F1-F3 passes and real products/identities are reviewed. Shared prompt, state, retrieval and app repairs go through Controller with an exact before/after diff and rollback; this directory makes no runtime change. Customer indices/settings remain read-only.

## Full Father F1-F12 runner

`father-full.spec.ts` is the separate uninterrupted 12-beat connected runner. It is opt-in and skips without a paid call by default. It chooses watch and bracelet IDs from the live cards and exact read-only `/api/products/<id>` records; no sample SKU or Concierge sentence is a runtime answer. It performs actual Save, Compare and Combination actions, checks cent arithmetic and source identity, captures every chat/evidence request it observes, saves each turn's session and screenshots, and stops at the first mechanical or record-level defect. Interpretive warmth, fit, swimming guidance and delivery claims remain `unknown` until independent semantic review, so a clean browser trace is not an automatic acceptance pass.

The no-paid UI fixture uses the saved F2 mission from the earlier diagnostic and blocks `/api/chat`. It proves that the real Save, Compare and Combination controls work on restored cards; it is explicitly **not** a connected journey or catalogue acceptance:

```sh
JTV_FATHER_FIXTURE_SESSION=../.checkpoint/runs/fathers-day-diagnostic-2026-10-07T08-45-22-594Z/F2-session.json \
  npx playwright test --config evaluation/fathers-day-journey/father-full-fixture.config.ts
```

After Controller supplies a frozen app and published-agent identity, and the F1-F3 defects have passed a separate connected gate, run the full shopper journey from `storefront/`:

```sh
JTV_RUN_FATHER_FULL=1 JTV_MAX_COMPLETION_REQUESTS=60 \
JTV_EXPECTED_AGENT_ID=0bdf59fe-e598-4db7-b139-2b93d5255bb4 \
JTV_AGENT_SNAPSHOT=evidence/<frozen-agent-readback>.json \
  npx playwright test --config evaluation/fathers-day-journey/father-full.config.ts
```

Replace the example snapshot path with the exact Controller-approved readback; verify the agent ID at run time. The runner compares the expected ID to the snapshot and hashes the snapshot and local source before and after. `/api/health` does not expose the live agent ID, so the runner labels runtime agent identity `unknown` until an independent readback/route check confirms it. Do not treat the operator-supplied ID as proof. The 60-completion cap is 12 turns times up to five completions including continuations. If measured continuation behavior makes that cap inadequate, review the budget before another paid run; do not silently raise it.
