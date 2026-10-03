# JTV concierge demo

A local JTV-style storefront for testing the existing jewelry buying concierge against live Algolia catalogue data.

## Run

```sh
cd storefront
npm ci
npm run dev
```

Open http://localhost:5173. One command runs Vite and the Node API. Both are local-only; the API listens on 127.0.0.1:5174. Stop with Ctrl+C. The launcher enables Node's system certificate trust without disabling certificate validation.

The API reads `ALGOLIA_APP_ID` and `ALGOLIA_SEARCH_API_KEY` from the parent project's `.env.local`. It does not expose that file or either credential to the frontend. No `VITE_*` credentials are needed. For the protected Vercel deployment, see [the deployment guide](docs/deployment.md).

## Shopping flows

- Shop six core departments; refine price, available size, stone, material and category-specific attributes.
- Switch Featured, Newest, Top Rated and price ordering using the existing replicas.
- Open exact product/style records. Product-family identifiers never replace object identity.
- Select an available size and click **Ask about this item**.
- Use the floating concierge button from any page. Product cards open local product pages; conversation survives client-side navigation.
- **New conversation** stops generation and resets the client conversation ID, messages and record cache. Full reload also starts fresh. These actions do not delete server-held history or disable the live agent's memory setting.
- **Demo diagnostics** shows the page context and outgoing request timings in development mode.

## Architecture

![Storefront and concierge workflow](docs/architecture.svg)

```mermaid
flowchart LR
  Shopper[JTV React storefront] --> State[Persistent InstantSearch state]
  State --> Search[Local search and facet API]
  Shopper --> Detail[Exact objectID product page]
  Detail --> Product[Local product API]
  State --> Context[Bounded per-turn context]
  Detail --> Context
  Context --> Chat[InstantSearch Chat]
  Chat --> Stream[Validated streaming API]
  Stream --> Interpret[Interpret and verify latest preferences]
  Interpret --> Brief[Revisioned shopping brief]
  Brief --> Compile[Compile supported query-time constraints]
  Compile --> Agent
  Search --> Catalogue[Algolia production catalogue family]
  Product --> Catalogue
  Agent[Published Agent Studio concierge]
  Agent --> Catalogue
  Agent --> Cards[Curated IDs and explanations]
  Cards --> Workspace[Discover / Compare / Saved / Combination]
  Workspace --> Shopper
  Workspace --> Session[Per-tab selections and revisioned brief]
  Session --> Context
```

All API upstream hosts, routes and indices are fixed/allowlisted. Search analytics, click analytics and A/B testing are disabled. The main concierge uses the existing agent completion endpoint. When BRIEF_V2_ENABLED=true, a dedicated interpreter updates and verifies the brief before the concierge can search. Consequential ambiguity returns a clarification without a catalogue search. Supported requirements become query-time constraints; the index configuration remains untouched. No administrative write endpoint is exposed.

Product facts come from the connected catalogue and may differ from JTV's website. Prices, sizes and availability are not checkout confirmation. The demo omits payments, accounts, auctions, TV streaming and editorial search. Secondary navigation identifies these boundaries explicitly. Saved pieces and a shopper-confirmed brief belong to the client shopping workspace, not a JTV account.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e -- --list
```

`npm test` runs data, routing, context and API tests with injected upstream adapters. Browser regression source lives in `tests/e2e`; running `npm run test:e2e` requires the local server and installed Chrome. These regression scenarios mock historical catalogue records and block model calls. Fixture data is never an automatic fallback for failed live requests.

Live browser checks were performed separately through the connected Chrome tool. See `evidence/VALIDATION.md` for exact scope, live conversations, screenshots and limits. Do not confuse Playwright test discovery with execution.

React InstantSearch is pinned at 7.51.0, core 7.51.0 and InstantSearch.js 4.119.0. The catalogue is read-only. Agent ID: `ba2bb723-0459-4df6-ba8b-812088f39f0f`.

## Evidence and recovery

`npm run snapshot` (with `NODE_USE_SYSTEM_CA=1`) saves a read-only snapshot of the current agent configuration and hashes. It never applies local prompt files. Snapshots contain configuration but no API key; keep them as local evidence.

If search or chat fails, use its visible error/retry control. There is no mock-agent fallback. A failed or pending listing blocks page-grounded chat until results settle, so a new filter cannot be paired with stale product IDs. Context over platform limits produces a visible message and prevents sending.

Rollback consists of stopping the local processes. No index settings, records, prompts, guardrails or memory configuration are changed by this application.

## Shopping workspace

See [the shopping-brief workflow](docs/shopping-brief.md) for interpretation, scope, retries and query constraints.

The desktop concierge keeps conversation and products in two persistent columns. Before results arrive, the product workspace shows a simple empty state. Mobile switches between Conversation and Products tabs. Discover, Compare, Saved and Combination keep their separate purposes. Only Combination adds quantities and totals, using integer cents.

New conversation and Preferences share the concierge header. Preferences shows a live count and stays collapsed by default. Opening it reveals editable chips, Add preference and Undo; new conversational preferences update the count without opening the panel. With brief v2 enabled, clear spoken preferences update automatically before search; ambiguous requirements prompt clarification. Each fact carries scope, source and revision. A later explicit correction replaces only affected facts. Manual edits share the same reducer and compiler, and invalidate an in-flight reply built on an older revision. Removal and Undo remain available. Saved pieces are retained and checked for conflicts rather than silently deleted.

Set server-only `BRIEF_V2_ENABLED=true` and `JTV_BRIEF_AGENT_ID` to enable orchestration. The interpreter must implement INTERPRET, VERIFY and CLARIFY JSON contracts and have no configured search/write tools. Its failure stops the affected turn with retry rather than searching with an unapplied change. The separate verification pass reduces interpretation errors but cannot guarantee semantic accuracy. Keep the feature disabled for the legacy chat route.

Supported exact catalogue facets and numeric budgets become safe filters. Recipient, occasion, subjective wording and unresolved item scopes remain consultation context. A total budget bounds individual results but only exact combination arithmetic establishes whether selected pieces fit together. Missing evidence stays unknown.

While a reply is being prepared, a compact status replaces the default skeleton. An optional disclosure lists observed activity, and the elapsed timer is not an ETA. The header line indicates ongoing work without claiming a completion percentage. Empty product tabs use the banner headline with a tab-specific hint; actual products replace it.

Development diagnostics record bounded metadata: interpretation/verification, upstream headers, stream events, completion, workspace rendering and image outcomes. Tool spans are observed stream intervals, not provider execution measurements. Provider-internal timing and usage may not be exposed. Shopper text, credentials and private reasoning are excluded from these timing records.

`?experience=baseline` compares layouts only, not frozen agent behavior. See `evaluation/README.md` for conversation evaluation and its limits. Cloud prompts are managed separately and must be read back and tested before release.
