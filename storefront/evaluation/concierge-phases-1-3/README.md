# Plan 3.1 integrated acceptance scaffold

This folder owns a **prepared, unexecuted** browser campaign. Its eleven journeys remain examples for acceptance, not proof of accepted behavior. The older `storefront/tests/e2e/concierge-phases-1-3.spec.ts` scaffold was retired because it treated completion requests as shopper turns and conflicted with this manifest. Historical source remains in Git history.

The runner uses the current two-column Concierge and actual `Save`/`Compare` controls. It counts shopper turns separately from every observed `/api/chat` completion request, including continuations, retries and failed responses. A request budget must be provided explicitly. Unknown, blocked, unrun and failed assertions never become passes. The first failure is retained. A harness defect stops the full campaign. A spent budget is a controlled stop, not a harness defect, and leaves the remaining journeys unexecuted. At most one explicit transport retry is issued per failed turn, and retries consume the same budget.

Local verification, with no paid turns:

```sh
node --test evaluation/concierge-phases-1-3/*.test.mjs
npx playwright test --config evaluation/concierge-phases-1-3/live.playwright.config.ts
```

The Playwright command skips by default. Before any live campaign, calculate an approved cumulative budget from planned shopper turns, expected continuations, auxiliaries and repetitions; then set both `JTV_RUN_LIVE_CONCIERGE_E2E=1` and `JTV_MAX_COMPLETION_REQUESTS` for that bounded run. The application must already be running. Do not infer classifier or suggestion work from `/api/chat` calls; where the platform does not expose those events, usage remains unknown.

## Stage 7 harness readiness ledger (2026-10-07, prepared, no live run)

Per-case readiness of the campaign harness. "Harness-ready" means: the manifest declares the journey in full, the runner supports every declared UI action kind, request classification is semantic (identical request body repeated in a turn is a retry; a distinct body is a continuation; failed or 4xx/5xx responses are failures), the ledger accounts turns, requests, retries, first failures and budget, and reply/UI-action deadlines follow the phase 3 test plan (180 seconds per live reply, 15 seconds per UI action, one transport retry per failed turn).

| # | Journey | Turns | Harness-ready | Mechanical assertions | Interpretive assertions | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | broad-gift-saved-downselect | 3 | yes | discovery-results, saved-count-at-least-5, comparison-state | gift-context, budget-recorded, downselection-request | save-first 5, compare-first-saved 2 |
| 2 | broad-blog-detour-stop | 4 | yes | discovery-results | education-needed, mission-retained, blog-evidence-or-gap, unknown-preserved, no-unsupported-certainty, stopping-respected | |
| 3 | necklace-liked-anchor-replace-companion | 4 | yes | none | all interpretive | missing-weight unknown case; no fixture wired |
| 4 | necklace-scope-education-resume | 4 | yes | comparison-state | component-scope-recorded, budget-recorded, blog-evidence-or-gap, comparison-retained, same-identities-retained, brief-retained | |
| 5 | ring-gift-compare-correction | 4 | yes | discovery-results, saved-count-increases, comparison-refreshed | gift-context, approximate-budget, strict-boundary, stable-reference-or-narrow-clarification, brief-retained | |
| 6 | ring-set-contents-unknown | 4 | yes | none | all interpretive | set-contents unknown case; no fixture wired |
| 7 | bracelet-five-saves-replacement | 4 | yes | discovery-results, saved-count-at-least-5, comparison-state | gift-context, budget-recorded, anchor-retained, look-candidates, component-replacement, budget-retained | save-first 5, compare-first-saved 2 |
| 8 | bracelet-blog-care-detour | 4 | yes | discovery-results | education-needed, mission-retained, blog-evidence-or-gap, unknown-preserved, no-unsupported-certainty, stopping-respected | |
| 9 | watch-gift-compare-downselect | 4 | yes | comparison-state, saved-count-increases | gift-context, budget-recorded, tradeoff-explanation, recommendation-or-honest-gap, no-unsupported-certainty, stopping-respected | |
| 10 | watch-look-replacement-stop | 4 | yes | none | all interpretive | |
| 11 | e21-continuity-anniversary | 22 | yes | discovery-results, saved-count-at-least-5 (x2), saved-count-increases, comparison-state, comparison-refreshed (x2) | remaining interpretive continuity expectations | E21 long continuity case; save-first 5 (x2), compare-first-saved 2 |

Planned shopper turns total 80 across 14 journeys (10 family journeys, the 22-turn E21 continuity case, and three canonical demo stories) before repetitions. Repetition policy is declared in `execution.repetitions` (critical journeys 3 runs, standard 2, at least one reserved wording variant per case), deadline policy in `execution.deadlines`, and six reserved wording variants in `execution.wordingVariantsDeclared` (substituted at run time only with `JTV_WORDING_VARIANTS=1`; they consume the same budget).

## Completion-request budget, derived from observed continuation accounting

