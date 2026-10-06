# Plan 3.1 snapshot handoff

**Status:** Incomplete development snapshot, October 6, 2026. The full approved plan, session history, live traces and source snapshots are kept in the local project's ignored `docs/workspace/concierge-phases-1-3-build-2026-10-05/` and `SESSION.md`. This public file records the key handoff facts without private run evidence.

## What exists

The local storefront uses one published Agent Studio Concierge as the conversational owner, three client-side tools, a read-only product/blog evidence API and a two-column React UI. It supports typed preferences, Saved, Compare, exact product IDs and proposed looks with exact item subtotals. Application code validates state and evidence; the agent generates the language. No customer index record or setting was changed.

The development agent is `Concierge - Development` (`0bdf59fe-e598-4db7-b139-2b93d5255bb4`, GPT-5.6 Luna). Its declared tools are `update_shopping_state`, `retrieve_evidence` and `present_choices`. The older Concierge (`ba2bb723-0459-4df6-ba8b-812088f39f0f`), legacy Interpreter (`9ec5d9b2-54a8-4cf3-a668-e453b64986c2`) and search suggestion helper (`7241dde3-2255-4a33-9834-61e3cbeeb986`) must not be assumed unused from this repository alone.

## Acceptance, by plan stage

| Stage | Current evidence | What remains |
| --- | --- | --- |
| 1. Contracts and configuration | Prompts, schemas and three-tool design prepared; active prompt text was read back locally. | Reconcile the full saved configuration and manifest with all later dashboard edits. |
| 2. Development connection | Real localhost calls produced Concierge text, product and blog retrieval, and client-tool callbacks. | Close every required bounded smoke branch as one documented gate. |
| 3. Tool and retrieval proof | Exact-ID read path, strict sources, typed facts and validation exist. | Complete native-gap, ordering, price and collision tests. Fresh-session direct-ID behavior remains unresolved. |
| 4. Anniversary journey | Reached selected necklace DOQ140 after several retries. | One uninterrupted journey and the full requirement assertions. |
| 5. Saved, Compare and blog | A mission reached six Saved items, two compared items and a JTV education detour. | Case-level continuity proof; chat transcript currently disappears on reload. |
| 6. Looks and replacements | DOQ140 plus RST2197 rendered with a $239.98 item subtotal. | Replacement failed: one bracelet had yellow-gold finish against an accepted dislike; a corrected $479.98 look was withheld by an output guardrail. |
| 7. Integrated acceptance | A ten-journey scaffold exists. | The scaffold cannot be treated as an acceptance harness; its turn accounting, UI actions and expected assertions need repair before a paid campaign. |
| 8. Promotion | No Plan 3.1 promotion was earned. | Complete earlier gates and independent review. A requested hosted snapshot is not a completion claim. |

A fresh one-turn guardrail probe did not show the previous system notice, but it also failed to retrieve usable exact products and never reached presentation. It does not verify the guardrail change. A repeated output notice must be treated as a failed turn, even when the tool had staged a valid proposal.

## Quality and operating limits

The most recent local checks reported 435 passing Vitest cases including 10 private historical cases. A clean export of the intended Git tree passed 425 tracked Vitest cases, 20 Python unit tests, ESLint, dependency validation, TypeScript and build. The hosted UI gate previously confused `developmentConfigured:false` with an unavailable Concierge even while production chat worked. The health contract now exposes `conciergeConfigured` for both environments, and a production regression test covers the gate. Repository `format:check` remains red: 75 tracked files need formatting in the clean export, and `check:line-policy` reports nine handwritten modules over 500 lines without recorded exceptions. These are open engineering debts, not passes. Full live-agent acceptance, cost, latency and classifier behavior are not proven. Very large input-token use was observed in Agent Studio conversations. The app has no checkout, login or cross-device persistence. Saved/Compare session lifecycle is intentionally deferred until the core flow stabilizes.

The previous 4 KB turn-context cap was application code, not a verified SDK limit. It was removed; per-value and key-count bounds remain. Product and blog sources stay fixed and read-only. The older architecture-comparison runs are preserved as history, not an active test harness.

## Continue in order

1. Verify this GitHub commit, its CI run and the protected Vercel deployment as one snapshot. Keep Git-triggered deployment disabled and Vercel Authentication enabled.
2. Read the ignored local Plan 3.1 appendix and `SESSION.md`, then reconcile the exact Agent Studio configuration package.
3. Close Stages 2 through 5 in order. Do not call Stage 6 accepted just because one look rendered.
4. Run a bounded guardrail allow/deny matrix before repeating the replacement journey. Record generated text, category event, tool receipts and visible state. Do not broaden or disable guardrails just to obtain a green demo.
5. Repair the Stage 7 harness before any paid campaign. Use real UI actions and state/evidence assertions. Keep failed, blocked and unrun cases separate.
6. Verify each older agent's owner, consumers and rollback dependency before deletion. Preserve configuration backups and historical evidence.

The exact Git commit and protected Vercel deployment must be verified in their respective systems. The local `SESSION.md` and Plan 3.1 appendix hold the release record because they can be updated after the commit without changing the published source tree.
