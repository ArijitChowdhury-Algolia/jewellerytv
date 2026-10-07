# Public GitHub and Vercel snapshot

Repository: [ArijitChowdhury-Algolia/jewellerytv](https://github.com/ArijitChowdhury-Algolia/jewellerytv). Vercel project: `algolia/jewellerytv`. Production alias: [jewellerytv.vercel.app](https://jewellerytv.vercel.app).

This release is an explicitly requested snapshot of incomplete Plan 3.1 work. It must not be described as a completed shopping experience. The [status handoff](PLAN-3.1-STATUS.md) lists the observed passes and failures.

## Deployment boundary

The JTV app is public: Vercel Authentication is disabled for this project, so visitors can open the production site without a Vercel account. Do not re-enable a deployment login unless Arijit explicitly requests it. `git.deploymentEnabled: false` in `vercel.json` keeps GitHub pushes from deploying automatically. Deploy manually only for an authorized release. The Vercel project root is `storefront`, Node.js is 24.x, the build is `npm run build`, output is `dist`, and the same Node API handler runs locally and as the Vercel function. Direct product, category and search routes are SPA rewrites.

The customer `prod_catalog` and `blog` records and index settings are read-only. Deployment does not modify them or publish an Agent Studio prompt. Agent Studio configuration is administered separately in the signed-in dashboard.

## Production environment

Set server-side `ALGOLIA_APP_ID`, `ALGOLIA_SEARCH_API_KEY`, `APP_ALLOWED_HOSTS` and `JTV_CONCIERGE_PRODUCTION_AGENT_ID`. The production ID must name the published Concierge selected for this snapshot. Local development uses `JTV_CONCIERGE_DEVELOPMENT_AGENT_ID`; both IDs may refer to the same agent. The launcher does not gate on environment or health. The server rejects chat when the selected ID is missing or invalid. Do not place an Algolia key or agent configuration secret in a `VITE_*` value. Do not commit `.env.local` or raw Agent Studio snapshots.

Historic `BRIEF_V2_ENABLED`, `JTV_BRIEF_AGENT_ID`, `BRIEF_TURN_ROUTING_ENABLED`, `CONCIERGE_DIRECT_CANDIDATE_ENABLED` and `JTV_CONCIERGE_AGENT_ID` belong to the retired two-agent route and do not drive the current connected `/api/chat` path. Remove hosted variables only after verifying no old deployment or rollback depends on them. A configured environment variable name does not prove an active consumer.

## Verify the snapshot

1. Run `npm ci`, `npm run lint`, `npm run check:dependencies`, `npm run typecheck`, `npm test`, `npm run build` and Python evaluation unit tests from the intended checkout. Record `format:check` failures honestly.
2. Review the intended outgoing Git tree and commits for credentials and private evidence. Push and verify GitHub CI for the exact commit SHA.
3. Deploy that same checkout manually with `vercel --prod --scope algolia`. Record the deployment ID and production alias. A successful CLI command is not yet a verified site.
4. In a fresh unauthenticated browser, check that both production aliases and the deployment URL return the app without redirecting to Vercel login. Verify `/api/health`, a read-only exact product request, served asset identity and one bounded Concierge request against the intended agent ID. The public `/api/chat` endpoint invokes the paid agent, so monitor usage as traffic grows.
5. Confirm `git.deploymentEnabled: false` and `ssoProtection: null` after the deployment. Record any failure, including a successful build with an unconfigured or guardrail-blocked chat.

Rollback: restore the prior deployment and its environment values. Deployment protection is a project setting, so rolling back code does not re-enable Vercel Authentication. Do not delete the older production Concierge until its consumer and rollback roles are disproven. Deleting it first would make a simple rollback of the prior app impossible. Preserve shopper state and private test evidence; never rewrite Git history as cleanup.

The root README embeds the self-contained [workflow SVG](architecture.svg), with [Mermaid source](architecture.mmd) for edits. The SVG uses system fonts, inline shapes and no external asset, so no PNG fallback is needed. Verify the rendered image in the pushed GitHub README at normal zoom. The former SVG depicted a two-agent interpreter flow and is no longer active.
