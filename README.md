# JTV Concierge demo

## Canonical project wiki

The durable JTV charter, five-stage playbook, decisions, requirements and Plan 3.1 gates live in Arijit's local Obsidian project wiki at `/Users/arijitchowdhury/Dropbox/AI-Development/Obsidian/Arijit-Second-Brain/Projects/jewellerytv/index.md`. That wiki, `SESSION.md` and `docs/HANDOFF.md` are local to the original checkout and are not included in a fresh GitHub clone. The portable [Plan 3.1 status](storefront/docs/PLAN-3.1-STATUS.md) and [storefront operating rules](storefront/AGENTS.md) travel with this repository. In the original checkout, also read the local root `AGENTS.md` (linked by `CLAUDE.md`) and the canonical vault SOPs.

A public JTV-style storefront for exploring jewelry through conversation. One Concierge in Algolia's Agent Studio learns the shopper's preferences, searches the read-only JTV catalogue and guidance, and helps them discover, save, compare and combine pieces. The shopper sees conversation beside a product workspace.

**Status:** This repository is an incomplete Plan 3.1 snapshot. The Concierge is live on the public [main Vercel URL](https://jewellerytv.vercel.app/) with no Vercel login. Connected browser checks showed necklace discovery and correction, honest commerce boundaries, and five watches across three compact discovery groups. Short model-facing evidence references map to full canonical identities internally. The published Agent Studio state tool uses a strict required-but-nullable `sourceQuote`: precise shopper phrases are retained when supplied, while null uses the exact current short message and long messages fail closed. The exact production deployment identity is recorded in the local Plan 3.1 and `SESSION.md` handoff. Full anniversary, replacement, guardrail and continuity acceptance remains open; no checkout or purchase verification exists.

**Public hosted app:** [jewellerytv.vercel.app](https://jewellerytv.vercel.app)

**GitHub:** [ArijitChowdhury-Algolia/jewellerytv](https://github.com/ArijitChowdhury-Algolia/jewellerytv)

## How it works

![JTV Concierge workflow](storefront/docs/architecture.svg)

The [editable workflow source](storefront/docs/architecture.mmd) records the full state, retrieval and exact-ID refresh paths. The static SVG uses system fonts and self-contained shapes, so GitHub can render it without a separate PNG fallback.

The Concierge owns interpretation, tone, questions, search decisions, curation and explanations. The application owns state, identity, source boundaries, exact arithmetic and display validation. Its three client-side tools are `update_shopping_state`, `retrieve_evidence` and `present_choices`. Product and blog indices and all index settings remain read-only. The app does not contain canned Concierge replies or a second conversational router.

The browser keeps the current shopping mission in session storage. Selected, Discover and Compare share that state. Agent-proposed complete looks land in the Selected view with their item subtotal, and look lines already in the selected grid carry a Selected mark. A new conversation keeps Selected pieces while resetting the brief and working selection. The longer-term Selected/Compare session lifecycle has not been decided. Agent Studio memory is off, and there is no login or cross-device state.

The app displays incoming Concierge text as it streams, then commits the answer and product cards only after a completed turn. Discover starts with one lead item for each validated product group. A shopper can reveal up to two more already selected items within that group; opening it does not make another catalogue request. Group counts follow the evidence, so two meaningful directions remain two.

## Run locally

Use Node.js 24 and npm. Supply the server-side Algolia values and published Concierge agent ID in the project-root `.env.local` as described in [the environment template](storefront/.env.example). The two environment variables may name the same agent. Do not put credentials in `VITE_*` variables or Git.

```sh
cd storefront
npm ci
npm run dev
```

Open `http://localhost:5173`. The local API runs on `127.0.0.1:5174`. The [storefront guide](storefront/README.md) covers the source modules and checks. The [deployment guide](storefront/docs/deployment.md) covers the public Vercel snapshot and rollback.

## Verification and limits

The local build uses TypeScript, Vitest, ESLint and dependency checks. The live Concierge and guardrail must be judged through actual connected browser journeys. A successful tool receipt, a green unit suite or a deployed page is not proof of a complete shopping experience. The current release's exact test, CI, agent and deployment identities belong in the [snapshot handoff](storefront/docs/PLAN-3.1-STATUS.md).

The hosted demo is publicly accessible without a Vercel login. Git-triggered deployments are disabled; a GitHub push does not deploy. The `/api/chat` endpoint is publicly reachable and invokes the published agent, so monitor its usage as public traffic grows. Customer index records, rankings, synonyms and settings must never be changed as part of this project. JTV marks and imagery are demo references and do not imply endorsement.
