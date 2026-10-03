# Jewellery TV concierge demo

A JTV-style storefront for testing a jewelry buying concierge with real catalogue context. Shoppers can browse six departments, refine results, open an exact product style and discuss it with the hosted Algolia Agent Studio concierge.

The app uses React InstantSearch for search and chat. A server-side API keeps Algolia credentials out of the browser and restricts access to the approved catalogue indices and agent endpoints. It never changes customer index records, ranking, synonyms or search settings.

**Hosted app:** https://jewellerytv.vercel.app
**Vercel project:** https://vercel.com/algolia/jewellerytv
**Access:** Vercel authentication protects production and preview deployments.

## How it works

![Storefront and concierge workflow](storefront/docs/architecture.svg)

The same validated API handler runs locally and as a Vercel Node function. Product URLs use exact Algolia objectIDs, not product-family IDs. The client sends bounded page context with each message. Curated product results feed a separate visual workspace; the conversation retains the agent’s guidance and questions. The shopper controls product previews and any change to the browsing view.

The shopping workspace separates Discover, Compare, Saved and Combination. Compare shows alternatives with images and recorded facts; only Combination calculates a purchase subtotal. Exact product records are shared across views and refreshed through read-only requests. The editable shopping brief appears as compact chips in the chat header. With brief v2 enabled, clear spoken preferences update before search; ambiguous changes prompt clarification. Supported requirements become query-time filters without changing the production index. Manual edits, removal, Undo and saved-piece conflict checks use the same revisioned state. The desktop product panel stays beside the conversation, with a simple empty state until there are products to review. The hosted agents own their model configuration; this repository does not automatically overwrite their prompts or settings.

## Run and verify

Use Node.js24 and npm:

```sh
cd storefront
npm ci
npm run dev
```

The website runs at http://localhost:5173. The local API reads server credentials from the project-root `.env.local`, with names documented in [the environment template](storefront/.env.example). Never put real values in Git or in `VITE_*` variables.

```sh
npm run typecheck
npm test
npm run build
```

[Application runbook](storefront/README.md) · [Deployment guide](storefront/docs/deployment.md)

Work locally by default. Vercel deployment requires an explicit request for each release. Git-triggered deployments are disabled; pushing to GitHub or checkpointing does not deploy the app.

GitHub Actions runs type checks, tests and the build. Browser regression source is included; live model tests are separate and consume the connected agent's usage.

## Boundaries

This is a discovery demo, not checkout. Prices and availability are retrieved catalogue facts, not transaction confirmation. Accounts, orders, payments, auctions and television streaming are outside scope. Browser conversation history, shopping workspace state and server-side persistent memory are distinct; a new client conversation does not delete stored server history.

This public repository contains application code, tests and demo assets. Private research, conversation evidence, credentials and live-agent snapshots are deliberately excluded and preserved in the local project. JTV's logo and imagery remain JTV's assets and are used here as demo references, not as a statement of endorsement.