An earlier 250-request proposal was REFUTED by the observed data. Four saved runs (`.checkpoint/runs/stage2-smoke-2026-10-07T04-12-*`, `stage2-smoke-2026-10-07T04-28-*`, `c4-exclusion-verify-2026-10-07T07-00-*` and `T07-05-*`) show 49 `/api/chat` requests across 14 shopper turns: a pooled mean of 3.5 requests per turn (range 1-6, median 3), because the agent's native tool loop routinely issues 2-5 follow-up completions within one turn. The declared repetition plan yields roughly 180 base campaign turns, so:

- Base campaign: 180 turns x 3.5 = ~630 requests.
- Retry reserve at the observed ~7% failure rate with one retry per failed turn: +13.
- 10% headroom: +63.
- Recommended `/api/chat` ceiling for the full Stage 7 campaign: **750** (declare explicitly via `JTV_MAX_COMPLETION_REQUESTS`; never infer from turn count).
- The Stage 6 connected replacement slice fits inside that ceiling: 6-10 turns x 3.5 = 21-35 requests (its own stop budget is capped at 60 by `JTV_STAGE6_MAX_COMPLETION_REQUESTS`).
- The 61 wording-variant turns are NOT covered by 750; running them in the same campaign needs roughly +214 or must wait for the continuation rate to fall.
- The rate itself is inflated by the duplicate-continuation defect class the test plan targets (B28); a verified continuation fix is the legitimate path back toward a smaller cap. Auxiliary classifier/suggestion usage is unobservable and sits on top of any `/api/chat` ceiling.

## Abort-classification rule (stream-continuation fixture)

An aborted second `/api/chat` request inside a turn is NOT automatically a shopper failure. Per `.checkpoint/runs/stream-continuation-fixture-2026-10-07/`: when the turn still delivered a completion receipt and a visible reply, the abort is a body-capture artifact - the runner preserves the abort telemetry, classifies the request by body identity, and never counts it as a failure. A deliberately broken stream has neither receipt nor reply; only that shape triggers the single transport retry. An HTTP 200 alone is never treated as turn success.

## Completion oracle (browser-observable finish signal)

`evaluateTurnCompletion` in `accounting.mjs` is the single turn-completion authority for both runners. A turn is `completed` only when ALL of the following hold:

1. A transport receipt exists (non-failed 2xx `/api/chat` response in the turn).
2. The app's own completion receipt set - session-storage keys beginning `jtv-concierge-completed-`, written by `ConnectedConcierge` only after a clean finish (no abort or error, completed tool states, final done text part) - gains a new ID versus the pre-turn snapshot, and that delta contains the **exact latest assistant ID from the persisted chat transcript** after the current shopper message (mismatch verdict: `completed-id-mismatch`).
3. A new assistant message is rendered in the visible rail (`id-without-new-message` otherwise).

Rejection verdicts: `no-receipt`, `no-completed-id` (covers HTTP 200 plus partial text from a stream that died before the clean finish - the earlier truncated-stream gap is closed by the receipt-signal requirement), `stale-reply` (old rail plus old ID), `no-reply`. Identical reply text with a genuinely new, transcript-matching completed ID is `completed`: the SDK receipt is authoritative over surface text, which also removes the earlier consecutive-identical-reply false failure.

Remaining honest limits: the transcript scan is generic over the persistence key format (any session-storage JSON containing assistant messages contributes IDs), so a second app writing assistant-shaped JSON to session storage could confuse it - none exists today; and a stream that renders partial text AND writes the completed receipt before dying would still pass, but that shape contradicts the writer's own clean-finish conditions and has not been observed.

Known harness limits, recorded honestly:

1. **Adverse evidence fixtures are declared but not wired.** `adverseEvidenceFixtures` in the manifest describes four controlled route fixtures, and no scenario references one. Until a scenario binds a fixture and the runner intercepts that route, guaranteed adverse coverage (missing weight, contradictory plating, incomplete set contents, blog timeout) stays unknown, and the affected requirement cases remain blocked rather than proven.
2. **Interpretive expectations have no in-run review path.** They stay `unknown` pending independent review of captured dialogue, source records and scoped state; the runner cannot upgrade them, so a mechanically clean run still ends with `unknown` verdicts by design. A skipped or locally passing test does not close Stage 7.
3. **Classifier and suggestion usage is not observable.** Only URLs ending in `/api/chat` are counted. Budget accordingly.
4. **A completion request observed outside a declared shopper turn stops the campaign** as a harness defect, including a straggling late response. This is conservative by design.

Opt-in command for the later paid campaign (run only after the budget is approved; the application must already be running locally):

```sh
JTV_RUN_LIVE_CONCIERGE_E2E=1 JTV_MAX_COMPLETION_REQUESTS=750 \
  npx playwright test --config evaluation/concierge-phases-1-3/live.playwright.config.ts
```

Reaching the ceiling leaves the remaining journeys unexecuted; the runner records a controlled budget stop, not a harness defect.

Automated checks cover visible discovery cards, Saved count, two-card Compare state and labelled system notices. Interpretive expectations stay **unknown** pending independent review of captured dialogue, source records and scoped state. The complete requirement-ID trace, full timing/configuration capture, independent semantic review, and actual live run are still missing. A skipped or locally passing test does not close Stage 7.
