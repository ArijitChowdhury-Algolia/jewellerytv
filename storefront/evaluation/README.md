# Concierge conversation evaluation v1

This suite converts the Understanding and Discovery playbook into ten multi-turn families. It evaluates behaviour, not a particular wording or prescribed shopping sequence. Each turn has an observable review objective. Later turns reference an actual selected product ID; when none exists, the runner follows a recovery branch instead of inventing a product. No production index writes are implemented.

## Run

From the project root:

```sh
python3 storefront/evaluation/run.py --scenario anniversary
python3 -m unittest discover -s storefront/evaluation -p 'test_*.py'
```

Dry-run is the default: it does not load credentials, access the network or mutate application data. Ten families: `anniversary`, `material`, `identity`, `wearability`, `fresh_mission`, `no_budget`, `rapport`, `deadline`, `constraint_recovery`, `display_persistence`.

Only when a live diagnostic run is intended:

```sh
python3 storefront/evaluation/run.py --scenario material --live --max-turns 4 --repeat 1
```

Live mode calls the existing published-agent completion harness. It reads credentials from the existing local environment file without printing them, disables analytics/cache and persistent memory, and passes observed conversation history. Maximum six turns and three repetitions of one selected family per invocation. It consumes model requests. It does not update the agent or index. A fresh run directory is created, never overwritten. Do not put real customer or personal data into these synthetic scenarios.

The harness uses a fresh diagnostic conversation ID for each completion, with explicit full public history. Consequently it tests history-based continuity, **not persistent account memory or application-managed state**. `fresh_mission` tests a new mission inside the same explicit history. Persistent-memory isolation must be separately exercised through the storefront. Likewise an API event is not evidence that images stayed visible: `display_persistence` requires browser observations.

## Baseline and attribution

`baseline/manifest.json` (private local evidence, excluded from Git) freezes the existing local snapshot, prompt pair and source playbook by SHA-256. It does not claim a fresh live read-back. Live runs additionally snapshot and hash the actual published configuration before running, and compare it after running. Changed configurations invalidate the comparison. A candidate run must carry its own configuration hash; never compare mixed configurations as one test.

For the frontend candidate, record its source revision/hash, browser dimensions, exact selected product IDs, shopping-brief transitions and screenshots before/after streaming. Run the same scenario family against both interfaces. Keep the resulting evidence under this project. API output alone cannot evaluate the new shortlist or brief integration.

## Mechanical checks

`scorer.py` checks runtime rejection/error events, curated IDs against observed retrieval (including history), strict individual price limits when the scenario supplies one, and exact record fields when explicitly requested. Currency is integer cents via Decimal; unknown prices are **not observed**, never a pass. An optional reviewer/application-supplied `pair_ids` and `combined_limit_cents` checks an explicit pair. A group of alternative necklaces is never automatically summed as a pair.

These checks cannot establish every claim is grounded, that a shopper preference was interpreted correctly, or that the conversation is enjoyable. No fake combined quality score is generated. A fallback can be appropriate, so a runtime failure requires diagnosis rather than automatic guardrail weakening.

## Human comparison

Hide version labels from reviewers and randomise A/B order. Assess the entire journey and link each judgement to a turn and evidence. Use the same 1–5 anchored rubric:

- Understanding: 1 loses or invents constraints; 3 mostly retains them with repair; 5 accurately handles uncertainty, correction and mission scope.
- Discovery: 1 repeats filters/results; 3 offers some useful differences; 5 learns from reactions and makes each next choice more useful.
- Consultation: 1 reads fields or lectures; 3 sometimes explains a relevant difference; 5 consistently improves the shopper's ability to decide.
- Initiative: 1 makes the shopper manage the process; 3 mixes action and needless questions; 5 acts or asks according to the next useful decision.
- Personality: 1 cold, canned or pressuring; 3 pleasant but inconsistent; 5 warm, jovial when appropriate, conscientious and sensitive without invented experience.
- Effort and visual clarity: 1 lost selections, disappearing cards or confusing totals; 3 usable with scrolling/repetition; 5 stable selections and clear imagery, comparisons and costs.

Record factual failures separately. High personality cannot offset an invented product, breached firm budget, false identity or unsupported guarantee. Require zero observed critical failures in the tested journeys, with no new regressions; do not claim universal reliability from a small sample.

Repeat live families to measure variance. Hold out new wording, different recipients and a category not used for tuning. Do not optimise the prompt for exact scenario phrases. Start with a bounded run, inspect it, fix the responsible layer, then rerun affected families and adjacent regressions.

## Browser-only checks

For selected turns, save screenshots after the completed reply and after another turn. Confirm the last valid shortlist survives a text-only answer, blocked response and simulated transport failure. Confirm product IDs/variants survive pin, compare, remove and mission reset. Check mobile as well as desktop, keyboard selection, readable prices and accurate combined totals. Rendered cards are the evidence; tool calls alone do not pass this gate.

The published runner includes its own transport/history helpers. Supply ALGOLIA_APP_ID and ALGOLIA_SEARCH_API_KEY as environment variables or in the repository-root .env.local. Private baseline snapshots and live run outputs are ignored. No credentials are needed for scorer tests or dry runs.

## Brief v2 live journeys

`brief_v2_live.py` exercises the revisioned API with eight four-turn shopping journeys. It reconstructs AI SDK message history from observed text and completed tools. It never fabricates a tool result to continue a conversation.

Start the configured local storefront, then run from the repository root:

```sh
python3 storefront/evaluation/brief_v2_live.py --mode candidate --repeat-critical \
  --workers 2 --out analysis/brief-v2/candidate-run
```

The default candidate endpoint is `http://localhost:5173/api/chat`. Override it with `--candidate-url` for an isolated diagnostic proxy. A candidate proxy run needs no local credential file. Direct baseline mode reads `ALGOLIA_APP_ID` and `ALGOLIA_SEARCH_API_KEY` from the environment or the optional root `.env.local`; `--baseline-url` instead uses a configured local proxy. `--mode both` runs both variants. Worker count is bounded to one through three.

Each run stores request/response evidence, phase timings, source hashes and journey summaries under the requested private output directory. Missing private configuration files are marked `not_available`; a source-file hash is not a live agent readback. Freeze the published model and agent configuration separately before comparing runs. Never combine changed configurations into one clean pass.

When present, `resolvedSearchParameters` records the native `data-tool-output-metadata` event’s `com.algolia/resolved-search-params` values. These are runtime evidence of the filters actually passed to search.

Review both `response` and `groupedIntros`: the latter contains the conversation text delivered through grouped results. Mechanical checks cover grouped IDs against observed catalogue records and candidate prices against active typed budget facts. Prices use exact decimal cents; missing or fractional-cent evidence stays unknown. Baseline responses have no typed brief, so the candidate price check is not a shared baseline score. Total-budget item bounds also do not prove that a proposed combination fits: review explicit component IDs and sums separately.

Create a file named `STOP` inside the run directory to stop after active turns finish. Remove it and use `--resume` to reuse completed evidence; resumed summaries mark reused turns explicitly. An already recorded failed turn stays failed, so investigate it and use a fresh directory for its retest. HTTP success alone does not establish semantic correctness, resolved filter parameters, visual behaviour or conversation quality.
