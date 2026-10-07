# Plan 3.1 integrated acceptance scaffold

This folder owns a **prepared, unexecuted** browser campaign. Its ten journeys remain examples for acceptance, not proof of accepted behavior. The older `storefront/tests/e2e/concierge-phases-1-3.spec.ts` scaffold was retired because it treated completion requests as shopper turns and conflicted with this manifest. Historical source remains in Git history.

The runner uses the current two-column Concierge and actual `Save`/`Compare` controls. It counts shopper turns separately from every observed `/api/chat` completion request, including continuations and failed responses. A request budget must be provided explicitly. Unknown, blocked, unrun and failed assertions never become passes. The first failure is retained. A harness defect stops the full campaign.

Local verification, with no paid turns:

```sh
node --test evaluation/concierge-phases-1-3/*.test.mjs
npx playwright test --config evaluation/concierge-phases-1-3/live.playwright.config.ts
```

The Playwright command skips by default. Before any live campaign, calculate an approved cumulative budget from planned shopper turns, expected continuations, auxiliaries and repetitions; then set both `JTV_RUN_LIVE_CONCIERGE_E2E=1` and `JTV_MAX_COMPLETION_REQUESTS` for that bounded run. The application must already be running. Do not infer classifier or suggestion work from `/api/chat` calls; where the platform does not expose those events, usage remains unknown.

Automated checks cover visible discovery cards, Saved count, two-card Compare state and labelled system notices. Interpretive expectations stay **unknown** pending independent review of captured dialogue, source records and scoped state. The required 22-turn continuity case, complete requirement-ID trace, full timing/configuration capture, independent semantic review, and actual live run are still missing. A skipped or locally passing test does not close Stage 7.
