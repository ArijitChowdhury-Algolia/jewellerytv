# JTV Concierge storefront

This is the React and Node application behind the [JTV Concierge snapshot](../README.md). It connects a two-column shopping UI to one published Concierge in Algolia's Agent Studio. The application provides typed tools, session state, read-only catalogue and blog retrieval, exact product identity checks, price arithmetic and rendering. The agent generates the shopper conversation.

The current snapshot is incomplete. See the [Plan 3.1 handoff](docs/PLAN-3.1-STATUS.md) for observed passes, failures, pending work, agent inventory and the exact release version. The [workflow diagram](../README.md#how-it-works) shows the runtime boundaries.

## Source map

| Area | What it owns |
| --- | --- |
| `src/concierge/ConnectedConcierge.tsx` and `ConciergeWorkspaceProvider.tsx` | Installed Chat SDK, local session binding, final-turn publication and existing two-column workspace. |
| `src/concierge/sdkTools.ts` and `toolRuntime.ts` | Three declared client callbacks, version checks, evidence ledger and staged product choices. No generated shopper language. |
| `src/concierge/sessionPersistence.ts` and `shared/concierge/` | v3 shopping state, lossless migration/backup, scoped facts, exact identities and deterministic selection validation. |
| `server/api.ts` and `server/concierge/` | Bounded API proxy, fixed read-only `prod_catalog` and `blog` retrieval, exact object lookup and source-bound evidence. |
| `src/ProductWorkspace.tsx` | Discover, Saved, Compare and Combination product views with visible prices and supported details. |
| `tests/` and `evaluation/concierge-phases-1-3/` | Local regressions and a prepared but unaccepted live-journey scaffold. |

The published `Concierge - Development` now serves the protected Vercel snapshot as well as the connected local path. Its tool names are `update_shopping_state`, `retrieve_evidence` and `present_choices`. The retained older Concierge and legacy Interpreter remain separate Agent Studio resources pending consumer checks. No product-index setting or record change is part of this application.

## Local run

Use Node.js 24. Place server credentials and the selected agent identity in the parent project's `.env.local`; see [`.env.example`](.env.example). The development and production identity variables may name the same published agent. Never commit that file or pass credentials through `VITE_*` variables.

```sh
npm ci
npm run dev
```

The app opens at `http://localhost:5173`, with the API on `127.0.0.1:5174`. The API uses Algolia's search-only key for read-only product and blog calls. Browser state is per tab. Reload currently preserves shopping state but loses the visible chat transcript. Login, cross-device state, cart, orders and payment are outside this build.

## Checks

```sh
npm run lint
npm run check:dependencies
npm run typecheck
npm test
npm run build
npm run format:check
python3 -m unittest discover -s evaluation -p 'test_*.py'
```

`format:check` still reports pre-existing formatting debt; do not claim an all-green quality gate from the other passing commands. Live Agent Studio tests consume model and classifier usage and are not part of `npm test`. The prepared Phase 3.1 Playwright runner is not acceptance-ready; its request accounting and UI assertions must be repaired before any paid campaign.

For a read-only configuration backup, run `npm run snapshot -- <agent-id>`. The ID must be explicit; the command no longer defaults to a retired agent. Snapshots are written under ignored `evidence/` and are not release source.

## Deployment

The protected Vercel project has Git-triggered deployment disabled. An authorized snapshot needs a manual Vercel deployment and a valid `JTV_CONCIERGE_PRODUCTION_AGENT_ID` in the Production environment. Verify the served commit, protected access, `/api/health`, a read-only product request and an actual Concierge turn. Follow the [deployment guide](docs/deployment.md). A GitHub push and a Vercel build are separate events.
